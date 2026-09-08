import { loadConfig } from "./config";
import { GitHubAppAuth } from "./github/app-auth";
import { logger, setLogLevel } from "./log";
import { startServer } from "./server";

const log = logger("main");

async function main(): Promise<void> {
  const config = await loadConfig();
  setLogLevel(config.logLevel);

  const auth = new GitHubAppAuth(config.github.appId, config.github.privateKey);
  void auth; // consumed by the task pipeline (wired in a later change)

  const server = startServer({
    config,
    onWebhook: async ({ event, deliveryId }) => {
      log.info(`Webhook received: ${event} (${deliveryId})`);
    },
  });

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
