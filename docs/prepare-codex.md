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

Copy `Codex.app` to the target path and set `APP` to that path.

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
  <script type="module" crossorigin src="./assets/index-CUYAyYU6.js"></script>
```

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

Append `src/infrastructure/main-extension-ipc.js`.

## Patch Thread Overflow Menu

Target:

`$APP/Contents/Resources/app/webview/assets/thread-overflow-menu-*.js`

Add helpers near the thread overflow component:

Anchor:

```js
function mt({conversationId:e,
```

```
CXThreadContext
CXMenuIcon
CXCheckIcon
CXMenuLabel
CXRenderMenuItem
CXThreadMenuItems
```

Insert the extension menu item component after archive.

Anchor:

```js
children:(0,$.jsx)(u,{...L.archiveThread})}),null,(0,$.jsx)(d.Separator,{})
```

## Browser Use Patch

Target:

`$APP/Contents/Resources/app/.vite/build/main-*.js`

Patch `cd()` to authorize the native-pipe peer:

```js
function cd(){return()=>({authorized:!0});if(process.platform!==`darwin`)return()=>({authorized:!0});
```

This is required after ad hoc signing.

## Runtime Extensions

Sync extension source into `~/.codex/extensions/<extension-id>/src/main.js` and enable it in `~/.codex/extensions/settings.json`.

## Sign And Verify

```sh
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
node --check "$APP"/Contents/Resources/default_app/main.js
```

## Smoke Tests

Launch:

```sh
"$APP"/Contents/MacOS/Codex
```

Verify:

- app does not show Electron default app
- app does not start as `Codex (Dev)`
- extensions load from `~/.codex/extensions`
- Terminal opens
- Browser plugin can open the in-app browser
