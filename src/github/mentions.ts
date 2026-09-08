export type MentionCommand =
  | { kind: "work"; instructions: string }
  | { kind: "review"; instructions: string }
  | { kind: "approve" }
  | { kind: "revise"; feedback: string }
  | { kind: "stop" };

const APPROVE_WORDS = new Set(["approve", "approved", "lgtm", "yes", "go", "ship it", "✅", "👍"]);
const STOP_WORDS = new Set(["stop", "cancel", "abort", "pause", "halt"]);

/**
 * Extracts a command addressed to the app from a comment body.
 * Returns null when the app is not mentioned.
 *
 * Examples (for slug "alex"):
 *   "@alex fix the login bug"        -> work
 *   "@alex review"                   -> review
 *   "@alex approved" / "@alex lgtm"  -> approve
 *   "@alex stop"                     -> stop
 *   "@alex actually use retry logic" -> revise (when a plan is pending)
 */
export function parseMention(body: string | null | undefined, appSlug: string): MentionCommand | null {
  if (!body) return null;
  const mention = new RegExp(`(^|\\s)@${escapeRegExp(appSlug)}(\\[bot\\])?(?![\\w-])`, "i");
  const match = mention.exec(body);
  if (!match) return null;

  const rest = body.slice((match.index ?? 0) + match[0].length).trim();
  const normalized = rest.toLowerCase().replace(/[.!,]+$/, "").trim();

  if (STOP_WORDS.has(normalized)) return { kind: "stop" };
  if (APPROVE_WORDS.has(normalized)) return { kind: "approve" };
  if (normalized === "review" || normalized.startsWith("review ")) {
    return { kind: "review", instructions: rest.slice("review".length).trim() };
  }
  return { kind: "work", instructions: rest };
}

/** Interpret a plain (non-mention) reply on a thread with a pending plan. */
export function parseApprovalReply(body: string | null | undefined): "approve" | "stop" | "feedback" | null {
  if (!body) return null;
  const normalized = body.trim().toLowerCase().replace(/[.!,]+$/, "");
  if (APPROVE_WORDS.has(normalized)) return "approve";
  if (STOP_WORDS.has(normalized)) return "stop";
  return "feedback";
}

export const APPROVAL_REACTIONS = new Set(["+1", "rocket", "heart", "hooray"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
