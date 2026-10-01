import type { Me, Task, TaskEvent } from "./api";

const now = "2026-09-08T14:32:00.000Z";

export const demoMe: Me = {
  login: "wbohanw",
  avatarUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='24' fill='%232f81f7'/%3E%3Ctext x='24' y='31' text-anchor='middle' font-family='Arial' font-size='20' font-weight='700' fill='white'%3EBW%3C/text%3E%3C/svg%3E",
};

export const demoTasks: Task[] = [
  {
    id: "gallery-redesign",
    kind: "work",
    status: "building",
    owner: "wbohanw",
    repo: "personal-web",
    issueNumber: 42,
    prNumber: 57,
    branch: "alex/gallery-redesign",
    instructions: "Redesign the portfolio gallery and verify every project flow",
    plan: "1. Audit the current gallery hierarchy and interaction states.\n2. Rebuild navigation around one focused project at a time.\n3. Add a searchable project index and full-screen case studies.\n4. Run type checks, production build, and visual QA.",
    error: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "job-source-adapter",
    kind: "work",
    status: "awaiting_approval",
    owner: "wbohanw",
    repo: "joku",
    issueNumber: 118,
    prNumber: null,
    branch: "alex/job-source-adapter",
    instructions: "Add a resilient ATS source adapter with human handoff",
    plan: null,
    error: null,
    createdAt: "2026-09-08T13:18:00.000Z",
    updatedAt: now,
  },
  {
    id: "router-cache-tests",
    kind: "work",
    status: "completed",
    owner: "wbohanw",
    repo: "agent-cost-router",
    issueNumber: 16,
    prNumber: 21,
    branch: "alex/cache-tests",
    instructions: "Add deterministic cache and budget-routing tests",
    plan: null,
    error: null,
    createdAt: "2026-09-08T11:04:00.000Z",
    updatedAt: "2026-09-08T12:21:00.000Z",
  },
];

export const demoEvents: TaskEvent[] = [
  { id: 1, taskId: "gallery-redesign", type: "phase", message: "Plan approved by @wbohanw", createdAt: "2026-09-08T14:34:00.000Z" },
  { id: 2, taskId: "gallery-redesign", type: "build", message: "Created isolated workspace and started implementation", createdAt: "2026-09-08T14:35:00.000Z" },
  { id: 3, taskId: "gallery-redesign", type: "build", message: "Rebuilt gallery navigation and project index", createdAt: "2026-09-08T14:41:00.000Z" },
  { id: 4, taskId: "gallery-redesign", type: "check", message: "Type check and production build passed", createdAt: "2026-09-08T14:46:00.000Z" },
  { id: 5, taskId: "gallery-redesign", type: "phase", message: "Running visual verification before updating PR #57", createdAt: now },
];
