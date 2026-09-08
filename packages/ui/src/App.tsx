import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeStream, type Me, type Task, type TaskEvent } from "./api";
import { LoginScreen } from "./components/LoginScreen";
import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState({ active: 0, pendingApprovals: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ task: Task; events: TaskEvent[] } | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const refreshTasks = useCallback(async () => {
    try {
      const res = await api.tasks();
      setTasks(res.tasks);
      setCounts({ active: res.active, pendingApprovals: res.pendingApprovals });
    } catch {
      // stream will retry us
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api.task(id));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((res) => setMe(res.user))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    void refreshTasks();
    const unsubscribe = subscribeStream((evt) => {
      if (evt.type === "task.created" || evt.type === "task.status") void refreshTasks();
      if (evt.taskId && evt.taskId === selectedRef.current) void refreshDetail(evt.taskId);
    });
    return unsubscribe;
  }, [me, refreshTasks, refreshDetail]);

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    else setDetail(null);
  }, [selectedId, refreshDetail]);

  if (me === undefined) return null;
  if (me === null) return <LoginScreen />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <h1>🤖 Alex</h1>
          <div className="user">
            <img src={me.avatarUrl} alt="" />
            {me.login}
          </div>
        </div>
        <div className="counters">
          <div className="counter">
            <b>{counts.active}</b>
            <span>active</span>
          </div>
          <div className="counter">
            <b style={{ color: counts.pendingApprovals > 0 ? "var(--yellow)" : undefined }}>
              {counts.pendingApprovals}
            </b>
            <span>need approval</span>
          </div>
          <div className="counter">
            <b>{tasks.length}</b>
            <span>total</span>
          </div>
        </div>
        <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>
      <main className="main">
        {detail ? (
          <TaskDetail
            task={detail.task}
            events={detail.events}
            onAction={() => {
              void refreshDetail(detail.task.id);
              void refreshTasks();
            }}
          />
        ) : (
          <div className="empty">Select a task to see its plan, phases, and live activity.</div>
        )}
      </main>
    </div>
  );
}
