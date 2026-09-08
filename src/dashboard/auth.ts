import { randomBytes } from "node:crypto";
import type { Config } from "../config";
import { logger } from "../log";

const log = logger("auth");

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

interface DashboardSession {
  login: string;
  avatarUrl: string;
  expiresAt: number;
}

/**
 * Dashboard login via the GitHub App's OAuth credentials.
 * Only logins in DASHBOARD_ALLOWED_LOGINS get a session. Sessions are
 * in-memory httpOnly cookies; a restart just means logging in again.
 */
export class DashboardAuth {
  private sessions = new Map<string, DashboardSession>();
  private pendingStates = new Map<string, number>();

  constructor(private readonly config: Config) {}

  loginRedirect(): Response {
    const state = randomBytes(16).toString("hex");
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.oauth.clientId);
    url.searchParams.set("redirect_uri", `${this.config.publicBaseUrl}/auth/callback`);
    url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  }

  async handleCallback(reqUrl: URL): Promise<Response> {
    const code = reqUrl.searchParams.get("code");
    const state = reqUrl.searchParams.get("state");
    const stateExpiry = state ? this.pendingStates.get(state) : undefined;
    if (state) this.pendingStates.delete(state);
    this.gcStates();
    if (!code || !stateExpiry || stateExpiry < Date.now()) {
      return new Response("Invalid OAuth state", { status: 400 });
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.oauth.clientId,
        client_secret: this.config.oauth.clientSecret,
        code,
      }),
    });
    const tokenBody = (await tokenRes.json()) as { access_token?: string };
    if (!tokenBody.access_token) return new Response("OAuth exchange failed", { status: 401 });

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "alex-agent",
      },
    });
    if (!userRes.ok) return new Response("Failed to fetch GitHub user", { status: 401 });
    const user = (await userRes.json()) as { login: string; avatar_url: string };

    if (!this.config.oauth.allowedLogins.includes(user.login.toLowerCase())) {
      log.warn(`Rejected dashboard login from @${user.login}`);
      return new Response(`@${user.login} is not authorized for this dashboard`, { status: 403 });
    }

    const sessionToken = randomBytes(32).toString("hex");
    this.sessions.set(sessionToken, {
      login: user.login,
      avatarUrl: user.avatar_url,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    log.info(`Dashboard login: @${user.login}`);

    const secure = this.config.publicBaseUrl.startsWith("https") ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": `alex_session=${sessionToken}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${secure}`,
      },
    });
  }

  authenticate(req: Request): DashboardSession | null {
    const token = this.extractToken(req);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  logout(req: Request): Response {
    const token = this.extractToken(req);
    if (token) this.sessions.delete(token);
    return new Response(null, {
      status: 302,
      headers: { location: "/", "set-cookie": "alex_session=; HttpOnly; Path=/; Max-Age=0" },
    });
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    const cookies = req.headers.get("cookie") ?? "";
    const match = /(?:^|;\s*)alex_session=([a-f0-9]+)/.exec(cookies);
    return match?.[1] ?? null;
  }

  private gcStates(): void {
    const now = Date.now();
    for (const [state, expiry] of this.pendingStates) {
      if (expiry < now) this.pendingStates.delete(state);
    }
  }
}
