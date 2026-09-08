import { createOpencodeClient } from "@opencode-ai/sdk";
import { logger } from "../log";

const log = logger("opencode");

export interface PromptOptions {
  agent?: string;
  system?: string;
  model?: { providerID: string; modelID: string };
}

export interface SessionEvent {
  type: string;
  properties: any;
}

/**
 * Thin wrapper over the OpenCode SDK pointed at an OpenCode server.
 * The server does the LLM work; Alex only creates sessions, sends prompts,
 * and consumes the event stream.
 */
export class OpenCodeClient {
  private client: ReturnType<typeof createOpencodeClient>;
  private readonly baseUrl: string;
  private readonly authorization?: string;

  constructor(url: string, password?: string) {
    this.baseUrl = url.replace(/\/$/, "");
    this.authorization = password
      ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
      : undefined;
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
      ...(this.authorization
        ? {
            fetch: (req: Request) => {
              const headers = new Headers(req.headers);
              headers.set("authorization", this.authorization!);
              return fetch(new Request(req, { headers }));
            },
          }
        : {}),
    });
  }

  async createSession(title: string, directory: string): Promise<string> {
    const res = await this.client.session.create({
      body: { title },
      query: { directory },
    });
    const id = (res as any)?.data?.id ?? (res as any)?.id;
    if (!id) throw new Error("OpenCode session.create returned no id");
    log.info(`Created OpenCode session ${id} for ${directory}`);
    return String(id);
  }

  async sendPrompt(
    sessionId: string,
    directory: string,
    text: string,
    options?: PromptOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.client.session.prompt({
      path: { id: sessionId },
      query: { directory },
      body: {
        parts: [{ type: "text", text }],
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(options?.system ? { system: options.system } : {}),
        ...(options?.model ? { model: options.model } : {}),
      },
      signal,
    });
  }

  /**
   * Subscribes to the server-wide event stream and invokes `onEvent` for
   * events belonging to `sessionId`. Resolves when the session goes idle or
   * errors, or when `signal` aborts.
   */
  async waitForIdle(
    sessionId: string,
    directory: string,
    onEvent: (evt: SessionEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const events = await this.client.event.subscribe({ query: { directory }, signal });
    for await (const event of (events as any).stream as AsyncIterable<SessionEvent>) {
      if (signal?.aborted) return;
      const sid =
        event.properties?.sessionID ??
        event.properties?.info?.sessionID ??
        event.properties?.part?.sessionID ??
        event.properties?.info?.id;
      if (sid !== sessionId) continue;
      onEvent(event);
      if (event.type === "session.idle") return;
      if (event.type === "session.error") {
        throw new Error(
          `OpenCode session error: ${JSON.stringify(event.properties?.error ?? event.properties)}`,
        );
      }
    }
  }

  /** Returns the text parts of the last assistant message in the session. */
  async lastAssistantText(sessionId: string, directory: string): Promise<string> {
    const res = await this.client.session.messages({
      path: { id: sessionId },
      query: { directory },
    });
    const messages: any[] = (res as any)?.data ?? (res as any) ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.info?.role !== "assistant") continue;
      const text = (m.parts ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
    return "";
  }

  async abort(sessionId: string, directory: string): Promise<void> {
    try {
      await this.client.session.abort({ path: { id: sessionId }, query: { directory } });
    } catch (err) {
      log.warn(`Failed to abort session ${sessionId}`, err);
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this.authorization ? { authorization: this.authorization } : undefined,
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { healthy?: boolean };
      return body.healthy === true;
    } catch {
      return false;
    }
  }
}
