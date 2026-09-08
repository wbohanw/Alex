import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory } from "./db";

let dir: string;
let memory: Memory;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alex-db-"));
  memory = new Memory(dir);
});

afterEach(() => {
  memory.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedTask(id = "task-1") {
  return memory.createTask({
    id,
    kind: "work",
    status: "planning",
    owner: "wbohanw",
    repo: "demo",
    installationId: 42,
    issueNumber: 7,
    instructions: "fix the bug",
  });
}

describe("Memory", () => {
  test("creates and fetches a task", () => {
    const task = seedTask();
    expect(task.status).toBe("planning");
    expect(memory.getTask("task-1")?.issueNumber).toBe(7);
    expect(memory.getTask("nope")).toBeNull();
  });

  test("updates only allowed fields and bumps updated_at", () => {
    seedTask();
    const updated = memory.updateTask("task-1", {
      status: "awaiting_approval",
      plan: "1. do it",
      planCommentId: 99,
    });
    expect(updated.status).toBe("awaiting_approval");
    expect(updated.plan).toBe("1. do it");
    expect(updated.planCommentId).toBe(99);
  });

  test("findActiveTaskByIssue skips terminal tasks", () => {
    seedTask();
    expect(memory.findActiveTaskByIssue("wbohanw", "demo", 7)?.id).toBe("task-1");
    memory.updateTask("task-1", { status: "failed" });
    expect(memory.findActiveTaskByIssue("wbohanw", "demo", 7)).toBeNull();
  });

  test("counts active tasks", () => {
    seedTask("a");
    seedTask("b");
    expect(memory.countActiveTasks()).toBe(2);
    memory.updateTask("a", { status: "completed" });
    expect(memory.countActiveTasks()).toBe(1);
  });

  test("records and lists events in order", () => {
    seedTask();
    memory.addEvent("task-1", "phase", "planning started");
    memory.addEvent("task-1", "thought", "reading code");
    const events = memory.listEvents("task-1");
    expect(events.map((e) => e.type)).toEqual(["phase", "thought"]);
  });

  test("settings round-trip", () => {
    expect(memory.getSetting("x")).toBeNull();
    memory.setSetting("x", "1");
    memory.setSetting("x", "2");
    expect(memory.getSetting("x")).toBe("2");
  });
});
