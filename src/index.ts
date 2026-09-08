import { loadConfig } from "./config";
import { logger, setLogLevel } from "./log";

const log = logger("main");

async function main(): Promise<void> {
  const config = await loadConfig();
  setLogLevel(config.logLevel);

  const server = Bun.serve({
    port: config.port,
    fetch(req: Request): Response | Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true, name: "alex", version: "0.1.0" });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  log.info(`Alex listening on :${server.port}`);

  const shutdown = () => {
    log.info("Shutting down");
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal startup error", err);
  process.exit(1);
});
