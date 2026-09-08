import type { GitHubAppAuth } from "../github/app-auth";
import { GitHubClient } from "../github/api";
import { APPROVAL_REACTIONS } from "../github/mentions";
import type { Memory } from "../memory/db";
import type { TaskRunner } from "./runner";
import { logger } from "../log";

const log = logger("approval-poller");

/**
 * GitHub sends no webhook for comment reactions, so while any task is
 * awaiting approval we poll its plan comment for a 👍/🚀/❤️/🎉 from a human.
 * Cheap: one reactions request per pending task per tick, and no requests
 * at all when nothing is pending.
 */
export function startApprovalPoller(
  memory: Memory,
  runner: TaskRunner,
  auth: GitHubAppAuth,
  intervalMs = 30_000,
): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const pending = memory.listActiveTasks().filter(
        (t) => t.status === "awaiting_approval" && t.planCommentId,
      );
      for (const task of pending) {
        try {
          const gh = new GitHubClient(auth, task.installationId);
          const reactions = await gh.getCommentReactions(
            { owner: task.owner, repo: task.repo },
            task.planCommentId!,
          );
          const approver = reactions.find(
            (r) => APPROVAL_REACTIONS.has(r.content) && !r.user.login.endsWith("[bot]"),
          );
          if (approver) {
            log.info(`Task ${task.id} approved via ${approver.content} by ${approver.user.login}`);
            await runner.approve(task.id, approver.user.login);
          }
        } catch (err) {
          log.warn(`Reaction poll failed for task ${task.id}`, err);
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
