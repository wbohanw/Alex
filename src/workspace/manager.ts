import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GitHubAppAuth } from "../github/app-auth";
import { logger } from "../log";

const log = logger("workspace");

export interface Workspace {
  dir: string;
  branch: string;
  defaultBranch: string;
}

/**
 * One isolated clone per task under <dataDir>/workspaces/<taskId>.
 * Clones over HTTPS using a short-lived installation token; the token is
 * embedded only in the remote URL of the throwaway clone.
 */
export class WorkspaceManager {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly auth: GitHubAppAuth,
  ) {
    this.root = join(dataDir, "workspaces");
    mkdirSync(this.root, { recursive: true });
  }

  async create(
    taskId: string,
    installationId: number,
    owner: string,
    repo: string,
    defaultBranch: string,
    branch: string,
  ): Promise<Workspace> {
    const dir = join(this.root, taskId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

    const token = await this.auth.installationToken(installationId);
    const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

    await git(this.root, ["clone", "--depth", "50", "--branch", defaultBranch, url, taskId]);
    await git(dir, ["config", "user.name", "alex[bot]"]);
    await git(dir, ["config", "user.email", "alex[bot]@users.noreply.github.com"]);
    await git(dir, ["checkout", "-b", branch]);

    log.info(`Workspace ready: ${dir} on ${branch}`);
    return { dir, branch, defaultBranch };
  }

  /** Re-attach to an existing workspace (e.g. build phase after approval). */
  get(taskId: string): string | null {
    const dir = join(this.root, taskId);
    return existsSync(dir) ? dir : null;
  }

  async commitAll(dir: string, message: string): Promise<boolean> {
    await git(dir, ["add", "-A"]);
    const status = await git(dir, ["status", "--porcelain"]);
    if (!status.trim()) return false;
    await git(dir, ["commit", "-m", message]);
    return true;
  }

  async push(dir: string, installationId: number, owner: string, repo: string, branch: string): Promise<void> {
    // Refresh the token at push time; the clone-time token may have expired.
    const token = await this.auth.installationToken(installationId);
    const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    await git(dir, ["push", url, `HEAD:${branch}`, "--force-with-lease"]);
  }

  async diffStat(dir: string): Promise<string> {
    return await git(dir, ["diff", "--stat", "HEAD~1", "HEAD"]).catch(() => "");
  }

  remove(taskId: string): void {
    const dir = join(this.root, taskId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      log.info(`Removed workspace ${dir}`);
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    // Never leak tokens embedded in remote URLs into errors/logs.
    const scrubbed = stderr.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
    throw new Error(`git ${args[0]} failed (${code}): ${scrubbed}`);
  }
  return stdout;
}
