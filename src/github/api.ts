import type { GitHubAppAuth } from "./app-auth";

const API = "https://api.github.com";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Minimal GitHub REST client scoped to one installation. */
export class GitHubClient {
  constructor(
    private readonly auth: GitHubAppAuth,
    readonly installationId: number,
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.auth.installationToken(this.installationId);
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "alex-agent",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // --- Issues & comments ---

  commentOnIssue(ref: RepoRef, issueNumber: number, body: string) {
    return this.request<{ id: number; html_url: string }>(
      "POST",
      `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  updateComment(ref: RepoRef, commentId: number, body: string) {
    return this.request("PATCH", `/repos/${ref.owner}/${ref.repo}/issues/comments/${commentId}`, {
      body,
    });
  }

  getIssue(ref: RepoRef, issueNumber: number) {
    return this.request<{
      number: number;
      title: string;
      body: string | null;
      labels: Array<{ name: string }>;
      pull_request?: unknown;
    }>("GET", `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}`);
  }

  getCommentReactions(ref: RepoRef, commentId: number) {
    return this.request<Array<{ content: string; user: { login: string } }>>(
      "GET",
      `/repos/${ref.owner}/${ref.repo}/issues/comments/${commentId}/reactions`,
    );
  }

  // --- Pull requests ---

  createPull(
    ref: RepoRef,
    params: { title: string; head: string; base: string; body: string; draft?: boolean },
  ) {
    return this.request<{ number: number; html_url: string }>(
      "POST",
      `/repos/${ref.owner}/${ref.repo}/pulls`,
      params,
    );
  }

  updatePull(ref: RepoRef, prNumber: number, params: { title?: string; body?: string }) {
    return this.request("PATCH", `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}`, params);
  }

  getPull(ref: RepoRef, prNumber: number) {
    return this.request<{
      number: number;
      title: string;
      body: string | null;
      head: { ref: string; sha: string };
      base: { ref: string };
      html_url: string;
    }>("GET", `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}`);
  }

  getPullDiff(ref: RepoRef, prNumber: number): Promise<string> {
    return this.requestRaw(
      "GET",
      `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}`,
      "application/vnd.github.diff",
    );
  }

  createReview(
    ref: RepoRef,
    prNumber: number,
    params: {
      body: string;
      event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
      comments?: Array<{ path: string; line: number; body: string }>;
    },
  ) {
    return this.request("POST", `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}/reviews`, params);
  }

  // --- Repo ---

  getRepo(ref: RepoRef) {
    return this.request<{ default_branch: string; clone_url: string; full_name: string }>(
      "GET",
      `/repos/${ref.owner}/${ref.repo}`,
    );
  }

  private async requestRaw(method: string, path: string, accept: string): Promise<string> {
    const token = await this.auth.installationToken(this.installationId);
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept, "user-agent": "alex-agent" },
    });
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${await res.text()}`);
    }
    return await res.text();
  }
}
