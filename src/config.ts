import { homedir } from "node:os";
import { resolve } from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  publicBaseUrl: string;
  taskTimeoutMs: number;
  maxConcurrentTasks: number;
  github: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
    appSlug: string;
  };
  oauth: {
    clientId: string;
    clientSecret: string;
    allowedLogins: string[];
  };
  opencode: {
    url: string;
    password?: string;
  };
}

function expandHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2) || ".") : resolve(p);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

async function loadPrivateKey(): Promise<string> {
  const inline = optional("GITHUB_APP_PRIVATE_KEY");
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = optional("GITHUB_APP_PRIVATE_KEY_PATH");
  if (path) return await Bun.file(expandHome(path)).text();
  throw new Error("Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH");
}

export async function loadConfig(): Promise<Config> {
  return {
    port: Number(optional("PORT", "3900")),
    dataDir: expandHome(optional("DATA_DIR", "~/.alex")),
    logLevel: optional("LOG_LEVEL", "info") as Config["logLevel"],
    publicBaseUrl: optional("PUBLIC_BASE_URL", "http://localhost:3900").replace(/\/$/, ""),
    taskTimeoutMs: Number(optional("TASK_TIMEOUT_MS", "900000")),
    maxConcurrentTasks: Number(optional("MAX_CONCURRENT_TASKS", "3")),
    github: {
      appId: required("GITHUB_APP_ID"),
      privateKey: await loadPrivateKey(),
      webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
      appSlug: optional("GITHUB_APP_SLUG", "alex"),
    },
    oauth: {
      clientId: required("GITHUB_OAUTH_CLIENT_ID"),
      clientSecret: required("GITHUB_OAUTH_CLIENT_SECRET"),
      allowedLogins: optional("DASHBOARD_ALLOWED_LOGINS")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    },
    opencode: {
      url: required("OPENCODE_URL").replace(/\/$/, ""),
      password: optional("OPENCODE_PASSWORD") || undefined,
    },
  };
}
