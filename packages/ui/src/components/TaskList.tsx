import type { Task } from "../api";

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  awaiting_approval: "Needs approval",
  building: "Building",
  reviewing: "Reviewing",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return <p style={{ color: "var(--muted)" }}>No tasks yet. Mention the agent on a GitHub issue to get started.</p>;
  }
  return (
    <div>
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`task-card${task.id === selectedId ? " selected" : ""}`}
          onClick={() => onSelect(task.id)}
        >
          <div className="repo">
            {task.owner}/{task.repo} · {task.kind === "review" ? `PR #${task.prNumber ?? task.issueNumber}` : `#${task.issueNumber}`}
          </div>
          <div className="title">{task.instructions || (task.kind === "review" ? "Code review" : "Task")}</div>
          <span className={`badge ${task.status}`}>{STATUS_LABEL[task.status] ?? task.status}</span>
        </div>
      ))}
    </div>
  );
}
