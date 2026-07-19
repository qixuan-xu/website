import { createApp } from "./app";
import { pruneAnalytics } from "./analytics";
import type { Env } from "./types";

const app = createApp();

export default {
  fetch(request, env, context) {
    return app.fetch!(request, env, context);
  },
  async scheduled(_controller, env) {
    await pruneAnalytics(env);
  }
} satisfies ExportedHandler<Env>;

export { createApp } from "./app";
export { D1ContentRepository } from "./repository";
export type { Env } from "./types";
