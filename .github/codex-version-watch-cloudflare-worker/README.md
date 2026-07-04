# Codex Version Watch Cloudflare Worker

GitHub scheduled workflows can be delayed or skipped. This Worker is an external cron source that checks the Codex Sparkle feed and triggers the GitHub patch smoke workflow when a new Codex version appears.

## What It Does

1. Reads the Sparkle feed.
2. Reads `.github/codex-version-watch-state.json` from `main`.
3. Exits if the latest version is already recorded.
4. Dispatches `.github/workflows/codex-patch-smoke.yml` with `codex_app_url` and `codex_version`.
5. Updates `.github/codex-version-watch-state.json` so the same version is not dispatched again.

## Setup

Create a fine-grained GitHub token for `zats/bibliotheca` with:

- Contents: read/write
- Actions: write

Then configure Cloudflare:

```fish
cd /Users/zats/Developer/Bibliotheca/.github/codex-version-watch-cloudflare-worker
pnpm install
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler deploy
```

## Manual Test

After deploy:

```fish
curl https://codex-version-watch.<your-subdomain>.workers.dev/check
```

Expected result when no new version exists:

```json
{"dispatched":false}
```

## Configuration

Defaults live in `wrangler.toml`.

Important variables:

- `GITHUB_OWNER`: GitHub owner.
- `GITHUB_REPO`: GitHub repo.
- `GITHUB_BRANCH`: branch containing workflows and state.
- `GITHUB_STATE_PATH`: path to the recorded latest version.
- `GITHUB_WORKFLOW_ID`: workflow file to dispatch.
- `SPARKLE_FEED_URL`: Codex Sparkle feed.
- `READY_TIMEOUT_SECONDS`: smoke workflow readiness timeout.

The cron schedule is also in `wrangler.toml`.

