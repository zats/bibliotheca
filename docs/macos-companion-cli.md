# macOS Companion CLI

This document defines the first minimal `bibliotheca` CLI contract for Codex patch verification and launch probing.

The first version should be one-shot commands. A long-running RPC server can be added later when in-app extension management needs shared state, progress events, or push notifications.

## Scope

First version:

- caller passes the exact Codex app bundle path
- CLI can patch that app bundle in place
- CLI can report whether that app is patched
- CLI can launch Codex and wait until patched runtime proves it loaded
- Codex can invoke synchronous CLI commands later for extension list/update actions

Future versions can add app discovery, patch application, persistent `serve`, extension management UI, and update checks.

## CLI Shape

Every command accepts an explicit app path:

`bibliotheca <command> --codex-app-path=/Applications/Codex.app`

`--codex-app-path` must point to a `.app` bundle. The first version should fail if the path is missing, invalid, or not a Codex bundle.

All machine-readable output should be one JSON object on stdout. Human-readable diagnostics belong on stderr.

## Commands

### patch

Patches the specified Codex app bundle in place.

Command:

`bibliotheca patch --codex-app-path=/Applications/Codex.app`

Success output:

```json
{
  "patched": true,
  "codexAppPath": "/Applications/Codex.app",
  "codexVersion": "26.623.101652",
  "patchPackVersion": "local",
  "extensionApiVersion": "1"
}
```

The first implementation uses the repository patcher at `extensions/scripts/patch-modified-app.js`.

### is-patched

Checks static patch state for the specified app bundle.

Command:

`bibliotheca is-patched --codex-app-path=/Applications/Codex.app`

Success output:

```json
{
  "patched": true,
  "codexAppPath": "/Applications/Codex.app",
  "codexVersion": "26.623.101652",
  "patchPackVersion": "2026.07.04-1",
  "extensionApiVersion": "1"
}
```

If the app is clean, return success with `"patched": false`.

This command should only inspect files and metadata. It does not launch Codex and does not prove runtime health.

### launch

Launches the specified Codex app and waits for patched runtime to write a launch probe entry.

Command:

`bibliotheca launch --codex-app-path=/Applications/Codex.app --wait-for-ready --timeout=15s`

Success output:

```json
{
  "launched": true,
  "ready": true,
  "codexAppPath": "/Applications/Codex.app",
  "codexVersion": "26.623.101652",
  "patchPackVersion": "2026.07.04-1",
  "extensionApiVersion": "1"
}
```

Failure output should identify the failed phase:

```json
{
  "launched": false,
  "ready": false,
  "codexAppPath": "/Applications/Codex.app",
  "error": {
    "phase": "launch",
    "message": "failed to launch Codex"
  }
}
```

Phases:

- `validate-app`
- `static-patch-check`
- `launch`
- `wait-for-ready`

If Codex launches but patched runtime never writes a matching probe entry, return `"launched": true`, `"ready": false`, and `phase: "wait-for-ready"`.

## Launch Probe

`launch --wait-for-ready` sets an environment variable that only patched Codex runtime understands, launches Codex, waits for a matching probe log entry, then exits.

`$CODEX_HOME` means the `CODEX_HOME` environment variable when set, otherwise `$HOME/.codex`.

Probe file:

`$CODEX_HOME/extensions/.<pid>.json`

Before launch, the CLI records:

- launch start timestamp
- expected Codex app path
- expected child process id
- timeout, default `15s`

The CLI launches Codex with:

`BIBLIOTHECA_WAIT_FOR_READY=1`

When patched Codex runtime sees this environment variable, it writes `$CODEX_HOME/extensions/.<process.pid>.json` after main-process extension IPC has registered:

```json
{
  "timestamp": "2026-07-04T00:00:00.000Z",
  "codexAppPath": "/Applications/Codex.app",
  "codexVersion": "26.623.101652",
  "patchPackVersion": "2026.07.04-1",
  "extensionApiVersion": "1"
}
```

`ready: true` requires the file named for the launched process pid and a timestamp greater than the launch start timestamp. After a successful match, the CLI deletes that pid-specific JSON file.

## Codex-Initiated CLI Commands

Until a persistent server exists, Codex can call synchronous CLI commands for extension operations:

`bibliotheca extension list`

`bibliotheca extension check-updates`

`bibliotheca extension install <extension-id>`

These commands should return one JSON object on stdout and use file locks for mutation commands.

Long-running downloads, update progress, and push notifications should move to a future `serve` mode.

## Timeouts

Recommended first defaults:

- `launch`: wait up to 15 seconds for process launch and runtime `ready`

Timeouts should be explicit fields in error output.
