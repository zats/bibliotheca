# Prepare Codex For Extensions

This document describes how to turn a clean Codex app into an unpacked, signed app that loads extensions.

Keep identity unchanged:

```
CFBundleIdentifier=com.openai.codex
Executable/name/display name=Codex
```

## Source App

Use the app Sparkle feed to download the latest build:

`https://persistent.oaistatic.com/codex-app-prod/appcast.xml`

The first item is the newest advertised build; the last item is the oldest advertised build.
Download the selected `enclosure` URL, extract `Codex.app`, copy it to the target path, and set `APP` to that path.

## Unpack

```sh
asar extract \
  "$APP"/Contents/Resources/app.asar \
  "$APP"/Contents/Resources/app
rm "$APP"/Contents/Resources/app.asar
chmod +x \
  "$APP"/Contents/Resources/app/node_modules/node-pty/build/Release/pty.node \
  "$APP"/Contents/Resources/app/node_modules/node-pty/build/Release/spawn-helper
```

Terminal loads `node-pty` from unpacked `Contents/Resources/app/node_modules`, so `pty.node` and `spawn-helper` must be executable before signing.

## Patch Package Metadata Lookup

Target:

`$APP/Contents/Resources/app/.vite/build/*.js`

Codex package metadata lookup normally checks:

- `process.resourcesPath/app.asar/package.json`
- `process.cwd()/package.json`
- `process.cwd()/electron/package.json`

In the patched default-app launch path, `process.resourcesPath` resolves to `$APP/Contents/Resources/default_app`; the real app resources path is set by the launcher as `CODEX_ELECTRON_RESOURCES_PATH`.

After unpacking, add the unpacked package candidate before the ASAR package candidate wherever this lookup appears:

```diff
+ process.env.CODEX_ELECTRON_RESOURCES_PATH?.trim() &&
+   t.push(path.join(process.env.CODEX_ELECTRON_RESOURCES_PATH.trim(), `app`, `package.json`))
  process.resourcesPath && t.push(path.join(process.resourcesPath, `app.asar`, `package.json`))
```

This keeps updater, build flavor, and related package metadata reads working without relying on `process.cwd()`.

## Patch Sparkle Native Addon Path

Target:

`$APP/Contents/Resources/app/.vite/build/*.js`

Sparkle normally loads its native addon from `path.join(process.resourcesPath, 'native', 'sparkle.node')`.

In the patched default-app launch path, that points at `$APP/Contents/Resources/default_app/native/sparkle.node`. Load from the launcher-provided resources root:

```diff
- path.join(process.resourcesPath, `native`, `sparkle.node`)
+ path.join(process.env.CODEX_ELECTRON_RESOURCES_PATH?.trim() || process.resourcesPath, `native`, `sparkle.node`)
```

This keeps update checks using `$APP/Contents/Resources/native/sparkle.node`.

## Patch Electron Launcher

Target:

`$APP/Contents/Resources/default_app/main.js`

Change `loadApplicationPackage(packagePath)` to accept `markDefaultApp = true`; only define `process.defaultApp` when true.

Add:

```js
function setDefaultEnv(name, value) {
  if (!process.env[name]?.trim()) {
    process.env[name] = value;
  }
}
```

At the start of the final no-arg `else` branch, before Electron help/default_app fallback:

```js
const packagedResourcesPath = path.resolve(path.dirname(process.execPath), '..', 'Resources');
const packagedAppPath = path.join(packagedResourcesPath, 'app');
if (fs.existsSync(path.join(packagedAppPath, 'package.json'))) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packagedAppPath, 'package.json'), 'utf8'));
  setDefaultEnv('BUILD_FLAVOR', packageJson.codexBuildFlavor || 'prod');
  setDefaultEnv('CODEX_CLI_PATH', path.join(packagedResourcesPath, 'codex'));
  setDefaultEnv('CODEX_ELECTRON_RESOURCES_PATH', packagedResourcesPath);
  setDefaultEnv('NODE_ENV', 'production');
  await loadApplicationPackage(packagedAppPath, false);
} else {
  // Existing Electron help/default_app fallback stays here.
}
```

Use the `else` branch. `node --check` rejects top-level `return` in this file.

## Patch Extension Loader

Target:

`$APP/Contents/Resources/app/webview/index.html`

Copy:

```
src/infrastructure/webview-extension-loader.js
-> $APP/Contents/Resources/app/webview/codex-extension-loader.js
```

Patch:

```diff
+ <script defer src="./codex-extension-loader.js"></script>
  <script type="module" crossorigin src="./assets/index-<build-hash>.js"></script>
```

Discover the current `assets/index-*.js` script tag from `index.html`; the hash changes by build.

Patch CSP:

```diff
- script-src &#39;self&#39;
+ script-src &#39;self&#39; blob:
```

## Patch Preload Bridge

Target:

`$APP/Contents/Resources/app/.vite/build/preload.js`

Anchor:

```js
showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},
```

Add the extension bridge methods to the existing bridge:

```js
extensions:{
  readExtensionRegistry:()=>e.ipcRenderer.invoke(`codex_extensions:read-extension-registry`),
  readExtensionScript:t=>e.ipcRenderer.invoke(`codex_extensions:read-extension-script`,t),
  readSettings:t=>e.ipcRenderer.invoke(`codex_extensions:read-settings`,t),
  writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n)
},
```

## Patch Main IPC

Target:

`$APP/Contents/Resources/app/.vite/build/main-*.js`

Copy:

```
src/infrastructure/extension-paths.js
-> $APP/Contents/Resources/app/.vite/build/extension-paths.js
```

Append `src/infrastructure/main-extension-ipc.js`.

## Patch Thread Overflow Menu

Target:

`$APP/Contents/Resources/app/webview/assets/thread-overflow-menu-*.js`

Add helpers immediately before the thread overflow component.

Anchor:

```js
function <threadMenuComponent>({conversationId:
```

```
CXThreadContext
CXMenuIcon
CXCheckIcon
CXMenuLabel
CXRenderMenuItem
CXThreadMenuItems
```

Use the current file's aliases:

- React alias: the object used for `useState` / `useEffect` in the thread menu component.
- JSX alias: the object used for `.jsx` / `.jsxs`.
- Menu primitive alias: the object used for existing `.Item`, `.Separator`, and `.FlyoutSubmenuItem` calls.

Insert `CXThreadContext` at the start of the returned fragment so extensions can read current thread context.

Build only the context fields documented in `docs/apis.md`:

```js
{
  conversationId,
  title
}
```

Insert `CXThreadMenuItems` immediately after the archive item and before the next separator. Match the current file's archive item and separator aliases; minified aliases change by build.

Typical shape:

```js
archiveThread item, CXThreadMenuItems, Separator
```

## Browser Use Patch

Target:

`$APP/Contents/Resources/app/.vite/build/main-*.js`

Locate the function near `browser-use-native-pipe-peer-authorizer` that returns `missing-package-build-flavor` for packaged builds without package metadata.
The function name changes by build.

Patch that function to authorize the native-pipe peer before the darwin/package checks:

```js
function <peerAuthorizer>(){return()=>({authorized:!0});if(process.platform!==`darwin`)return()=>({authorized:!0});
```

This is required after ad hoc signing.

## Runtime Extensions

Resolve Codex home like Codex itself: `$CODEX_HOME` when set, otherwise `$HOME/.codex`.

Sync extension source into `$CODEX_HOME/extensions/<extension-id>/src/main.js` and enable it in `$CODEX_HOME/extensions/settings.json`.

Use `docs/local-extension-development.md` for the day-to-day extension iteration loop.

## Sign And Verify

```sh
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
node --check "$APP"/Contents/Resources/default_app/main.js
node --check "$APP"/Contents/Resources/app/.vite/build/extension-paths.js
node --check "$APP"/Contents/Resources/app/.vite/build/preload.js
node --check "$APP"/Contents/Resources/app/.vite/build/main-*.js
node --check "$APP"/Contents/Resources/app/webview/assets/thread-overflow-menu-*.js
```

## Smoke Tests

Launch:

```sh
"$APP"/Contents/MacOS/Codex
```

Verify:

- app does not show Electron default app
- app does not start as `Codex (Dev)`
- extensions load from `$CODEX_HOME/extensions`
- Terminal opens
- Browser plugin can open the in-app browser
