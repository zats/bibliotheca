# Extension API

Codex extensions run in the webview and use APIs under `window.extensions`.

Documented payloads are the supported API surface. Keep them limited to fields current extension source reads.

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
```

Storage locations:

```
$CODEX_HOME/extensions/settings.json
$CODEX_HOME/extensions/<extension-id>/settings.json
```

`writeSettings()` creates the extension directory and atomically replaces `settings.json`.

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
