import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../bus";
import { Memory } from "../memory/db";
import { TaskRunner } from "./runner";

let dir: string;
let memory: Memory;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alex-runner-"));
  memory = new Memory(dir);
});

afterEach(() => {
  memory.close();
  rmSync(dir, { recursive: true, force: true });
});

function config(workspaceRoot?: string): any {
  return {
    taskTimeoutMs: 5_000,
    maxConcurrentTasks: 3,
    github: { appSlug: "alex" },
    opencode: { workspaceRoot },
  };
}

function github(comments: string[]): any {
  return {
    commentOnIssue: async (_ref: unknown, _issue: number, body: string) => {
      comments.push(body);
      return { id: comments.length, html_url: "https://example.test/comment" };
    },
    getIssue: async () => ({ title: "Bug", body: "Fix it" }),
    getRepo: async () => ({ default_branch: "main" }),
  };
}

describe("TaskRunner lifecycle", () => {
  test("a stopped planning task cannot post a plan or become active again", async () => {
    const comments: string[] = [];
    let promptStarted!: () => void;
    const started = new Promise<void>((resolve) => (promptStarted = resolve));
    const opencode: any = {
      createSession: async () => "session-1",
      waitForIdle: async (_id: string, _dir: string, _onEvent: unknown, signal: AbortSignal) =>
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
      sendPrompt: async (_id: string, _dir: string, _prompt: string, _options: unknown, signal: AbortSignal) => {
        promptStarted();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      },
      abort: async () => {},
      lastAssistantText: async () => "## Plan\n\n1. Change code",
    };
    const workspaces: any = {
      create: async () => ({ dir: join(dir, "workspaces", "task") }),
      createReview: async () => ({ dir: join(dir, "workspaces", "task") }),
      get: () => join(dir, "workspaces", "task"),
      remove: () => {},
    };
    const runner = new TaskRunner(config(), memory, new EventBus(), {} as any, opencode, workspaces);
    (runner as any).github = () => github(comments);

    const work = runner.startWork({
      installationId: 1,
      owner: "owner",
      repo: "repo",
      issueNumber: 1,
      instructions: "fix it",
    });
    await started;
    const task = memory.listActiveTasks()[0]!;
    await runner.stop(task.id);
    await work;

    expect(memory.getTask(task.id)?.status).toBe("stopped");
    expect(memory.getTask(task.id)?.plan).toBeNull();
    expect(comments).toHaveLength(1);
  });

  test("a timed-out session is aborted remotely and fails the task", async () => {
    const comments: string[] = [];
    let aborts = 0;
    const opencode: any = {
      createSession: async () => "session-1",
      waitForIdle: async (_id: string, _dir: string, _onEvent: unknown, signal: AbortSignal) =>
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
      sendPrompt: async (_id: string, _dir: string, _prompt: string, _options: unknown, signal: AbortSignal) =>
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      abort: async () => {
        aborts++;
      },
    };
    const workspaces: any = {
      create: async () => ({ dir: join(dir, "workspaces", "task") }),
      createReview: async () => ({ dir: join(dir, "workspaces", "task") }),
      get: () => join(dir, "workspaces", "task"),
      remove: () => {},
    };
    const runner = new TaskRunner(
      { ...config(), taskTimeoutMs: 10 },
      memory,
      new EventBus(),
      {} as any,
      opencode,
      workspaces,
    );
    (runner as any).github = () => github(comments);

    await runner.startWork({
      installationId: 1,
      owner: "owner",
      repo: "repo",
      issueNumber: 1,
      instructions: "fix it",
    });

    expect(memory.listTasks()[0]?.status).toBe("failed");
    expect(memory.listTasks()[0]?.error).toContain("timed out");
    expect(aborts).toBe(1);
    expect(comments).toHaveLength(2);
  });

  test("uses the shared server-side workspace path for OpenCode", async () => {
    const directories: string[] = [];
    const comments: string[] = [];
    const opencode: any = {
      createSession: async (_title: string, directory: string) => {
        directories.push(directory);
        return "session-1";
      },
      waitForIdle: async (_id: string, directory: string, _onEvent: unknown, signal: AbortSignal) => {
        directories.push(directory);
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
      sendPrompt: async (_id: string, directory: string) => directories.push(directory),
      lastAssistantText: async (_id: string, directory: string) => {
        directories.push(directory);
        return "## Plan\n\n1. Change code";
      },
    };
    const localDir = join(dir, "workspaces", "task-1");
    const workspaces: any = {
      create: async () => ({ dir: localDir }),
      createReview: async () => ({ dir: localDir }),
      get: () => localDir,
      remove: () => {},
    };
    const runner = new TaskRunner(
      config("/mnt/alex-workspaces"),
      memory,
      new EventBus(),
      {} as any,
      opencode,
      workspaces,
    );
    (runner as any).github = () => github(comments);

    await runner.startWork({
      installationId: 1,
      owner: "owner",
      repo: "repo",
      issueNumber: 1,
      instructions: "fix it",
    });

    expect(new Set(directories)).toEqual(new Set(["/mnt/alex-workspaces/task-1"]));
    expect(memory.listTasks()[0]?.status).toBe("awaiting_approval");
  });
});
