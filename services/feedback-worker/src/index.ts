import type { Env } from "./env.js";
import { handleRequest } from "./router.js";

export type { Env } from "./env.js";

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env)
} satisfies ExportedHandler<Env>;
