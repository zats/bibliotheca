# Prepare Codex For Extensions

This document describes how to turn a clean Codex app into an unpacked, signed app that loads extensions.

All runtime files, app patches, preload bridge methods, and main-process IPC added here must be extension-agnostic. Extension-specific storage layout, policy, UI decisions, and business logic belong in `extensions/extensions/<extension-id>/src/main.js`.

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

## Patch Package Metadata

Target:

`$APP/Contents/Resources/app/package.json`

Add Bibliotheca metadata:

```json
{
  "bibliothecaPatchPackVersion": "local",
  "bibliothecaExtensionApiVersion": "1"
}
```

The CLI reads these fields for `is-patched` and `launch --wait-for-ready` output.

## Patch Extension Loader

Target:

`$APP/Contents/Resources/app/webview/index.html`

Copy runtime entry point:

```
extensions/runtime/webview-extension-loader.js
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

Expose only generic bridge methods. Do not add methods named for one extension.

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
  writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n),
  readData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:read-data`,t,n),
  listData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:list-data`,t,n),
  writeData:(t,n,r)=>e.ipcRenderer.invoke(`codex_extensions:write-data`,t,n,r),
  deleteData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:delete-data`,t,n),
  readCodexAuth:()=>e.ipcRenderer.invoke(`codex_extensions:read-codex-auth`),
  writeCodexAuth:t=>e.ipcRenderer.invoke(`codex_extensions:write-codex-auth`,t),
  removeCodexAuth:()=>e.ipcRenderer.invoke(`codex_extensions:remove-codex-auth`),
  reloadWindow:()=>e.ipcRenderer.invoke(`codex_extensions:reload-window`),
  writeReadyProbe:()=>e.ipcRenderer.invoke(`codex_extensions:write-ready-probe`)
},
```

## Patch Main IPC

Target:

`$APP/Contents/Resources/app/.vite/build/main-*.js`

Register only generic IPC handlers. Do not add channels named for one extension.

Copy runtime helper:

```
extensions/runtime/extension-paths.js
-> $APP/Contents/Resources/app/.vite/build/extension-paths.js
```

Append `extensions/runtime/main-extension-ipc.js`.

This registers:

- `codex_extensions:read-extension-registry`
- `codex_extensions:read-extension-script`
- `codex_extensions:read-settings`
- `codex_extensions:write-settings`
- `codex_extensions:read-data`
- `codex_extensions:list-data`
- `codex_extensions:write-data`
- `codex_extensions:delete-data`
- `codex_extensions:read-codex-auth`
- `codex_extensions:write-codex-auth`
- `codex_extensions:remove-codex-auth`
- `codex_extensions:reload-window`
- `codex_extensions:write-ready-probe`

`write-ready-probe` only writes when `BIBLIOTHECA_WAIT_FOR_READY=1`. It writes `$CODEX_HOME/extensions/.<process.pid>.json` after main-process extension IPC has registered. The same IPC can also be called by the webview bridge.

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

## Patch Profile Menu

Target:

`$APP/Contents/Resources/app/webview/assets/app-initial~app-main~automations-page-*.js`

Add helpers immediately before the profile dropdown component.

Anchor:

```js
function ER(e){let t=(0,MR.c)(216),
```

```
CXProfileMenuIcon
CXProfileMenuLabel
CXProfileMenuContent
CXProfileMenuLeftIcon
CXWaitForAppServerInitialized
CXRefreshProfileAuthState
CXSelectProfileMenuItem
CXExpandableProfileMenuButton
CXExpandableProfileMenuItem
CXRenderProfileMenuItem
CXProfileMenuItems
```

Use the current file's aliases:

- React alias: the object used for `useState` / `useEffect` in the profile dropdown component.
- JSX alias: the object used for `.jsx` / `.jsxs`.
- Menu primitive alias: the object used for existing `.Item`, `.Separator`, and `.FlyoutSubmenuItem` calls.
- Profile item alias: the component used for existing profile dropdown rows.

`CXProfileMenuIcon` must render documented profile icon descriptors only. SVG icons render directly at 16 px.

`CXRenderProfileMenuItem` must render documented profile menu descriptors only. `item` descriptors use the profile row component, `submenu` descriptors use Codex flyout menu primitives, and `expandable` descriptors expand their children inline.

Patch the logout handler:

```diff
- await oi(scope, `use-copilot-auth-if-available`, !1), await Ts(`logout`, { hostId: or }), navigate(`/login`)
+ const refreshAuthState = async authMethod => {
+   setAuthMethod(null)
+   await Ts(`handle-app-server-notification-for-host`, {
+     hostId,
+     notification: { method: `account/updated`, params: { authMode: null } },
+   })
+   const initialized = new Promise(resolve => {
+     const handler = event => {
+       if (event.data?.type === `codex-app-server-initialized` && event.data.hostId === hostId) {
+         window.removeEventListener(`message`, handler)
+         resolve()
+       }
+     }
+     window.addEventListener(`message`, handler)
+   })
+   dispatchMessage(`codex-app-server-restart`, { hostId, killCodexProcess: true, errorMessage: null })
+   await initialized
+   if (authMethod !== undefined) {
+     await dispatchMainRequest(
+       `codex-app-server-refresh-auth-token`,
+       { hostId, refreshToken: true },
+       `codex-app-server-refresh-auth-token-response`
+     )
+   }
+   if (authMethod !== undefined) setAuthMethod(authMethod)
+   await Ts(`handle-app-server-notification-for-host`, {
+     hostId,
+     notification: { method: `account/updated`, params: { authMode: authMethod ?? null } },
+   })
+ }
+ if (await globalThis.extensions?.profileAuth?.handleBeforeLogout?.({ authMethod, accountId, email, refreshAuthState })) return
+ await oi(scope, `use-copilot-auth-if-available`, !1), await Ts(`logout`, { hostId: or }), navigate(`/login`)
```

Insert `CXProfileMenuItems` between the active account rows and the first divider:

```diff
- children:[mt,yt,wt,...]
+ children:[mt,(0,jsx)(CXProfileMenuItems,{context:{authMethod,accountId,email,refreshAuthState,startLogin},onClose}),yt,wt,...]
```

The context fields must stay limited to the documented `docs/apis.md` profile menu context.
`refreshAuthState` must first clear renderer auth state with Codex's existing `account/updated` notification using `authMode: null`, then use Codex's existing `codex-app-server-restart` renderer message, wait for the matching `codex-app-server-initialized` host message, force Codex's existing auth-token refresh through a request/response renderer message when an auth method is provided, and deliver Codex's existing `account/updated` notification through `handle-app-server-notification-for-host`, matching the app's auth callback path.
Patch the main app-server renderer message switch in `$APP/Contents/Resources/app/.vite/build/main-*.js` by inserting a generic `codex-app-server-refresh-auth-token` case next to `codex-app-server-restart`. It must call `getAppServerConnection(hostId).clearAuthTokenCache()` and then Codex's existing `getAuthToken({ refreshToken: true })`. When `requestId` is present, it must send `codex-app-server-refresh-auth-token-response` back to the requesting web contents after the refresh completes or fails.
`startLogin` must use Codex's existing `login-with-chatgpt` command and browser-opening bridge, register its `AbortController` through `globalThis.extensions.profileAuth.setActiveLoginCancel`, wait for the returned completion, refresh authenticated app state, return the completion result, and clear the cancel handler in `finally`.

Patch `$APP/Contents/Resources/app/.vite/build/src-*.js` so local stdio app-server restarts can actually kill the running app-server process tree before reconnecting:

- Insert generic process-tree helper function expressions into the existing minified `var` declaration immediately before `NR=class{readyState=cL.Connecting;`.
- Add `NR.killCodexProcess()` beside `NR.close()`; it must use the current `proc.pid`, enumerate descendants with `pgrep -P`, send `SIGKILL` to descendants first and the root process last, then wait for the processes to disappear.
- Add `activeConnection` and `killCodexProcess()` to the local stdio transport class `PR`.
- In `AppServerConnection.restart({ killCodexProcess })`, call `transport.killCodexProcess()` before `stopProcess()`. The original order closes the stdio parent first, which can orphan app-server children before the hard-kill hook can find them.

## Login Route Action Patch

Target:

`$APP/Contents/Resources/app/webview/assets/login-route-*.js`

Patch `LoginRoute`'s exported wrapper function. The current anchor is:

```js
function Lt(){let e=(0,Rt.c)(3);
```

Insert generic helpers before that function:

```js
CXLoginRouteActionButton
CXLoginRouteActions
```

`CXLoginRouteActions` must subscribe to `globalThis.extensions.loginRoute`, read documented action descriptors with `{ pathname: window.location.pathname }`, and render those actions with Codex token classes.

Patch the active `Pt` route render:

```diff
- t=(0,zt.jsx)(Pt,{})
+ t=(0,zt.jsxs)(zt.Fragment,{children:[(0,zt.jsx)(CXLoginRouteActions,{}),(0,zt.jsx)(Pt,{})]})
```

The login route patch must render documented `docs/apis.md` login route action descriptors only. Extension-specific login policy and cancel behavior must stay in the extension source.

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

The patch script currently installs and enables:

- `thread-colors`
- `account-switcher`

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
node --check "$APP"/Contents/Resources/app/webview/assets/app-initial~app-main~automations-page-*.js
node --check "$APP"/Contents/Resources/app/webview/assets/login-route-*.js
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
