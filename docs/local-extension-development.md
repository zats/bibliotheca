# Local Extension Development

This guide describes the local loop for building Codex extensions in this repository.

Use it after a clean Codex app has been prepared with `docs/prepare-codex.md`.
You must read `docs/architecture.md` before developing extensions to know how to structure code etc.

## Roles

Humans decide product behavior, visual acceptance, and when a runtime build is good enough.

Codex agents should:

- keep app patches general and documented
- keep extension-specific logic outside the app bundle and outside `extensions/runtime`
- sync repository extension source into the runtime extension folder
- verify behavior with the running app when UI is involved
- avoid leaving changes only inside `.modified.app`

## Paths

Codex home is `$CODEX_HOME` when set, otherwise `$HOME/.codex`.

- Clean source app: `apps/Codex-<version>.original.app`
- Prepared local app: `apps/Codex-<version>.modified.app`
- Repository extension source: `extensions/extensions/<extension-id>/src/main.js`
- Runtime extension source: `$CODEX_HOME/extensions/<extension-id>/src/main.js`
- Runtime extension settings: `$CODEX_HOME/extensions/<extension-id>/settings.json`
- Runtime extension registry: `$CODEX_HOME/extensions/settings.json`

## Extension Ids

Use lowercase dash-separated ids, for example `thread-colors`.
The id must match the folder name, for example `extensions/extensions/thread-colors/`.
The runtime entry point is always `$CODEX_HOME/extensions/<extension-id>/src/main.js`.

## Development Loop

1. Edit repository source: `extensions/extensions/<extension-id>/src/main.js`.

2. Sync it to runtime:

```sh
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME/extensions/<extension-id>/src"
cp extensions/extensions/<extension-id>/src/main.js "$CODEX_HOME/extensions/<extension-id>/src/main.js"
```

3. Enable the extension in `$CODEX_HOME/extensions/settings.json`:

```json
{
  "<extension-id>": { "enabled": true }
}
```

4. Reload Codex app UI.

For bootloader or app-patch changes, restart the app.
Do not launch a second Codex app while another is already running; macOS will route to the existing instance. User might want to quit current one (where you are potentially running) and (re)launch modified one manually.

For extension-only changes, first try reloading the webview or restarting the app. The current bootloader loads extension source at page startup.

5. Verify behavior in the app.

For UI work, use screenshots and DOM/console inspection when possible.

6. Copy any successful runtime-only experiment back to `extensions/extensions/<extension-id>/src/main.js`.

No extension behavior should live only under `$CODEX_HOME/extensions`.

## App Patch Loop

Use this loop when changing patch-time scripts or runtime extension entry points.

1. Reset modified app from original:

```sh
rm -rf apps/Codex-<version>.modified.app
ditto apps/Codex-<version>.original.app apps/Codex-<version>.modified.app
```

2. Apply the documented prep flow in `docs/prepare-codex.md`.

3. Run the patcher from `extensions/scripts`.

4. The patcher copies runtime entry points from `extensions/runtime` and syncs runtime extensions.

5. Sign and verify.

6. Test in app.

Never patch extension source directly into `.modified.app`.

## When To Change App APIs

App APIs should grow from current extension needs. Keep payloads small and tied to the code consuming them.

Before adding a new app patch:

1. Check `docs/apis.md` for an existing API.
2. Read the extension code that will consume the data.
3. Keep extension-specific data shape, policy, and behavior in `extensions/extensions/<extension-id>/src/main.js`.
4. Add only generic host capabilities and fields required by that code.
5. Generalize an existing API only as far as current extensions require.
6. Reject APIs, IPC channels, files, functions, or globals named for one extension.
7. Add a new API only when needed now and generalizable.
8. Update `docs/apis.md` in the same change.
9. Update existing extensions to use the changed API.
10. Update `docs/prepare-codex.md` for any app patch, copied file, or anchor change.

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
- extension-specific behavior is absent from `extensions/runtime` and app patches

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

- app API/runtime changes
- extension behavior changes
- documentation updates

Do not commit downloaded app bundles unless explicitly requested.
