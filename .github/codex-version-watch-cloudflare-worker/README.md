# Codex Version Watch Cloudflare Worker

GitHub scheduled workflows can be delayed or skipped. This Worker is an external cron source that dispatches the GitHub version-watch workflow every 5 minutes.

## What It Does

1. Dispatches `.github/workflows/codex-version-watch.yml`.
2. GitHub reads the Sparkle feed.
3. GitHub opens a `codex-version-watch` issue when a new Codex version appears.
4. The issue triggers `.github/workflows/codex-smoke-orchestrator.yml`.
5. The orchestrator runs the patch smoke workflow when the issue matches its conditions.

This keeps Cloudflare as a timer only. GitHub owns version detection, state, issue creation, and patching.

## Setup

Create a fine-grained GitHub token for `zats/bibliotheca` with:

- Contents: read/write
- Actions: read/write
- Issues: read/write

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

Expected result:

```json
{"dispatched":true,"workflow":"codex-version-watch.yml"}
```

## Configuration

Defaults live in `wrangler.toml`.

Important variables:

- `GITHUB_OWNER`: GitHub owner.
- `GITHUB_REPO`: GitHub repo.
- `GITHUB_BRANCH`: branch containing workflows and state.
- `GITHUB_WORKFLOW_ID`: version-watch workflow file to dispatch.

The cron schedule is also in `wrangler.toml`.
