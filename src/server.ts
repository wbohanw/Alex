import type { Config } from "./config";
import { handleWebhookRequest, type WebhookHandler } from "./github/webhook";
import { logger } from "./log";

const log = logger("server");

export type RouteHandler = (req: Request, url: URL) => Response | Promise<Response>;

export interface ServerDeps {
  config: Config;
  onWebhook: WebhookHandler;
  /** Extra routes (dashboard API etc.), matched as "METHOD /path" or "METHOD /path/*". */
  routes?: Map<string, RouteHandler>;
}

export function startServer({ config, onWebhook, routes }: ServerDeps) {
  const server = Bun.serve({
    port: config.port,
    idleTimeout: 120,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return Response.json({ ok: true, name: "alex", version: "0.1.0" });
      }
      if (req.method === "POST" && url.pathname === "/webhook/github") {
        return handleWebhookRequest(req, config.github.webhookSecret, onWebhook);
      }

      if (routes) {
        const exact = routes.get(`${req.method} ${url.pathname}`);
        if (exact) return exact(req, url);
        for (const [key, handler] of routes) {
          const [method, pattern] = key.split(" ", 2);
          if (method === req.method && pattern?.endsWith("/*") && url.pathname.startsWith(pattern.slice(0, -1))) {
            return handler(req, url);
          }
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  log.info(`Alex listening on :${server.port}`);
  return server;
}
