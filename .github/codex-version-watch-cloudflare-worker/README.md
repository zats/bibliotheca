# Codex Version Watch Cloudflare Worker

This Worker checks the Codex Sparkle feed every 5 minutes, stores the last seen version in Workers KV, opens a GitHub issue for new versions, and dispatches the smoke orchestrator.

## What It Does

1. Reads `https://persistent.oaistatic.com/codex-app-prod/appcast.xml`.
2. Compares the latest version to `VERSION_WATCH_STATE/state` in Workers KV.
3. Opens or updates a `codex-version-watch` issue for a new version.
4. Dispatches `.github/workflows/codex-smoke-orchestrator.yml`.
5. Stores the detected version, issue number, and download URL in KV.

## Setup

Create a fine-grained GitHub token for `zats/bibliotheca` with:

- Contents: read/write
- Actions: read/write
- Issues: read/write

Then configure Cloudflare:

```fish
cd /Users/zats/Developer/Bibliotheca/.github/codex-version-watch-cloudflare-worker
pnpm install
pnpm exec wrangler kv namespace create VERSION_WATCH_STATE
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler deploy
```

After creating the namespace, copy the generated `id` into `wrangler.toml`.

## Manual Test

After deploy:

```fish
curl https://codex-version-watch.<your-subdomain>.workers.dev/check
```

Expected result:

```json
{"changed":false,"version":"26.623.141536","issueNumber":123,"smokeDispatched":false}
```

## Configuration

Defaults live in `wrangler.toml`.

Important variables:

- `GITHUB_OWNER`: GitHub owner.
- `GITHUB_REPO`: GitHub repo.
- `GITHUB_BRANCH`: branch containing workflows.
- `SMOKE_WORKFLOW_ID`: smoke orchestrator workflow file to dispatch.
- `VERSION_WATCH_STATE`: KV namespace binding for version state.

The cron schedule is also in `wrangler.toml`.
