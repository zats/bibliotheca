# Codex Version Watch Cloudflare Worker

This Worker checks the Codex Sparkle feed every 5 minutes, opens a GitHub issue for new versions, and dispatches the smoke orchestrator.

## What It Does

1. Reads `https://persistent.oaistatic.com/codex-app-prod/appcast.xml`.
2. Checks whether a `Codex <version> available` issue already exists.
3. Opens a `codex-version-watch` issue for a new version.
4. Dispatches `.github/workflows/codex-smoke-orchestrator.yml`.

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
{"changed":false,"version":"26.623.141536","issueNumber":123,"smokeDispatched":false}
```

## Configuration

Defaults live in `wrangler.toml`.

Important variables:

- `GITHUB_OWNER`: GitHub owner.
- `GITHUB_REPO`: GitHub repo.
- `GITHUB_BRANCH`: branch containing workflows.
- `SMOKE_WORKFLOW_ID`: smoke orchestrator workflow file to dispatch.

The cron schedule is also in `wrangler.toml`.
