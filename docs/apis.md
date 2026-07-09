# Extension API

Codex extensions run in the webview and use APIs under `window.extensions`.

Documented payloads are the supported API surface. Keep them limited to generic fields current extension source reads.

Runtime APIs must be extension-agnostic. Do not add API names, IPC channels, files, globals, payload fields, or storage layouts specific to one extension. Put extension-specific data shape, policy, and behavior in `extensions/extensions/<extension-id>/src/main.js`.

Extension ids must be lowercase dash-separated identifiers:

```js
/^[a-z0-9]+(?:-[a-z0-9]+)*$/
```

Extensions must put their globals under `window.extensions.<extensionName>`.

## Runtime

Codex home is `$CODEX_HOME` when set, otherwise `$HOME/.codex`.

### Bootloader

The bootloader loads enabled extension entry points from:

`$CODEX_HOME/extensions/<extension-id>/src/main.js`

Enabled extensions are read from:

`$CODEX_HOME/extensions/settings.json`

Registry shape:

```json
{
  "<extension-id>": { "enabled": true }
}
```

API:

```js
await window.extensions.bootloader.ready
window.extensions.bootloader.getActiveExtensionIds()
```

Events:

```js
window.addEventListener("codex-extension-loaded", () => {})
```

### Host Storage

Host APIs are exposed through:

```js
window.extensions.host.readExtensionRegistry()
window.extensions.host.readExtensionScript(extensionId)
window.extensions.host.readSettings(extensionId)
window.extensions.host.writeSettings(extensionId, settings)
window.extensions.host.readData(extensionId, relativePath)
window.extensions.host.listData(extensionId, relativePath)
window.extensions.host.writeData(extensionId, relativePath, value)
window.extensions.host.deleteData(extensionId, relativePath)
window.extensions.host.readCodexAuth()
window.extensions.host.writeCodexAuth(auth)
window.extensions.host.removeCodexAuth()
window.extensions.host.reloadWindow()
```

Storage locations:

```
$CODEX_HOME/extensions/settings.json
$CODEX_HOME/extensions/<extension-id>/settings.json
$CODEX_HOME/extensions/<extension-id>/<relativePath>
```

`writeSettings()` creates the extension directory and atomically replaces `settings.json`.
`writeData()` creates parent directories and atomically replaces the target JSON file. `relativePath` must stay inside the extension directory.
`listData()` returns direct child entries as `{ name, type }`, where `type` is `"file"` or `"directory"`.

Codex auth helpers read, replace, or remove:

`$CODEX_HOME/auth.json`

`reloadWindow()` reloads the current Electron window using the host window reload path.

## Profile

### Menus

Extensions can add items to the profile dropdown below the active account rows and above the next divider:

```js
window.extensions.profileMenus.registerProvider(extensionId, provider)
window.extensions.profileMenus.getItems(context)
window.extensions.profileMenus.notifyChanged(extensionId)
window.extensions.profileMenus.subscribe(listener)
```

Context shape:

```js
{
  authMethod,
  accountId,
  email,
  refreshAuthState(authMethod),
  startLogin()
}
```

`refreshAuthState(authMethod)` first clears Codex's renderer auth state through the existing `account/updated` notification with `authMode: null`, dispatches Codex's built-in `codex-app-server-restart` message for the current host with `killCodexProcess: true`, waits for `codex-app-server-initialized`, then sends a request/response renderer message that clears the host app-server auth token cache and waits for Codex's existing `getAuthToken({ refreshToken: true })` path when an auth method is provided. After that completes, it delivers `account/updated` with the requested auth method so auth callbacks refetch `account/read`.

`startLogin()` runs Codex's built-in ChatGPT logout and OAuth browser login flow from a profile menu action, then returns the login completion result.

Supported profile menu descriptors:

```js
{
  type: "item",
  id: "example.action",
  label: "Action",
  icon: { type: "dot", color: "#3b82f6" },
  disabled: false,
  closeMenu: true,
  onSelect(context) {}
}
```

Profile menu icons support dot and SVG descriptors:

```js
{ type: "dot", color: "#3b82f6" }
{ type: "svg", viewBox: "0 0 24 24", strokeWidth: 1, paths: ["M20 7H4"] }
```

```js
{
  type: "submenu",
  id: "example.submenu",
  label: "Submenu",
  children: []
}
```

```js
{
  type: "expandable",
  id: "example.expandable",
  label: "Expandable",
  defaultExpanded: false,
  children: []
}
```

```js
{
  type: "separator",
  id: "example.separator"
}
```

Events:

```js
window.addEventListener("codex-extension-profile-menu-changed", () => {})
```

### Auth Lifecycle

Extensions can handle profile logout before Codex's built-in logout flow runs:

```js
window.extensions.profileAuth.registerBeforeLogoutHandler(extensionId, handler)
await window.extensions.profileAuth.handleBeforeLogout(context)
window.extensions.profileAuth.cancelActiveLogin()
```

`handler(context)` returns `true` when it handled logout and Codex should skip its built-in logout action. Returning anything else lets Codex continue. The logout context includes the same `refreshAuthState(authMethod)` helper as profile menu contexts.

`cancelActiveLogin()` aborts an active profile-menu-started login flow when one exists.

## Login Route

Extensions can add small actions to the login route chrome:

```js
window.extensions.loginRoute.registerActionProvider(extensionId, provider)
window.extensions.loginRoute.getActions(context)
window.extensions.loginRoute.notifyChanged(extensionId)
window.extensions.loginRoute.subscribe(listener)
```

Context shape:

```js
{
  pathname
}
```

Supported action descriptors:

```js
{
  id: "example.cancel",
  label: "Cancel",
  disabled: false,
  onSelect(context) {}
}
```

Events:

```js
window.addEventListener("codex-extension-login-route-actions-changed", () => {})
```

## Thread

### Context

Context contains the fields current extensions consume.

The current thread context is available through:

```js
window.extensions.threadContext.getCurrent()
window.extensions.threadContext.subscribe((context) => {})
```

Context shape:

```js
{
  conversationId,
  title
}
```

Events:

```js
window.addEventListener("codex-extension-thread-context-changed", () => {})
```

### Menus

Extensions can add items to the thread overflow menu:

```js
window.extensions.threadMenus.registerProvider(extensionId, provider)
window.extensions.threadMenus.getItems(context)
window.extensions.threadMenus.subscribe(listener)
```

`provider(context)` returns descriptor objects.

Supported descriptors:

```js
{
  type: "item",
  id: "example.action",
  label: "Action",
  icon: { type: "dot", color: "#3b82f6" },
  checked: false,
  disabled: false,
  onSelect(context) {}
}
```

```js
{
  type: "submenu",
  id: "example.submenu",
  label: "Submenu",
  icon: { type: "dot", color: "#3b82f6" },
  children: []
}
```

```js
{
  type: "separator",
  id: "example.separator"
}
```

Events:

```js
window.addEventListener("codex-extension-thread-menu-changed", () => {})
```

### Chrome

Extensions can provide per-thread header chrome colors:

```js
window.extensions.threadChrome.registerProvider(extensionId, provider)
window.extensions.threadChrome.getTheme(context)
window.extensions.threadChrome.notifyChanged(extensionId)
window.extensions.threadChrome.subscribe(listener)
```

`provider(context)` returns `null` or:

```js
{
  background: "#e36f69",
  foreground: "#000000",
  mutedForeground: "#4a2422",
  hoverBackground: "#d16862",
  activeBackground: "#c7645f",
  borderColor: "#bd5f5a"
}
```

Only `background` is required. Missing colors are derived from the background.

The renderer applies the theme to:

- main thread header
- collapsed-sidebar header controls
- side-panel tab/header chrome

Events:

```js
window.addEventListener("codex-extension-thread-chrome-changed", () => {})
```
