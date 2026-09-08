import type { Config } from "../config";
import type { EventBus } from "../bus";
import type { GitHubAppAuth } from "../github/app-auth";
import { GitHubClient, type RepoRef } from "../github/api";
import type { Memory, TaskRecord } from "../memory/db";
import type { OpenCodeClient, SessionEvent } from "../opencode/client";
import type { WorkspaceManager } from "../workspace/manager";
import { basename, join } from "node:path";
import { logger } from "../log";
import { buildPrompt, planCommentBody, planPrompt, reviewPrompt, revisePrompt } from "./prompts";

const log = logger("runner");

export interface StartWorkParams {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  instructions: string;
}

export interface StartReviewParams extends StartWorkParams {
  prNumber: number;
}

export class TaskRunner {
  private controllers = new Map<string, AbortController>();

  constructor(
    private readonly config: Config,
    private readonly memory: Memory,
    private readonly bus: EventBus,
    private readonly auth: GitHubAppAuth,
    private readonly opencode: OpenCodeClient,
    private readonly workspaces: WorkspaceManager,
  ) {}

  private github(installationId: number): GitHubClient {
    return new GitHubClient(this.auth, installationId);
  }

  private note(task: TaskRecord, type: string, message: string): void {
    this.memory.addEvent(task.id, type, message);
    this.bus.emit("task.event", { type, message }, task.id);
  }

  private setStatus(task: TaskRecord, status: TaskRecord["status"], patch: Partial<TaskRecord> = {}): TaskRecord {
    const updated = this.memory.updateTask(task.id, { ...patch, status });
    this.bus.emit("task.status", { status }, task.id);
    return updated;
  }

  /** Entry point for "@alex <do something>" on an issue. */
  async startWork(params: StartWorkParams): Promise<void> {
    const { installationId, owner, repo, issueNumber } = params;
    const gh = this.github(installationId);
    const ref: RepoRef = { owner, repo };

    if (this.memory.findActiveTaskByIssue(owner, repo, issueNumber)) {
      await gh.commentOnIssue(ref, issueNumber, "I already have an active task on this thread — reply there, or `stop` it first.");
      return;
    }
    if (this.memory.countActiveTasks() >= this.config.maxConcurrentTasks) {
      await gh.commentOnIssue(ref, issueNumber, "I'm at my concurrency limit right now — please try again shortly.");
      return;
    }

    const nonce = Date.now().toString(36);
    const taskId = `${owner}-${repo}-${issueNumber}-${nonce}`;
    const branch = `alex/issue-${issueNumber}-${nonce}`;
    let task = this.memory.createTask({
      id: taskId,
      kind: "work",
      status: "planning",
      owner,
      repo,
      installationId,
      issueNumber,
      branch,
      instructions: params.instructions,
    });
    this.bus.emit("task.created", { task }, taskId);

    try {
      await gh.commentOnIssue(ref, issueNumber, "On it 👋 — I'll explore the repo and post an implementation plan here for approval.");
      this.assertRunning(task.id);
      const issue = await gh.getIssue(ref, issueNumber);
      const repoInfo = await gh.getRepo(ref);
      this.assertRunning(task.id);

      this.note(task, "phase", "Creating workspace");
      const ws = await this.workspaces.create(taskId, installationId, owner, repo, repoInfo.default_branch, branch);
      this.assertRunning(task.id);

      this.note(task, "phase", "Planning");
      const opencodeDir = this.opencodeDirectory(ws.dir);
      const sessionId = await this.opencode.createSession(`plan ${owner}/${repo}#${issueNumber}`, opencodeDir);
      this.assertRunning(task.id);
      task = this.memory.updateTask(taskId, { sessionId });

      await this.runSession(task, sessionId, opencodeDir, planPrompt({
        owner,
        repo,
        issueNumber,
        issueTitle: issue.title,
        issueBody: issue.body ?? "",
        instructions: params.instructions,
      }));

      this.assertRunning(task.id);
      const plan = await this.opencode.lastAssistantText(sessionId, opencodeDir);
      if (!plan) throw new Error("Plan phase produced no output");
      this.assertRunning(task.id);

      const comment = await gh.commentOnIssue(ref, issueNumber, planCommentBody(plan, this.config.github.appSlug));
      this.assertRunning(task.id);
      task = this.setStatus(task, "awaiting_approval", { plan, planCommentId: comment.id });
      this.note(task, "phase", "Plan posted — awaiting approval");
    } catch (err) {
      await this.fail(task, gh, err);
    }
  }

  /** Approval received (reaction, reply, or dashboard). */
  async approve(taskId: string, approvedBy: string): Promise<void> {
    let task = this.memory.getTask(taskId);
    if (!task || task.status !== "awaiting_approval") return;
    const gh = this.github(task.installationId);
    const ref: RepoRef = { owner: task.owner, repo: task.repo };
    const ws = this.workspaces.get(taskId);
    const { sessionId, plan, branch } = task;
    if (!ws || !sessionId || !plan || !branch) {
      await this.fail(task, gh, new Error("Task state incomplete at approval time"));
      return;
    }

    try {
      task = this.setStatus(task, "building");
      this.note(task, "phase", `Plan approved by ${approvedBy} — building`);

      const opencodeDir = this.opencodeDirectory(ws);
      await this.runSession(task, sessionId, opencodeDir, buildPrompt(plan));
      this.assertRunning(task.id);
      const summary = await this.opencode.lastAssistantText(sessionId, opencodeDir);
      this.assertRunning(task.id);

      this.note(task, "phase", "Committing and pushing");
      const committed = await this.workspaces.commitAll(ws, `${task.instructions.slice(0, 72) || `Work on #${task.issueNumber}`}\n\nCloses #${task.issueNumber}`);
      this.assertRunning(task.id);
      if (!committed) throw new Error("Build phase made no changes");
      await this.workspaces.push(ws, task.installationId, task.owner, task.repo, branch);
      this.assertRunning(task.id);

      const repoInfo = await gh.getRepo(ref);
      this.assertRunning(task.id);
      const pr = await gh.createPull(ref, {
        title: `Alex: ${task.instructions.slice(0, 60) || `issue #${task.issueNumber}`}`,
        head: branch,
        base: repoInfo.default_branch,
        draft: true,
        body: `${summary}\n\nCloses #${task.issueNumber}\n\n---\n_Planned and built by Alex. Plan approved by @${approvedBy}._`,
      });
      this.assertRunning(task.id);
      task = this.setStatus(task, "completed", { prNumber: pr.number });
      this.note(task, "phase", `Done — opened PR #${pr.number}`);
      await gh.commentOnIssue(ref, task.issueNumber, `Build complete — opened draft PR ${pr.html_url}. Comment \`@${this.config.github.appSlug} review\` there if you want a self-review pass.`);
      this.workspaces.remove(taskId);
    } catch (err) {
      await this.fail(task, gh, err);
    }
  }

  /** Feedback on a pending plan → revise and repost. */
  async revise(taskId: string, feedback: string): Promise<void> {
    let task = this.memory.getTask(taskId);
    if (!task || task.status !== "awaiting_approval") return;
    const gh = this.github(task.installationId);
    const ws = this.workspaces.get(taskId);
    const { sessionId } = task;
    if (!ws || !sessionId) return;

    try {
      task = this.setStatus(task, "planning");
      this.note(task, "phase", "Revising plan from feedback");
      const opencodeDir = this.opencodeDirectory(ws);
      await this.runSession(task, sessionId, opencodeDir, revisePrompt(feedback));
      this.assertRunning(task.id);
      const plan = await this.opencode.lastAssistantText(sessionId, opencodeDir);
      if (!plan) throw new Error("Revision produced no output");
      this.assertRunning(task.id);

      const comment = await this.github(task.installationId).commentOnIssue(
        { owner: task.owner, repo: task.repo },
        task.issueNumber,
        planCommentBody(plan, this.config.github.appSlug),
      );
      this.assertRunning(task.id);
      task = this.setStatus(task, "awaiting_approval", { plan, planCommentId: comment.id });
      this.note(task, "phase", "Revised plan posted — awaiting approval");
    } catch (err) {
      await this.fail(task, gh, err);
    }
  }

  /** "@alex review" on a pull request. */
  async startReview(params: StartReviewParams): Promise<void> {
    const { installationId, owner, repo, prNumber } = params;
    const gh = this.github(installationId);
    const ref: RepoRef = { owner, repo };

    if (this.memory.findActiveTaskByIssue(owner, repo, prNumber)) {
      await gh.commentOnIssue(ref, prNumber, "I already have an active task on this pull request.");
      return;
    }
    if (this.memory.countActiveTasks() >= this.config.maxConcurrentTasks) {
      await gh.commentOnIssue(ref, prNumber, "I'm at my concurrency limit right now — please try again shortly.");
      return;
    }

    const taskId = `${owner}-${repo}-pr${prNumber}-${Date.now().toString(36)}`;
    let task = this.memory.createTask({
      id: taskId,
      kind: "review",
      status: "reviewing",
      owner,
      repo,
      installationId,
      issueNumber: params.issueNumber,
      prNumber,
      instructions: params.instructions,
    });
    this.bus.emit("task.created", { task }, taskId);

    try {
      const pr = await gh.getPull(ref, prNumber);
      const diff = await gh.getPullDiff(ref, prNumber);
      const repoInfo = await gh.getRepo(ref);
      this.assertRunning(task.id);

      this.note(task, "phase", "Creating review workspace");
      const ws = await this.workspaces.createReview(
        taskId,
        installationId,
        owner,
        repo,
        repoInfo.default_branch,
        prNumber,
      );
      this.assertRunning(task.id);

      this.note(task, "phase", "Reviewing");
      const opencodeDir = this.opencodeDirectory(ws.dir);
      const sessionId = await this.opencode.createSession(`review ${owner}/${repo}#${prNumber}`, opencodeDir);
      this.assertRunning(task.id);
      task = this.memory.updateTask(taskId, { sessionId });

      await this.runSession(task, sessionId, opencodeDir, reviewPrompt(pr.title, pr.body ?? "", truncateDiff(diff), params.instructions));
      this.assertRunning(task.id);
      const review = await this.opencode.lastAssistantText(sessionId, opencodeDir);
      if (!review) throw new Error("Review produced no output");
      this.assertRunning(task.id);

      await gh.createReview(ref, prNumber, { body: review, event: "COMMENT" });
      this.assertRunning(task.id);
      task = this.setStatus(task, "completed");
      this.note(task, "phase", "Review posted");
      this.workspaces.remove(taskId);
    } catch (err) {
      await this.fail(task, gh, err);
    }
  }

  async stop(taskId: string): Promise<void> {
    const task = this.memory.getTask(taskId);
    if (!task || this.memory.isTerminal(task.status)) return;
    this.controllers.get(taskId)?.abort(new Error("Task stopped by maintainer"));
    this.setStatus(task, "stopped");
    this.note(task, "phase", "Stopped by maintainer");
    const ws = this.workspaces.get(taskId);
    if (task.sessionId && ws) await this.opencode.abort(task.sessionId, this.opencodeDirectory(ws));
    this.workspaces.remove(taskId);
  }

  private async runSession(task: TaskRecord, sessionId: string, dir: string, prompt: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Session timed out after ${this.config.taskTimeoutMs}ms`));
      void this.opencode.abort(sessionId, dir);
    }, this.config.taskTimeoutMs);
    const streamController = new AbortController();
    const streamSignal = AbortSignal.any([controller.signal, streamController.signal]);
    const events = this.opencode
      .waitForIdle(sessionId, dir, (evt) => this.onSessionEvent(task, evt), streamSignal)
      .catch((err) => {
        if (!streamSignal.aborted) log.warn(`Event stream failed for task ${task.id}`, err);
      });
    try {
      await this.opencode.sendPrompt(sessionId, dir, prompt, undefined, controller.signal);
      controller.signal.throwIfAborted();
      this.assertRunning(task.id);
    } finally {
      streamController.abort();
      await events;
      clearTimeout(timeout);
      if (this.controllers.get(task.id) === controller) this.controllers.delete(task.id);
    }
  }

  private opencodeDirectory(localDir: string): string {
    const remoteRoot = this.config.opencode.workspaceRoot;
    return remoteRoot ? join(remoteRoot, basename(localDir)) : localDir;
  }

  private assertRunning(taskId: string): void {
    const current = this.memory.getTask(taskId);
    if (!current || this.memory.isTerminal(current.status)) {
      throw new Error("Task is no longer running");
    }
  }

  private lastThoughtAt = new Map<string, number>();

  private onSessionEvent(task: TaskRecord, evt: SessionEvent): void {
    if (evt.type === "message.part.updated") {
      const part = evt.properties?.part;
      if (part?.type === "tool" && part.state?.status === "running") {
        this.note(task, "tool", `${part.tool ?? "tool"}: ${summarize(part.state?.title ?? "")}`);
      } else if (part?.type === "text" && part.text) {
        // Debounce streaming text so the feed isn't flooded per-token.
        const now = Date.now();
        if (now - (this.lastThoughtAt.get(task.id) ?? 0) > 5000) {
          this.lastThoughtAt.set(task.id, now);
          this.note(task, "thought", summarize(part.text));
        }
      }
    }
  }

  private async fail(task: TaskRecord, gh: GitHubClient, err: unknown): Promise<void> {
    const current = this.memory.getTask(task.id);
    if (!current) return;
    if (this.memory.isTerminal(current.status)) {
      if (current.status === "stopped") this.workspaces.remove(task.id);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Task ${task.id} failed: ${message}`);
    this.setStatus(task, "failed", { error: message });
    this.note(task, "error", message);
    try {
      await gh.commentOnIssue(
        { owner: task.owner, repo: task.repo },
        task.issueNumber,
        `I hit a problem and stopped: \`${message.slice(0, 300)}\`\n\nMention me again to retry.`,
      );
    } catch (commentErr) {
      log.error("Also failed to report the failure to GitHub", commentErr);
    }
    this.workspaces.remove(task.id);
  }
}

function summarize(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function truncateDiff(diff: string, maxChars = 60_000): string {
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n... (diff truncated)` : diff;
}
