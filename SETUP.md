# Setting up Alex

Alex needs three things you must create yourself: a **GitHub App** (its identity), an **OpenCode server** (its brain), and a **public URL** for webhook delivery. This guide walks through all of it.

## 1. Register the GitHub App

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** and fill in:

| Field | Value |
| --- | --- |
| App name | `alex-<something-unique>` — the slug becomes the @-mention name |
| Homepage URL | your repo or server URL |
| Callback URL | `https://<your-server>/auth/callback` |
| Webhook URL | `https://<your-server>/webhook/github` |
| Webhook secret | generate one (`openssl rand -hex 32`) — this is `GITHUB_WEBHOOK_SECRET` |

**Permissions (Repository):**

- Contents: **Read & write** (clone, push branches)
- Issues: **Read & write** (read issues, post plan comments)
- Pull requests: **Read & write** (open draft PRs, post reviews)
- Metadata: **Read-only** (mandatory)

**Subscribe to events:**

- Issue comment
- Issues
- Pull request
- Pull request review

**Where can this app be installed?** — "Only on this account" is fine.

After creating:

1. Note the **App ID** → `GITHUB_APP_ID`.
2. Note the **slug** (from the app's public URL, `github.com/apps/<slug>`) → `GITHUB_APP_SLUG`.
3. **Generate a private key** (button at the bottom) → save the `.pem`, set `GITHUB_APP_PRIVATE_KEY_PATH`.
4. Under **Optional features → identify and authorize users**: the **Client ID** and a generated **Client secret** → `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.

## 2. Install the app on your repos

From the app page, **Install App** → choose your account → select the repositories Alex is allowed to work on. This is the authorization boundary: Alex can only ever see and push to repos you select here.

## 3. Run an OpenCode server

On the machine that should do the LLM work:

```bash
opencode serve --port 4096 --hostname 0.0.0.0
```

Put a password on it if it's reachable from the internet, and set:

```
OPENCODE_SERVER_PASSWORD=<password> opencode serve --port 4096 --hostname 0.0.0.0

# In Alex's environment:
OPENCODE_URL=https://<opencode-host>:4096
OPENCODE_PASSWORD=<password>

# Optional: pin Alex to a provider/model configured on the OpenCode server.
OPENCODE_PROVIDER_ID=groq
OPENCODE_MODEL_ID=openai/gpt-oss-120b
```

Set both model variables together. If they are blank, Alex uses the OpenCode server's default model.

The OpenCode server needs provider credentials (e.g. `ANTHROPIC_API_KEY`) configured in *its* process — Alex never talks to an LLM directly.

OpenCode must also see the repository workspaces Alex creates under `DATA_DIR/workspaces`. The simplest and recommended deployment runs both processes on the same host. If OpenCode runs in another container or on another host, mount that directory into the OpenCode environment and set `OPENCODE_WORKSPACE_ROOT` to its server-side path. A remote server without this shared storage cannot inspect or edit Alex's checkouts.

## 4. Configure and start Alex

```bash
cp .env.example .env   # fill in everything from steps 1–3
bun install
bun run build:ui       # so the backend can serve the dashboard
bun run start
```

Expose the server publicly (reverse proxy, Cloudflare Tunnel, or ngrok) so GitHub can deliver webhooks to `/webhook/github` and the OAuth callback works. Set `PUBLIC_BASE_URL` to that public URL.

`DASHBOARD_ALLOWED_LOGINS` is a comma-separated list of GitHub usernames allowed into the dashboard — set it to your login.

## 5. First run

1. Open `https://<your-server>/` → **Sign in with GitHub** → you should see the (empty) dashboard.
2. On an issue in an authorized repo, comment: `@<slug> fix <something small>`.
3. Alex replies, then posts a plan. Approve with 👍 on the plan comment, an `approved` reply, or the dashboard button.
4. Watch the build phase stream into the dashboard; a draft PR appears when it's done.
5. On any PR: `@<slug> review` for a review pass.

Only repository users with write, maintain, or admin permission can start or control tasks from GitHub. Dashboard controls are separately limited to `DASHBOARD_ALLOWED_LOGINS`.

## Troubleshooting

- **No reaction to mentions**: check the app's webhook deliveries page (app settings → Advanced) for delivery errors; verify `GITHUB_WEBHOOK_SECRET` matches.
- **403 on dashboard login**: your login isn't in `DASHBOARD_ALLOWED_LOGINS` (case-insensitive).
- **Plan phase hangs**: confirm `OPENCODE_URL` is reachable from Alex's machine and the OpenCode server has valid provider credentials.
- **Health and readiness checks**:
  ```bash
  # Check if Alex is running
  curl http://localhost:3900/healthz

  # Check if Alex can reach OpenCode (also verifies readiness)
  curl http://localhost:3900/readyz
  ```
  `/healthz` checks that the Alex process is alive; `/readyz` also checks that Alex can authenticate to and reach OpenCode.
- **👍 approval slow**: reactions are polled every 30s (GitHub sends no webhook for them). Reply `approved` or use the dashboard for instant approval.
