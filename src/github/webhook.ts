import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../log";

const log = logger("webhook");

export interface WebhookEvent {
  event: string;
  deliveryId: string;
  payload: any;
}

export type WebhookHandler = (evt: WebhookEvent) => Promise<void> | void;

export function verifySignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Parses and verifies a GitHub webhook delivery. Returns a Response to send
 * immediately; if the event is actionable, invokes `handler` fire-and-forget
 * so GitHub gets a fast ack.
 */
export async function handleWebhookRequest(
  req: Request,
  secret: string,
  handler: WebhookHandler,
): Promise<Response> {
  const rawBody = await req.text();
  if (!verifySignature(secret, rawBody, req.headers.get("x-hub-signature-256"))) {
    log.warn("Rejected webhook with bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "unknown";
  const deliveryId = req.headers.get("x-github-delivery") ?? "unknown";

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  Promise.resolve(handler({ event, deliveryId, payload }))
    .catch((err) => log.error(`Webhook handler failed for ${event}/${deliveryId}`, err));

  return Response.json({ ok: true });
}
