export type TaskStatus =
  | "planning"
  | "awaiting_approval"
  | "building"
  | "reviewing"
  | "completed"
  | "failed"
  | "stopped";

export interface Task {
  id: string;
  kind: "work" | "review";
  status: TaskStatus;
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | null;
  branch: string | null;
  instructions: string;
  plan: string | null;
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

export interface Me {
  login: string;
  avatarUrl: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as any).error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ user: Me }>("/api/me"),
  tasks: () => request<{ tasks: Task[]; pendingApprovals: number; active: number }>("/api/tasks"),
  task: (id: string) => request<{ task: Task; events: TaskEvent[] }>(`/api/tasks/${id}`),
  approve: (id: string) => request<{ ok: true }>(`/api/tasks/${id}/approve`, { method: "POST" }),
  stop: (id: string) => request<{ ok: true }>(`/api/tasks/${id}/stop`, { method: "POST" }),
  revise: (id: string, feedback: string) =>
    request<{ ok: true }>(`/api/tasks/${id}/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedback }),
    }),
};

export function subscribeStream(onEvent: (evt: any) => void): () => void {
  const source = new EventSource("/api/stream");
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
