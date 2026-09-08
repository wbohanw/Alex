import type { Memory } from "../memory/db";
import type { TaskRunner } from "../orchestrator/runner";
import { parseApprovalReply, parseMention } from "./mentions";
import type { WebhookEvent } from "./webhook";
import { logger } from "../log";

const log = logger("events");

/**
 * Turns verified GitHub webhook deliveries into runner actions.
 *
 * - "@alex <instructions>" on an issue            -> startWork
 * - "@alex review [focus]" on a PR                -> startReview
 * - "@alex approve" / plain "approved" reply      -> approve pending plan
 * - "@alex stop" / plain "stop" reply             -> stop task
 * - any other reply on a thread awaiting approval -> plan revision feedback
 */
export function createWebhookDispatcher(
  memory: Memory,
  runner: TaskRunner,
  appSlug: string,
  canControl: (
    installationId: number,
    owner: string,
    repo: string,
    login: string,
  ) => Promise<boolean>,
) {
  return async function dispatch({ event, payload }: WebhookEvent): Promise<void> {
    if (event !== "issue_comment" || payload.action !== "created") return;

    const senderType = payload.sender?.type;
    const senderLogin: string = payload.sender?.login ?? "unknown";
    if (senderType === "Bot") return; // never react to ourselves or other bots

    const installationId: number | undefined = payload.installation?.id;
    const owner: string | undefined = payload.repository?.owner?.login;
    const repo: string | undefined = payload.repository?.name;
    const issueNumber: number | undefined = payload.issue?.number;
    const body: string = payload.comment?.body ?? "";
    if (!installationId || !owner || !repo || !issueNumber) return;

    const isPullRequest = Boolean(payload.issue?.pull_request);
    const activeTask = memory.findActiveTaskByIssue(owner, repo, issueNumber);
    const mention = parseMention(body, appSlug);

    // Every supported command can spend compute or mutate repository state.
    // Check current repository permission instead of trusting issue visibility
    // or GitHub's coarse author_association field.
    if ((mention || activeTask?.status === "awaiting_approval") &&
        !(await canControl(installationId, owner, repo, senderLogin))) {
      log.warn(`Ignored command from unauthorized user ${senderLogin} on ${owner}/${repo}#${issueNumber}`);
      return;
    }

    if (mention) {
      log.info(`Mention from ${senderLogin} on ${owner}/${repo}#${issueNumber}: ${mention.kind}`);
      switch (mention.kind) {
        case "stop":
          if (activeTask) await runner.stop(activeTask.id);
          return;
        case "approve":
          if (activeTask?.status === "awaiting_approval") {
            await runner.approve(activeTask.id, senderLogin);
          }
          return;
        case "review":
          if (isPullRequest) {
            await runner.startReview({
              installationId,
              owner,
              repo,
              issueNumber,
              prNumber: issueNumber,
              instructions: mention.instructions,
            });
          } else {
            await runner.startWork({ installationId, owner, repo, issueNumber, instructions: body });
          }
          return;
        case "work":
          if (activeTask?.status === "awaiting_approval") {
            // A mention with fresh instructions while a plan is pending is feedback.
            await runner.revise(activeTask.id, mention.instructions);
          } else if (!activeTask) {
            await runner.startWork({
              installationId,
              owner,
              repo,
              issueNumber,
              instructions: mention.instructions,
            });
          }
          return;
      }
    }

    // No mention: plain replies only matter on a thread awaiting approval.
    if (activeTask?.status === "awaiting_approval") {
      const reply = parseApprovalReply(body);
      if (reply === "approve") await runner.approve(activeTask.id, senderLogin);
      else if (reply === "stop") await runner.stop(activeTask.id);
      else if (reply === "feedback") await runner.revise(activeTask.id, body);
    }
  };
}
