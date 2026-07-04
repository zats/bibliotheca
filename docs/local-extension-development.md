# Local Extension Development

This guide describes the local loop for building Codex extensions in this repository.

Use it after a clean Codex app has been prepared with `docs/prepare-codex.md`.
You must read `docs/architecture.md` before developing extensions to know how to structure code etc.

## Roles

Humans decide product behavior, visual acceptance, and when a runtime build is good enough.

Codex agents should:

- keep app patches general and documented
- keep extension business logic outside the app bundle
- sync repository extension source into the runtime extension folder
- verify behavior with the running app when UI is involved
- avoid leaving changes only inside `.modified.app`

## Paths

Codex home is `$CODEX_HOME` when set, otherwise `$HOME/.codex`.

- Clean source app: `apps/Codex-<version>.original.app`
- Prepared local app: `apps/Codex-<version>.modified.app`
- Repository extension source: `src/extensions/<extension-id>/src/main.js`
- Runtime extension source: `$CODEX_HOME/extensions/<extension-id>/src/main.js`
- Runtime extension settings: `$CODEX_HOME/extensions/<extension-id>/settings.json`
- Runtime extension registry: `$CODEX_HOME/extensions/settings.json`

## Extension Ids

Use lowercase dash-separated ids, for example `thread-colors`.
The id must match the folder name, for example `src/extensions/thread-colors/`.
The runtime entry point is always `$CODEX_HOME/extensions/<extension-id>/src/main.js`.

## Development Loop

1. Edit repository source: `src/extensions/<extension-id>/src/main.js`.

2. Sync it to runtime:

```sh
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME/extensions/<extension-id>/src"
cp src/extensions/<extension-id>/src/main.js "$CODEX_HOME/extensions/<extension-id>/src/main.js"
```

3. Enable the extension in `$CODEX_HOME/extensions/settings.json`:

```json
{
  "<extension-id>": { "enabled": true }
}
```

4. Reload Codex app UI.

For bootloader or app-patch changes, restart the app.

For extension-only changes, first try reloading the webview or restarting the app. The current bootloader loads extension source at page startup.

5. Verify behavior in the app.

For UI work, use screenshots and DOM/console inspection when possible.

6. Copy any successful runtime-only experiment back to `src/extensions/<extension-id>/src/main.js`.

No extension behavior should live only under `$CODEX_HOME/extensions`.

## App Patch Loop

Use this loop when changing infrastructure or app integration points.

1. Reset modified app from original:

```sh
rm -rf apps/Codex-<version>.modified.app
ditto apps/Codex-<version>.original.app apps/Codex-<version>.modified.app
```

2. Apply the documented prep flow in `docs/prepare-codex.md`.

3. Apply infrastructure from `src/infrastructure`.

4. Sync runtime extensions.

5. Sign and verify.

6. Test in app.

Never patch extension source directly into `.modified.app`.

## When To Change App APIs

App APIs should grow from current extension needs. Keep payloads small and tied to the code consuming them.

Before adding a new app patch:

1. Check `docs/apis.md` for an existing API.
2. Read the extension code that will consume the data.
3. Add only the fields required by that code.
4. Generalize an existing API only as far as current extensions require.
5. Add a new API only when needed now.
6. Update `docs/apis.md` in the same change.
7. Update existing extensions to use the changed API.
8. Update `docs/prepare-codex.md` for any app patch, copied file, or anchor change.

## Verification Checklist

App preparation:

- `app.asar` is removed
- `Contents/Resources/app/package.json` exists
- `webview/codex-extension-loader.js` exists
- `preload.js` exposes `electronBridge.extensions`
- main process has `codex_extensions:*` IPC handlers
- patched JS files pass `node --check`
- app passes `codesign --verify --deep --strict`

Extension runtime:

- `$CODEX_HOME/extensions/settings.json` enables the extension
- `$CODEX_HOME/extensions/<extension-id>/src/main.js` exists
- extension globals live under `window.extensions.<extensionName>`
- extension data stays under `$CODEX_HOME/extensions/<extension-id>/`

UI behavior:

- menu items use Codex menu primitives through `threadMenus`
- thread header styling uses `threadChrome`
- colors work in light and dark mode
- side panels, collapsed sidebars, hover states, and window zoom are checked when touched

## Debugging

For UI bugs, use both screenshots and runtime inspection.

Useful checks:

```js
window.extensions.bootloader.getActiveExtensionIds()
window.extensions.threadContext.getCurrent()
window.extensions.threadMenus.getItems(window.extensions.threadContext.getCurrent())
window.extensions.threadChrome.getTheme(window.extensions.threadContext.getCurrent())
```

If an extension is missing:

- check `$CODEX_HOME/extensions/settings.json`
- check runtime `src/main.js` path
- check console errors
- restart the app if the bootloader already ran before syncing

If an app patch fails after a Codex update:

- inspect the clean build for equivalent behavior
- patch by semantic role, not minified symbol name
- update `docs/prepare-codex.md` with the new anchor

## Commit Discipline

Keep commits focused:

- app API/infrastructure changes
- extension behavior changes
- documentation updates

Do not commit downloaded app bundles unless explicitly requested.
