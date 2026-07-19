import { ApiError } from "./errors";
import type { Env } from "./types";

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_MULTIPART_BYTES = MAX_MEDIA_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

interface MediaFormat {
  contentType: string;
  extension: "jpg" | "png" | "webp" | "avif" | "gif";
}

interface MediaMetadata {
  etag: string;
}

const FORMATS_BY_EXTENSION: Record<MediaFormat["extension"], MediaFormat> = {
  jpg: { contentType: "image/jpeg", extension: "jpg" },
  png: { contentType: "image/png", extension: "png" },
  webp: { contentType: "image/webp", extension: "webp" },
  avif: { contentType: "image/avif", extension: "avif" },
  gif: { contentType: "image/gif", extension: "gif" }
};

const EXTENSION_BY_CONTENT_TYPE = new Map(
  Object.values(FORMATS_BY_EXTENSION).map((format) => [format.contentType, format.extension]),
);

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset + expected.length > bytes.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function detectAvif(bytes: Uint8Array, fileSize: number): boolean {
  if (bytes.length < 16 || !hasAscii(bytes, 4, "ftyp")) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize < 16 || boxSize > fileSize) return false;
  const inspectedLength = Math.min(boxSize, bytes.length);
  for (let offset = 8; offset + 4 <= inspectedLength; offset += 4) {
    if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) return true;
  }
  return false;
}

function detectFormat(bytes: Uint8Array, fileSize: number): MediaFormat | null {
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return FORMATS_BY_EXTENSION.jpg;
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return FORMATS_BY_EXTENSION.png;
  }
  if (
    hasAscii(bytes, 0, "RIFF") &&
    hasAscii(bytes, 8, "WEBP") &&
    (["VP8 ", "VP8L", "VP8X"] as const).some((chunk) => hasAscii(bytes, 12, chunk))
  ) {
    return FORMATS_BY_EXTENSION.webp;
  }
  if (detectAvif(bytes, fileSize)) return FORMATS_BY_EXTENSION.avif;
  if (hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")) {
    return FORMATS_BY_EXTENSION.gif;
  }
  return null;
}

async function readRequestBody(request: Request): Promise<ArrayBuffer> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    throw new ApiError(413, "media_too_large", `Image files must be at most ${MAX_MEDIA_BYTES} bytes`);
  }
  if (!request.body) {
    throw new ApiError(400, "invalid_media_form", "Multipart form must contain one file field named 'file'");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "media_too_large", `Image files must be at most ${MAX_MEDIA_BYTES} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function readSingleImage(request: Request): Promise<{ file: File; format: MediaFormat }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "multipart/form-data") {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be multipart/form-data");
  }

  const body = await readRequestBody(request);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new ApiError(400, "invalid_media_form", "Request body is not valid multipart form data");
  }

  const files: Array<{ field: string; file: File }> = [];
  for (const [field, value] of form.entries()) {
    if (typeof value !== "string") files.push({ field, file: value });
  }
  if (files.length !== 1 || files[0]?.field !== "file") {
    throw new ApiError(400, "invalid_media_form", "Multipart form must contain one file field named 'file'");
  }

  const file = files[0].file;
  if (file.size === 0) {
    throw new ApiError(422, "empty_media", "Image file must not be empty");
  }
  if (file.size > MAX_MEDIA_BYTES) {
    throw new ApiError(413, "media_too_large", `Image files must be at most ${MAX_MEDIA_BYTES} bytes`);
  }

  const signature = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const format = detectFormat(signature, file.size);
  if (!format) {
    throw new ApiError(
      415,
      "unsupported_image_type",
      "Only JPEG, PNG, WebP, AVIF, and GIF images are supported",
    );
  }

  const declaredType = file.type.trim().toLowerCase();
  const declaredExtension = EXTENSION_BY_CONTENT_TYPE.get(declaredType);
  if (declaredType && declaredType !== "application/octet-stream" && declaredExtension !== format.extension) {
    throw new ApiError(415, "image_type_mismatch", "Image MIME type does not match its file signature");
  }
  return { file, format };
}

function mediaStore(env: Env): KVNamespace {
  if (!env.MEDIA) {
    throw new ApiError(500, "media_not_configured", "Media storage is not configured");
  }
  return env.MEDIA;
}

function mediaPublicOrigin(env: Env): string {
  const configured = env.MEDIA_PUBLIC_ORIGIN?.trim();
  if (!configured) {
    throw new ApiError(500, "media_origin_not_configured", "Public media origin is not configured");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(500, "media_origin_not_configured", "Public media origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    configured.replace(/\/$/, "") !== url.origin
  ) {
    throw new ApiError(
      500,
      "media_origin_not_configured",
      "Public media origin must be an HTTPS origin without credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

function mediaKeyFor(format: MediaFormat): string {
  return `${crypto.randomUUID().replaceAll("-", "")}.${format.extension}`;
}

async function mediaEtag(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `"sha256-${hex}"`;
}

function formatForKey(key: string): MediaFormat {
  const match = /^[0-9a-f]{32}\.(jpg|png|webp|avif|gif)$/.exec(key);
  const extension = match?.[1] as MediaFormat["extension"] | undefined;
  if (!extension) {
    throw new ApiError(400, "invalid_media_key", "Media key is invalid");
  }
  return FORMATS_BY_EXTENSION[extension];
}

function ifNoneMatchMatches(request: Request, etag: string): boolean {
  const value = request.headers.get("if-none-match");
  if (!value) return false;
  const normalizedEtag = etag.replace(/^W\//, "");
  return value.split(",").some((candidate) => {
    const normalizedCandidate = candidate.trim().replace(/^W\//, "");
    return normalizedCandidate === "*" || normalizedCandidate === normalizedEtag;
  });
}

export async function uploadMedia(request: Request, env: Env): Promise<Record<string, unknown>> {
  const { file, format } = await readSingleImage(request);
  const publicOrigin = mediaPublicOrigin(env);
  const key = mediaKeyFor(format);
  const bytes = await file.arrayBuffer();
  const etag = await mediaEtag(bytes);
  await mediaStore(env).put(key, bytes, {
    metadata: { etag } satisfies MediaMetadata
  });
  return {
    key,
    url: `${publicOrigin}/v1/media/${key}`,
    contentType: format.contentType,
    size: file.size,
    etag
  };
}

export async function deleteMedia(key: string, env: Env): Promise<Record<string, unknown>> {
  formatForKey(key);
  await mediaStore(env).delete(key);
  return { key, deleted: true };
}

export async function publicMediaResponse(request: Request, key: string, env: Env): Promise<Response> {
  const format = formatForKey(key);
  const stored = await mediaStore(env).getWithMetadata<MediaMetadata>(key, "arrayBuffer");
  if (!stored.value) {
    throw new ApiError(404, "media_not_found", "Requested media was not found");
  }
  const etag = stored.metadata && /^"sha256-[0-9a-f]{64}"$/.test(stored.metadata.etag)
    ? stored.metadata.etag
    : await mediaEtag(stored.value);

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": MEDIA_CACHE_CONTROL,
    "Content-Disposition": "inline",
    "Content-Length": String(stored.value.byteLength),
    "Content-Type": format.contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    ETag: etag
  });
  if (ifNoneMatchMatches(request, etag)) {
    headers.delete("Content-Length");
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(stored.value, { headers });
}
