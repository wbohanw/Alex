# Alex

Alex is an autonomous coding agent that lives on GitHub. Give it its own GitHub App identity, install it on the repos you authorize, and @-mention it on an issue or pull request. Alex plans the work, waits for your approval, implements it on a branch, opens a draft PR, and reviews pull requests — all driven by an [OpenCode](https://opencode.ai) server.

A built-in dashboard (GitHub OAuth login, restricted to you) shows everything Alex is doing: active tasks, phase progress, pending approval gates, and a live activity feed.

## How it works

1. You comment `@alex fix the flaky login test` on an issue in an authorized repo.
2. GitHub delivers the webhook to Alex, which creates a task and an isolated workspace.
3. **Plan phase** — Alex runs an OpenCode session against your server and posts an implementation plan as an issue comment.
4. **Approval gate** — you approve with a 👍 / ✅ reaction, an "approved" reply, or a click in the dashboard. Reply with feedback to request a revision.
5. **Build phase** — Alex implements the approved plan on a task branch and opens a draft PR.
6. Comment `@alex review` on any PR and Alex reviews the diff and posts review comments.

GitHub commands and reaction approvals are accepted only from users who currently have write, maintain, or admin permission on that repository. Dashboard actions remain restricted by `DASHBOARD_ALLOWED_LOGINS`.

## Status

Early development. See [SETUP.md](SETUP.md) for GitHub App registration and deployment.

## Stack

- [Bun](https://bun.sh) + TypeScript backend, no framework
- GitHub App auth (JWT → installation tokens), webhook-driven
- OpenCode server for all LLM work, with access to Alex's workspace directory
- SQLite for state, SSE for live dashboard updates
- React + Vite dashboard in `packages/ui`

## Development

```bash
bun install
cp .env.example .env   # fill in credentials
bun run build:ui
bun run dev
```
