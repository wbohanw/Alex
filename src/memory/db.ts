import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type TaskKind = "work" | "review";
export type TaskStatus =
  | "planning"
  | "awaiting_approval"
  | "building"
  | "reviewing"
  | "completed"
  | "failed"
  | "stopped";

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  owner: string;
  repo: string;
  installationId: number;
  issueNumber: number;
  prNumber: number | null;
  branch: string | null;
  instructions: string;
  plan: string | null;
  planCommentId: number | null;
  sessionId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  type: string;
  message: string;
  createdAt: string;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "stopped"]);

export class Memory {
  private db: Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "alex.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        installation_id INTEGER NOT NULL,
        issue_number INTEGER NOT NULL,
        pr_number INTEGER,
        branch TEXT,
        instructions TEXT NOT NULL,
        plan TEXT,
        plan_comment_id INTEGER,
        session_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_issue ON tasks(owner, repo, issue_number);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  createTask(
    t: Omit<TaskRecord, "createdAt" | "updatedAt" | "plan" | "planCommentId" | "sessionId" | "error" | "prNumber" | "branch"> &
      Partial<Pick<TaskRecord, "prNumber" | "branch">>,
  ): TaskRecord {
    this.db
      .query(
        `INSERT INTO tasks (id, kind, status, owner, repo, installation_id, issue_number, pr_number, branch, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.kind,
        t.status,
        t.owner,
        t.repo,
        t.installationId,
        t.issueNumber,
        t.prNumber ?? null,
        t.branch ?? null,
        t.instructions,
      );
    return this.getTask(t.id)!;
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    return row ? rowToTask(row) : null;
  }

  /** Latest non-terminal task attached to an issue/PR thread. */
  findActiveTaskByIssue(owner: string, repo: string, issueNumber: number): TaskRecord | null {
    const row = this.db
      .query(
        `SELECT * FROM tasks WHERE owner = ? AND repo = ? AND issue_number = ?
         AND status NOT IN ('completed','failed','stopped')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(owner, repo, issueNumber) as any;
    return row ? rowToTask(row) : null;
  }

  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord {
    const allowed: Record<string, string> = {
      status: "status",
      prNumber: "pr_number",
      branch: "branch",
      plan: "plan",
      planCommentId: "plan_comment_id",
      sessionId: "session_id",
      error: "error",
      instructions: "instructions",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        values.push((patch as any)[key] ?? null);
      }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      this.db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(values as any), id);
    }
    return this.getTask(id)!;
  }

  listTasks(limit = 100): TaskRecord[] {
    const rows = this.db
      .query("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map(rowToTask);
  }

  listActiveTasks(): TaskRecord[] {
    const rows = this.db
      .query(
        "SELECT * FROM tasks WHERE status NOT IN ('completed','failed','stopped') ORDER BY created_at DESC",
      )
      .all() as any[];
    return rows.map(rowToTask);
  }

  countActiveTasks(): number {
    const row = this.db
      .query(
        "SELECT COUNT(*) AS n FROM tasks WHERE status NOT IN ('completed','failed','stopped')",
      )
      .get() as any;
    return Number(row?.n ?? 0);
  }

  isTerminal(status: TaskStatus): boolean {
    return TERMINAL.has(status);
  }

  addEvent(taskId: string, type: string, message: string): TaskEvent {
    const res = this.db
      .query("INSERT INTO events (task_id, type, message) VALUES (?, ?, ?) RETURNING *")
      .get(taskId, type, message) as any;
    return rowToEvent(res);
  }

  listEvents(taskId: string, limit = 500): TaskEvent[] {
    const rows = this.db
      .query("SELECT * FROM events WHERE task_id = ? ORDER BY id ASC LIMIT ?")
      .all(taskId, limit) as any[];
    return rows.map(rowToEvent);
  }

  getSetting(key: string): string | null {
    const row = this.db.query("SELECT value FROM settings WHERE key = ?").get(key) as any;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

function rowToTask(row: any): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    owner: row.owner,
    repo: row.repo,
    installationId: row.installation_id,
    issueNumber: row.issue_number,
    prNumber: row.pr_number ?? null,
    branch: row.branch ?? null,
    instructions: row.instructions,
    plan: row.plan ?? null,
    planCommentId: row.plan_comment_id ?? null,
    sessionId: row.session_id ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: any): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    message: row.message,
    createdAt: row.created_at,
  };
}
