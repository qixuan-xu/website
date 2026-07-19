import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { MAX_MEDIA_BYTES, MEDIA_CACHE_CONTROL } from "../src/media";
import type { Env, Repository } from "../src/types";

const DEV_TOKEN = "local-test-token-that-is-long-enough";
const ORIGIN = "http://localhost:8787";

interface TestApp {
  fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response>;
}

interface StoredObject {
  bytes: Uint8Array;
  metadata: unknown;
}

function bytesFrom(value: Parameters<KVNamespace["put"]>[1]): Promise<Uint8Array> {
  if (typeof value === "string") return Promise.resolve(new TextEncoder().encode(value));
  if (value === null) return Promise.resolve(new Uint8Array());
  if (value instanceof Blob) return value.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  if (value instanceof ReadableStream) {
    return new Response(value).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  if (ArrayBuffer.isView(value)) {
    return Promise.resolve(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
  }
  return Promise.resolve(new Uint8Array(value));
}

class MemoryKV {
  readonly objects = new Map<string, StoredObject>();
  readonly getWithMetadata = vi.fn(async (key: string): Promise<{
    value: ArrayBuffer | null;
    metadata: unknown;
    cacheStatus: string | null;
  }> => {
    const stored = this.objects.get(key);
    if (!stored) return { value: null, metadata: null, cacheStatus: null };
    return { value: stored.bytes.slice().buffer, metadata: stored.metadata, cacheStatus: null };
  });

  readonly put = vi.fn(async (
    key: string,
    value: Parameters<KVNamespace["put"]>[1],
    options?: KVNamespacePutOptions,
  ): Promise<void> => {
    const bytes = await bytesFrom(value);
    this.objects.set(key, { bytes, metadata: options?.metadata ?? null });
  });

  readonly delete = vi.fn(async (key: string): Promise<void> => {
    this.objects.delete(key);
  });

  namespace(): KVNamespace {
    return {
      getWithMetadata: this.getWithMetadata,
      put: this.put,
      delete: this.delete
    } as unknown as KVNamespace;
  }
}

function makeEnv(media: MemoryKV): Env {
  return {
    DB: {} as D1Database,
    MEDIA: media.namespace(),
    ANALYTICS_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true }))
    } as unknown as RateLimit,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ENVIRONMENT: "development",
    ADMIN_ORIGIN: ORIGIN,
    MEDIA_PUBLIC_ORIGIN: "https://api.qixuan.net",
    DEV_BEARER_TOKEN: DEV_TOKEN
  };
}

function authHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${DEV_TOKEN}`);
  return headers;
}

async function csrfFor(app: TestApp, env: Env): Promise<string> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/v1/admin/session`, { headers: authHeaders() }),
    env,
    {} as ExecutionContext,
  );
  const body = await response.json() as { data: { csrfToken: string } };
  return body.data.csrfToken;
}

function multipartRequest(
  path: string,
  csrf: string,
  files: Array<{ bytes: Uint8Array; name: string; type: string; field?: string }>,
): Request {
  const form = new FormData();
  for (const file of files) {
    form.append(
      file.field ?? "file",
      new File([file.bytes.slice().buffer as ArrayBuffer], file.name, { type: file.type }),
    );
  }
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: authHeaders({ Origin: ORIGIN, "X-CSRF-Token": csrf }),
    body: form
  });
}

const signatures = {
  jpg: {
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    type: "image/jpeg"
  },
  png: {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    type: "image/png"
  },
  webp: {
    bytes: new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8X"),
    type: "image/webp"
  },
  avif: {
    bytes: new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x61, 0x76, 0x69, 0x66,
      0x00, 0x00, 0x00, 0x00,
      0x61, 0x76, 0x69, 0x66,
      0x6d, 0x69, 0x66, 0x31
    ]),
    type: "image/avif"
  },
  gif: {
    bytes: new TextEncoder().encode("GIF89a"),
    type: "image/gif"
  }
} as const;

describe("media API", () => {
  let media: MemoryKV;
  let env: Env;
  let app: TestApp;

  beforeEach(() => {
    media = new MemoryKV();
    env = makeEnv(media);
    app = createApp({ repository: {} as Repository }) as unknown as TestApp;
  });

  it.each(Object.entries(signatures))("accepts a signature-validated %s image", async (extension, image) => {
    const csrf = await csrfFor(app, env);
    const response = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ ...image, name: `cover.${extension}` }]),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as {
      ok: boolean;
      data: { key: string; url: string; contentType: string; size: number; etag: string };
    };

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.data.key).toMatch(new RegExp(`^[0-9a-f]{32}\\.${extension}$`));
    expect(body.data.url).toBe(`https://api.qixuan.net/v1/media/${body.data.key}`);
    expect(body.data.contentType).toBe(image.type);
    expect(body.data.size).toBe(image.bytes.byteLength);
    expect(body.data.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    expect(media.objects.get(body.data.key)?.metadata).toEqual({ etag: body.data.etag });
  });

  it("serves uploaded media with immutable caching, ETag validation, and security headers", async () => {
    const csrf = await csrfFor(app, env);
    const upload = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ ...signatures.png, name: "cover.png" }]),
      env,
      {} as ExecutionContext,
    );
    const uploaded = await upload.json() as { data: { key: string; etag: string } };

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/media/${uploaded.data.key}`),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(signatures.png.bytes);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toBe(uploaded.data.etag);
    expect(response.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const conditional = await app.fetch(
      new Request(`${ORIGIN}/v1/media/${uploaded.data.key}`, {
        headers: { "If-None-Match": `W/${uploaded.data.etag}` }
      }),
      env,
      {} as ExecutionContext,
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(uploaded.data.etag);
    expect(conditional.headers.get("content-type")).toBeNull();
  });

  it("requires admin authentication, exact origin, and CSRF for uploads", async () => {
    const noAuth = new FormData();
    noAuth.append("file", new File([signatures.png.bytes], "cover.png", { type: "image/png" }));
    const unauthenticated = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/media`, { method: "POST", body: noAuth }),
      env,
      {} as ExecutionContext,
    );
    expect(unauthenticated.status).toBe(401);

    const csrf = await csrfFor(app, env);
    const badOrigin = multipartRequest("/v1/admin/media", csrf, [{ ...signatures.png, name: "cover.png" }]);
    badOrigin.headers.set("Origin", "https://evil.example");
    const rejected = await app.fetch(badOrigin, env, {} as ExecutionContext);
    const body = await rejected.json() as { error: { code: string } };
    expect(rejected.status).toBe(403);
    expect(body.error.code).toBe("invalid_origin");
    expect(media.put).not.toHaveBeenCalled();
  });

  it("rejects oversized files before writing to KV", async () => {
    const csrf = await csrfFor(app, env);
    const bytes = new Uint8Array(MAX_MEDIA_BYTES + 1);
    bytes.set(signatures.png.bytes);
    const response = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ bytes, name: "large.png", type: "image/png" }]),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(413);
    expect(body.error.code).toBe("media_too_large");
    expect(media.put).not.toHaveBeenCalled();
  });

  it.each([
    "http://api.qixuan.net",
    "https://user:password@api.qixuan.net",
    "https://api.qixuan.net/media",
    "https://api.qixuan.net?redirect=evil.example"
  ])("rejects an unsafe public media origin before writing to KV: %s", async (origin) => {
    env.MEDIA_PUBLIC_ORIGIN = origin;
    const csrf = await csrfFor(app, env);
    const response = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ ...signatures.png, name: "cover.png" }]),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("media_origin_not_configured");
    expect(media.put).not.toHaveBeenCalled();
  });

  it("rejects SVG and MIME-signature mismatches", async () => {
    const csrf = await csrfFor(app, env);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const disguised = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ bytes: svg, name: "attack.png", type: "image/png" }]),
      env,
      {} as ExecutionContext,
    );
    const disguisedBody = await disguised.json() as { error: { code: string } };
    expect(disguised.status).toBe(415);
    expect(disguisedBody.error.code).toBe("unsupported_image_type");

    const mismatch = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{
        bytes: signatures.png.bytes,
        name: "wrong.jpg",
        type: "image/jpeg"
      }]),
      env,
      {} as ExecutionContext,
    );
    const mismatchBody = await mismatch.json() as { error: { code: string } };
    expect(mismatch.status).toBe(415);
    expect(mismatchBody.error.code).toBe("image_type_mismatch");
    expect(media.put).not.toHaveBeenCalled();
  });

  it("rejects multiple files and path-traversal media keys", async () => {
    const csrf = await csrfFor(app, env);
    const multiple = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [
        { ...signatures.png, name: "one.png" },
        { ...signatures.png, name: "two.png" }
      ]),
      env,
      {} as ExecutionContext,
    );
    const multipleBody = await multiple.json() as { error: { code: string } };
    expect(multiple.status).toBe(400);
    expect(multipleBody.error.code).toBe("invalid_media_form");

    const traversal = await app.fetch(
      new Request(`${ORIGIN}/v1/media/%2e%2e%2fprivate`),
      env,
      {} as ExecutionContext,
    );
    const traversalBody = await traversal.json() as { error: { code: string } };
    expect(traversal.status).toBe(400);
    expect(traversalBody.error.code).toBe("invalid_media_key");
    expect(media.getWithMetadata).not.toHaveBeenCalled();
  });

  it("deletes media only through the authenticated mutation route", async () => {
    const csrf = await csrfFor(app, env);
    const upload = await app.fetch(
      multipartRequest("/v1/admin/media", csrf, [{ ...signatures.gif, name: "loop.gif" }]),
      env,
      {} as ExecutionContext,
    );
    const uploaded = await upload.json() as { data: { key: string } };

    const withoutCsrf = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/media/${uploaded.data.key}`, {
        method: "DELETE",
        headers: authHeaders({ Origin: ORIGIN })
      }),
      env,
      {} as ExecutionContext,
    );
    expect(withoutCsrf.status).toBe(403);
    expect(media.objects.has(uploaded.data.key)).toBe(true);

    const response = await app.fetch(
      new Request(`${ORIGIN}/v1/admin/media/${uploaded.data.key}`, {
        method: "DELETE",
        headers: authHeaders({ Origin: ORIGIN, "X-CSRF-Token": csrf })
      }),
      env,
      {} as ExecutionContext,
    );
    const body = await response.json() as { data: { key: string; deleted: boolean } };
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ key: uploaded.data.key, deleted: true });
    expect(media.objects.has(uploaded.data.key)).toBe(false);

    const missing = await app.fetch(
      new Request(`${ORIGIN}/v1/media/${uploaded.data.key}`),
      env,
      {} as ExecutionContext,
    );
    const missingBody = await missing.json() as { error: { code: string } };
    expect(missing.status).toBe(404);
    expect(missingBody.error.code).toBe("media_not_found");
  });
});
