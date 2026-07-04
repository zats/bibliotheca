# Production Patching

This document describes how patching should work outside local development, with a macOS companion app, versioned patch packs, and automated certification against new Codex releases.

## System Parts

Production has three long-lived parts:

- clean Codex app from OpenAI
- macOS companion app
- versioned patch packs

The companion app owns Codex discovery, patching, extension installation, extension updates, and patch-state reporting.

## App Discovery

The companion app should discover Codex in this order:

1. running Codex process by bundle id
2. known Codex app path on disk
3. user-selected app bundle
4. latest app downloaded from the Sparkle feed

Read the app version from the bundle plist.

## Patch State

The companion app should classify a Codex install as:

- `clean`
- `patched-current`
- `patched-with-old-pack`
- `patched-stale`
- `patched-broken`
- `unsupported-codex-version`
- `patch-failed`
- `runtime-verification-failed`
- `unknown`

File checks can show likely patch state. Runtime ping/pong is the proof that patched Codex loaded the extension infrastructure.

## Runtime Bridge

Patched Codex and the companion app need a minimal local bridge.

Startup flow:

1. Codex launches and sends `hello`.
2. Companion replies with patch-pack and extension registry state.
3. Codex sends `ready` after bootloader and extension APIs are loaded.
4. Companion marks the install runtime-verified.

The bridge should also support:

- companion notification when extensions change
- Codex requests for extension source and settings
- Codex reporting `bundleVersion`, `patchPackVersion`, and `extensionApiVersion`

Transport can be loopback HTTP, WebSocket, or a Unix domain socket. Use a local auth token so unrelated local processes cannot control extension infrastructure.

## Patching Flow

Patching should be automatic by default:

1. companion detects Codex app
2. companion detects Codex version
3. companion downloads the newest compatible patch pack
4. companion applies patch pack
5. companion signs and verifies the app
6. companion launches or asks user to relaunch Codex
7. companion waits for runtime ping/pong

Patching a running app bundle is fragile. If the target app is running, the companion should offer `Patch and restart` or guide the user to quit and relaunch.

The patched app should include or sit next to a patch manifest:

```json
{
  "codexVersion": "26.623.101652",
  "patchPackVersion": "2026.07.04-1",
  "extensionApiVersion": "1",
  "patchedAt": "2026-07-04T00:00:00Z",
  "patchedFiles": []
}
```

## Codex Updates

Codex updates can replace patched app contents. The companion app should detect this by watching:

- known Codex app path
- bundle version
- patch manifest
- runtime ping/pong disappearance or version mismatch

When a clean or stale Codex app is detected, the companion should suggest patching. The user may disable reminders, but the companion should still show patch state in its own UI.

## Patch Packs

Patch packs are versioned units of patching logic and metadata. A patch pack should declare:

```json
{
  "patchPackVersion": "2026.07.04-1",
  "supportedCodexVersions": [">=26.623.42026 <=26.623.101652"],
  "verifiedCodexVersions": ["26.623.101652"],
  "extensionApiVersion": "1",
  "patcherEntry": "extensions/infrastructure/patch-modified-app.js",
  "verification": ["codesign", "node-check", "runtime-ping"]
}
```

Companion clients should prefer exact `verifiedCodexVersions`. A supported range means the patch pack may be tried; verified means it passed automation for that build.

## Patch Pack Updates

The companion app should periodically fetch a patch-pack index:

```json
{
  "latestPatchPackVersion": "2026.07.04-2",
  "packs": [
    {
      "version": "2026.07.04-2",
      "verifiedCodexVersions": ["26.623.101652"],
      "supportedCodexVersionRange": ">=26.623.42026 <=26.623.101652",
      "url": "https://example.com/patch-packs/2026.07.04-2.zip"
    }
  ]
}
```

If a newer compatible pack exists, the companion should re-evaluate the installed Codex app and apply the pack when needed.

## Failure Reports

Patch failures should capture:

- Codex version
- patch pack version
- failed step
- failed anchor or regex
- target file
- patch logs
- verification logs

These reports should be enough for a developer or Codex-assisted repair flow to reproduce the failure.

## Codex-Assisted Repair

Codex-assisted repair is a fallback for unsupported versions, anchor drift, and local-machine failures.

The companion app should generate a troubleshooting bundle containing:

- current patch pack
- failure report
- target Codex version
- `docs/prepare-codex.md`
- relevant extracted source snippets
- expected runtime ping/pong contract

Codex can then guide the user locally, update patch code, test, and help produce a patch-pack candidate. The normal path remains automated patch packs.

## GitHub Certification

GitHub automation should continuously certify patch packs against new Codex releases.

### Version Detection

A scheduled workflow checks the Codex Sparkle feed:

`https://persistent.oaistatic.com/codex-app-prod/appcast.xml`

It compares advertised versions against the latest verified patch metadata.

GitHub-only detection should use `schedule` as a polling fallback. GitHub's shortest supported scheduled interval is 5 minutes, and scheduled workflows can be delayed or dropped during high load. Schedule away from the top of the hour.

Near-zero-lag detection needs an external watcher. The watcher polls the Sparkle feed, compares the latest version with published compatibility metadata, and calls GitHub's `repository_dispatch` API when a new version appears.

Recommended triggers:

```yaml
on:
  repository_dispatch:
    types: [codex_version_detected]
  workflow_dispatch:
  schedule:
    - cron: "7/5 * * * *"
```

Use `repository_dispatch` as the fast path, `schedule` as the safety net, and `workflow_dispatch` for manual retries.

### Certification

For each unverified Codex version, automation should:

1. download Codex from the feed using scripting
2. apply the latest compatible patch pack
3. sign the patched app
4. launch Codex on a macOS runner
5. wait for runtime ping/pong
6. run extension smoke tests
7. record pass/fail

If certification passes, update compatibility metadata so companion clients can treat that Codex version as verified.

### Repair Workflow

If certification fails, automation should open an issue with the failure report and start a repair flow.

The repair flow should:

1. run the failing patcher
2. inspect the failed clean Codex source
3. update patch source and docs
4. rebuild and relaunch Codex
5. wait for runtime ping/pong
6. run smoke tests
7. open a PR with patch changes, docs changes, a bumped patch-pack version, and updated compatibility metadata

Once merged and published, companion apps can detect the new patch pack and apply it.
