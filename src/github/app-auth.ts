import { createSign } from "node:crypto";
import { logger } from "../log";

const log = logger("github-auth");

const API = "https://api.github.com";

interface InstallationToken {
  token: string;
  expiresAt: number;
}

/**
 * GitHub App authentication without external deps:
 * short-lived RS256 JWTs signed with the app private key, exchanged for
 * per-installation access tokens which are cached until near expiry.
 */
export class GitHubAppAuth {
  private tokenCache = new Map<number, InstallationToken>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
  ) {}

  appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    // iat backdated 60s to tolerate clock drift, per GitHub docs.
    const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.appId }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(this.privateKey, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 120_000) return cached.token;

    const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.appJwt()}`,
        accept: "application/vnd.github+json",
        "user-agent": "alex-agent",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to mint installation token (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as { token: string; expires_at: string };
    this.tokenCache.set(installationId, {
      token: body.token,
      expiresAt: new Date(body.expires_at).getTime(),
    });
    log.debug(`Minted installation token for installation ${installationId}`);
    return body.token;
  }
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
