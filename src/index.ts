import { EventBus } from "./bus";
import { loadConfig } from "./config";
import { GitHubAppAuth } from "./github/app-auth";
import { createWebhookDispatcher } from "./github/events";
import { logger, setLogLevel } from "./log";
import { Memory } from "./memory/db";
import { OpenCodeClient } from "./opencode/client";
import { startApprovalPoller } from "./orchestrator/approval-poller";
import { TaskRunner } from "./orchestrator/runner";
import { startServer } from "./server";
import { WorkspaceManager } from "./workspace/manager";

const log = logger("main");

async function main(): Promise<void> {
  const config = await loadConfig();
  setLogLevel(config.logLevel);

  const bus = new EventBus();
  const memory = new Memory(config.dataDir);
  const auth = new GitHubAppAuth(config.github.appId, config.github.privateKey);
  const opencode = new OpenCodeClient(config.opencode.url, config.opencode.password);
  const workspaces = new WorkspaceManager(config.dataDir, auth);
  const runner = new TaskRunner(config, memory, bus, auth, opencode, workspaces);

  const dispatch = createWebhookDispatcher(memory, runner, config.github.appSlug);
  const stopPoller = startApprovalPoller(memory, runner, auth);

  const server = startServer({ config, onWebhook: dispatch });

  const shutdown = () => {
    log.info("Shutting down");
    stopPoller();
    server.stop();
    memory.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("Fatal startup error", err);
  process.exit(1);
});
