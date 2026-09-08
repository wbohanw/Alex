import { useState } from "react";
import { api, type Task, type TaskEvent } from "../api";

const WORK_PHASES = ["planning", "awaiting_approval", "building", "completed"] as const;
const PHASE_LABEL: Record<string, string> = {
  planning: "Plan",
  awaiting_approval: "Approval",
  building: "Build",
  completed: "Done",
};

function PhaseTrack({ task }: { task: Task }) {
  if (task.kind === "review") return null;
  const currentIndex =
    task.status === "failed" || task.status === "stopped"
      ? -1
      : WORK_PHASES.indexOf(task.status as (typeof WORK_PHASES)[number]);
  return (
    <div className="phases">
      {WORK_PHASES.map((phase, i) => (
        <span key={phase} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span className="phase-arrow">→</span>}
          <span
            className={`phase${
              currentIndex > i || task.status === "completed" ? " done" : currentIndex === i ? " current" : ""
            }`}
          >
            <span className="dot" />
            {PHASE_LABEL[phase]}
          </span>
        </span>
      ))}
    </div>
  );
}

export function TaskDetail({
  task,
  events,
  onAction,
}: {
  task: Task;
  events: TaskEvent[];
  onAction: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onAction();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const issueUrl = `https://github.com/${task.owner}/${task.repo}/issues/${task.issueNumber}`;
  const prUrl = task.prNumber ? `https://github.com/${task.owner}/${task.repo}/pull/${task.prNumber}` : null;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{task.instructions || "Task"}</h2>
      <div className="meta-row">
        <span>
          <a href={issueUrl} target="_blank" rel="noreferrer">
            {task.owner}/{task.repo}#{task.issueNumber}
          </a>
        </span>
        {task.branch && <span>branch {task.branch}</span>}
        {prUrl && (
          <span>
            <a href={prUrl} target="_blank" rel="noreferrer">
              PR #{task.prNumber}
            </a>
          </span>
        )}
        <span>started {new Date(task.createdAt).toLocaleString()}</span>
      </div>

      <PhaseTrack task={task} />

      {task.error && <div className="error-box">{task.error}</div>}

      {task.status === "awaiting_approval" && (
        <div className="approval-banner">
          <h3>⏸ Waiting for your approval</h3>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Review the plan below, then approve to start the build — or send feedback for a revision.
          </p>
          <div className="approval-actions">
            <button className="approve" disabled={busy} onClick={() => act(() => api.approve(task.id))}>
              ✅ Approve &amp; build
            </button>
            <button className="stop" disabled={busy} onClick={() => act(() => api.stop(task.id))}>
              Stop task
            </button>
          </div>
          <div className="approval-actions">
            <input
              placeholder="Request changes to the plan…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button
              className="revise"
              disabled={busy || !feedback.trim()}
              onClick={() =>
                act(async () => {
                  await api.revise(task.id, feedback);
                  setFeedback("");
                })
              }
            >
              Send feedback
            </button>
          </div>
        </div>
      )}

      {(task.status === "planning" || task.status === "building" || task.status === "reviewing") && (
        <div className="approval-actions" style={{ margin: "16px 0" }}>
          <button className="stop" disabled={busy} onClick={() => act(() => api.stop(task.id))}>
            ⏹ Stop task
          </button>
        </div>
      )}

      {task.plan && (
        <div className="plan-box">
          <h3 style={{ marginTop: 0 }}>Plan</h3>
          <pre>{task.plan}</pre>
        </div>
      )}

      <div className="timeline">
        <h3>
          <span className="live-dot" />
          Activity
        </h3>
        {events.length === 0 && <p style={{ color: "var(--muted)" }}>Nothing yet.</p>}
        {events.map((evt) => (
          <div key={evt.id} className={`event ${evt.type}`}>
            <span className="time">{new Date(evt.createdAt).toLocaleTimeString()}</span>
            <span className="type">{evt.type}</span>
            <span className="msg">{evt.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
