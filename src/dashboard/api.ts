import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { EventBus } from "../bus";
import type { Memory } from "../memory/db";
import type { TaskRunner } from "../orchestrator/runner";
import type { RouteHandler } from "../server";
import type { DashboardAuth } from "./auth";

const UI_DIRS = ["packages/ui/dist", "/usr/local/share/alex/ui"];

/**
 * Dashboard routes: OAuth endpoints are public; /api/* requires a session.
 * GET /api/stream is a single SSE feed of every bus event (task lifecycle,
 * phases, tool activity, thoughts) so the UI stays live without polling.
 */
export function dashboardRoutes(
  memory: Memory,
  runner: TaskRunner,
  bus: EventBus,
  auth: DashboardAuth,
  staticDirOverride?: string,
): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();

  const guard = (handler: RouteHandler): RouteHandler => {
    return (req, url) => {
      const session = auth.authenticate(req);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      (req as any).session = session;
      return handler(req, url);
    };
  };

  routes.set("GET /auth/login", () => auth.loginRedirect());
  routes.set("GET /auth/callback", (_req, url) => auth.handleCallback(url));
  routes.set("POST /auth/logout", (req) => auth.logout(req));

  routes.set(
    "GET /api/me",
    guard((req) => Response.json({ user: (req as any).session })),
  );

  routes.set(
    "GET /api/tasks",
    guard(() => {
      const tasks = memory.listTasks(200);
      return Response.json({
        tasks,
        pendingApprovals: tasks.filter((t) => t.status === "awaiting_approval").length,
        active: tasks.filter((t) => !memory.isTerminal(t.status)).length,
      });
    }),
  );

  routes.set(
    "GET /api/tasks/*",
    guard((req, url) => {
      const rest = url.pathname.slice("/api/tasks/".length);
      const [taskId, action] = rest.split("/", 2);
      if (!taskId) return Response.json({ error: "missing task id" }, { status: 400 });
      const task = memory.getTask(taskId);
      if (!task) return Response.json({ error: "not found" }, { status: 404 });
      if (!action) return Response.json({ task, events: memory.listEvents(taskId) });
      return Response.json({ error: "not found" }, { status: 404 });
    }),
  );

  routes.set(
    "POST /api/tasks/*",
    guard(async (req, url) => {
      const rest = url.pathname.slice("/api/tasks/".length);
      const [taskId, action] = rest.split("/", 2);
      if (!taskId) return Response.json({ error: "missing task id" }, { status: 400 });
      const task = memory.getTask(taskId);
      if (!task) return Response.json({ error: "not found" }, { status: 404 });
      const login: string = (req as any).session.login;

      if (action === "approve") {
        if (task.status !== "awaiting_approval") {
          return Response.json({ error: `task is ${task.status}, not awaiting approval` }, { status: 409 });
        }
        // Fire-and-forget: the build phase is long; the UI follows via SSE.
        void runner.approve(taskId, login);
        return Response.json({ ok: true });
      }
      if (action === "stop") {
        await runner.stop(taskId);
        return Response.json({ ok: true });
      }
      if (action === "revise") {
        const body = (await req.json().catch(() => ({}))) as { feedback?: string };
        if (!body.feedback?.trim()) {
          return Response.json({ error: "feedback required" }, { status: 400 });
        }
        void runner.revise(taskId, body.feedback);
        return Response.json({ ok: true });
      }
      return Response.json({ error: "unknown action" }, { status: 404 });
    }),
  );

  routes.set(
    "GET /api/stream",
    guard((req) => {
      let unsubscribe = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (data: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          send({ type: "hello", at: new Date().toISOString() });
          unsubscribe = bus.subscribe(send);
          const ping = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              clearInterval(ping);
            }
          }, 25_000);
          req.signal.addEventListener("abort", () => {
            clearInterval(ping);
            unsubscribe();
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          unsubscribe();
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }),
  );

  // Static dashboard assets with SPA fallback; public (the app itself gates on /api/me).
  const staticDir = [staticDirOverride, ...UI_DIRS].filter(Boolean).find((d) => existsSync(d!));
  routes.set("GET /*", async (_req, url) => {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      return new Response("Not found", { status: 404 });
    }
    if (!staticDir) {
      return new Response("Dashboard UI not built. Run: bun run build:ui", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(staticDir, safePath === "/" ? "index.html" : safePath);
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(staticDir, "index.html")));
  });

  return routes;
}
