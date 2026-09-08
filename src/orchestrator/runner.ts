import type { Config } from "../config";
import type { EventBus } from "../bus";
import type { GitHubAppAuth } from "../github/app-auth";
import { GitHubClient, type RepoRef } from "../github/api";
import type { Memory, TaskRecord } from "../memory/db";
import type { OpenCodeClient, SessionEvent } from "../opencode/client";
import type { WorkspaceManager } from "../workspace/manager";
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
  private stopping = new Set<string>();

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

    const taskId = `${owner}-${repo}-${issueNumber}-${Date.now().toString(36)}`;
    const branch = `alex/issue-${issueNumber}`;
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
      const issue = await gh.getIssue(ref, issueNumber);
      const repoInfo = await gh.getRepo(ref);

      this.note(task, "phase", "Creating workspace");
      const ws = await this.workspaces.create(taskId, installationId, owner, repo, repoInfo.default_branch, branch);

      this.note(task, "phase", "Planning");
      const sessionId = await this.opencode.createSession(`plan ${owner}/${repo}#${issueNumber}`, ws.dir);
      task = this.memory.updateTask(taskId, { sessionId });

      await this.runSession(task, sessionId, ws.dir, planPrompt({
        owner,
        repo,
        issueNumber,
        issueTitle: issue.title,
        issueBody: issue.body ?? "",
        instructions: params.instructions,
      }));

      const plan = await this.opencode.lastAssistantText(sessionId, ws.dir);
      if (!plan) throw new Error("Plan phase produced no output");

      const comment = await gh.commentOnIssue(ref, issueNumber, planCommentBody(plan, this.config.github.appSlug));
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

      await this.runSession(task, sessionId, ws, buildPrompt(plan));
      const summary = await this.opencode.lastAssistantText(sessionId, ws);

      this.note(task, "phase", "Committing and pushing");
      const committed = await this.workspaces.commitAll(ws, `${task.instructions.slice(0, 72) || `Work on #${task.issueNumber}`}\n\nCloses #${task.issueNumber}`);
      if (!committed) throw new Error("Build phase made no changes");
      await this.workspaces.push(ws, task.installationId, task.owner, task.repo, branch);

      const repoInfo = await gh.getRepo(ref);
      const pr = await gh.createPull(ref, {
        title: `Alex: ${task.instructions.slice(0, 60) || `issue #${task.issueNumber}`}`,
        head: branch,
        base: repoInfo.default_branch,
        draft: true,
        body: `${summary}\n\nCloses #${task.issueNumber}\n\n---\n_Planned and built by Alex. Plan approved by @${approvedBy}._`,
      });
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
      await this.runSession(task, sessionId, ws, revisePrompt(feedback));
      const plan = await this.opencode.lastAssistantText(sessionId, ws);
      if (!plan) throw new Error("Revision produced no output");

      const comment = await this.github(task.installationId).commentOnIssue(
        { owner: task.owner, repo: task.repo },
        task.issueNumber,
        planCommentBody(plan, this.config.github.appSlug),
      );
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

      this.note(task, "phase", "Creating review workspace");
      const ws = await this.workspaces.create(taskId, installationId, owner, repo, repoInfo.default_branch, `alex/review-${prNumber}`);

      this.note(task, "phase", "Reviewing");
      const sessionId = await this.opencode.createSession(`review ${owner}/${repo}#${prNumber}`, ws.dir);
      task = this.memory.updateTask(taskId, { sessionId });

      await this.runSession(task, sessionId, ws.dir, reviewPrompt(pr.title, pr.body ?? "", truncateDiff(diff), params.instructions));
      const review = await this.opencode.lastAssistantText(sessionId, ws.dir);
      if (!review) throw new Error("Review produced no output");

      await gh.createReview(ref, prNumber, { body: review, event: "COMMENT" });
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
    this.stopping.add(taskId);
    const ws = this.workspaces.get(taskId);
    if (task.sessionId && ws) await this.opencode.abort(task.sessionId, ws);
    this.setStatus(task, "stopped");
    this.note(task, "phase", "Stopped by maintainer");
    this.workspaces.remove(taskId);
  }

  private async runSession(task: TaskRecord, sessionId: string, dir: string, prompt: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.taskTimeoutMs);
    try {
      const wait = this.opencode.waitForIdle(sessionId, (evt) => this.onSessionEvent(task, evt), controller.signal);
      await this.opencode.sendPrompt(sessionId, dir, prompt);
      await wait;
      if (controller.signal.aborted) throw new Error(`Session timed out after ${this.config.taskTimeoutMs}ms`);
    } finally {
      clearTimeout(timeout);
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
    if (this.stopping.has(task.id)) return;
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
