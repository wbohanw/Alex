import { describe, expect, test } from "bun:test";
import { createWebhookDispatcher } from "./events";

function makeFakes(activeTask: any = null) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const record = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };
  const memory = { findActiveTaskByIssue: () => activeTask } as any;
  const runner = {
    startWork: record("startWork"),
    startReview: record("startReview"),
    approve: record("approve"),
    revise: record("revise"),
    stop: record("stop"),
  } as any;
  return { memory, runner, calls };
}

function delivery(body: string, opts: { isPr?: boolean; senderType?: string } = {}) {
  return {
    event: "issue_comment",
    deliveryId: "d1",
    payload: {
      action: "created",
      sender: { login: "wbohanw", type: opts.senderType ?? "User" },
      installation: { id: 1 },
      repository: { name: "demo", owner: { login: "wbohanw" } },
      issue: { number: 5, ...(opts.isPr ? { pull_request: {} } : {}) },
      comment: { body },
    },
  };
}

describe("webhook dispatcher", () => {
  test("mention on an issue starts work", async () => {
    const { memory, runner, calls } = makeFakes();
    await createWebhookDispatcher(memory, runner, "alex")(delivery("@alex fix the bug"));
    expect(calls).toEqual([
      {
        method: "startWork",
        args: [{ installationId: 1, owner: "wbohanw", repo: "demo", issueNumber: 5, instructions: "fix the bug" }],
      },
    ]);
  });

  test("review mention on a PR starts a review", async () => {
    const { memory, runner, calls } = makeFakes();
    await createWebhookDispatcher(memory, runner, "alex")(delivery("@alex review", { isPr: true }));
    expect(calls[0]?.method).toBe("startReview");
    expect(calls[0]?.args[0].prNumber).toBe(5);
  });

  test("plain 'approved' reply approves a pending plan", async () => {
    const pending = { id: "t1", status: "awaiting_approval" };
    const { memory, runner, calls } = makeFakes(pending);
    await createWebhookDispatcher(memory, runner, "alex")(delivery("approved"));
    expect(calls).toEqual([{ method: "approve", args: ["t1", "wbohanw"] }]);
  });

  test("plain feedback reply requests a revision", async () => {
    const pending = { id: "t1", status: "awaiting_approval" };
    const { memory, runner, calls } = makeFakes(pending);
    await createWebhookDispatcher(memory, runner, "alex")(delivery("use a queue instead of polling"));
    expect(calls).toEqual([{ method: "revise", args: ["t1", "use a queue instead of polling"] }]);
  });

  test("bot comments are ignored", async () => {
    const { memory, runner, calls } = makeFakes();
    await createWebhookDispatcher(memory, runner, "alex")(delivery("@alex fix it", { senderType: "Bot" }));
    expect(calls).toEqual([]);
  });

  test("plain replies on threads without pending plans are ignored", async () => {
    const { memory, runner, calls } = makeFakes();
    await createWebhookDispatcher(memory, runner, "alex")(delivery("nice work everyone"));
    expect(calls).toEqual([]);
  });
});
