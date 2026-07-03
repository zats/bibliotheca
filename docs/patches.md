# Codex App Patches

This file documents every in-place patch applied to `apps/Codex-<version>.modified.app`.

Use this with `src/infrastructure/patch-modified-app.js` when recreating patches after a Codex update.

## Webview Loader

Target:

```text
Contents/Resources/app/webview/index.html
```

Purpose:

- Load the extension bootloader before the app bundle.
- Allow the bootloader to execute extension scripts from Blob URLs.

Patch points:

```diff
+ <script defer src="./codex-extension-loader.js"></script>
  <script type="module" crossorigin src="./assets/index-CUYAyYU6.js"></script>
```

```diff
- script-src &#39;self&#39;
+ script-src &#39;self&#39; blob:
```

Copied infrastructure file:

```text
src/infrastructure/webview-extension-loader.js
-> Contents/Resources/app/webview/codex-extension-loader.js
```

Update notes:

- Re-find the current webview app bundle script in `index.html`.
- Keep the loader before the app bundle so APIs exist before extensions need them.

## Preload Extension Bridge

Target:

```text
Contents/Resources/app/.vite/build/preload.js
```

Purpose:

- Expose extension host IPC methods on the existing `window.electronBridge`.

Anchor:

```js
showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},
```

Replacement shape:

```diff
  showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},
+ extensions:{
+   readExtensionRegistry:()=>e.ipcRenderer.invoke(`codex_extensions:read-extension-registry`),
+   readExtensionScript:t=>e.ipcRenderer.invoke(`codex_extensions:read-extension-script`,t),
+   readSettings:t=>e.ipcRenderer.invoke(`codex_extensions:read-settings`,t),
+   writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n)
+ },
```

Update notes:

- Re-find the exposed bridge object in preload.
- Keep this as a property on the existing app bridge.

## Main Extension IPC

Target:

```text
Contents/Resources/app/.vite/build/main-CNod9zFW.js
```

Purpose:

- Add main-process handlers for extension registry, extension script loading, and extension settings.

Patch point:

```text
EOF
```

Appended infrastructure file:

```text
src/infrastructure/main-extension-ipc.js
```

IPC channels:

```text
codex_extensions:read-extension-registry
codex_extensions:read-extension-script
codex_extensions:read-settings
codex_extensions:write-settings
```

Update notes:

- Re-find the current main bundle filename under `.vite/build`.
- Appending keeps this independent from minified app internals.

## Thread Overflow Menu API

Target:

```text
Contents/Resources/app/webview/assets/thread-overflow-menu-CeI5JFwo.js
```

Purpose:

- Publish active thread context to `window.extensions.threadContext`.
- Render extension-provided menu descriptors using existing Codex menu primitives.

Helper insertion anchor:

```js
function mt({conversationId:e,
```

Inserted helpers:

```text
CXThreadContext
CXMenuIcon
CXCheckIcon
CXMenuLabel
CXRenderMenuItem
CXThreadMenuItems
```

Thread context insertion anchor:

```js
return(0,$.jsxs)($.Fragment,{children:[(0,$.jsxs)(oe,{open:P,onOpenChange:ye,triggerButton:
```

Replacement shape:

```diff
 return(0,$.jsxs)($.Fragment,{children:[
+  (0,$.jsx)(CXThreadContext,{context:{...}}),
   (0,$.jsxs)(oe,{open:P,onOpenChange:ye,triggerButton:
```

Menu item insertion anchor:

```js
children:(0,$.jsx)(u,{...L.archiveThread})}),null,(0,$.jsx)(d.Separator,{})
```

Replacement shape:

```diff
 children:(0,$.jsx)(u,{...L.archiveThread})}),
- null,
+ (0,$.jsx)(CXThreadMenuItems,{context:{...}}),
  (0,$.jsx)(d.Separator,{})
```

Context fields:

```js
{
  conversationId,
  cwd,
  title,
  canPin,
  isPinned,
  isWorktreeThread,
  hasSideChatTab,
  canOpenSideChat,
  canFork,
  canForkIntoWorktree,
  canAddScheduledTask,
  canOpenInNewWindow,
  isTurnInProgress,
  archiveNavigation,
  archiveSource
}
```

Update notes:

- Re-find the thread overflow component by locating the thread menu items such as pin, rename, archive, side chat, copy, fork, scheduled task, and open in new window.
- Reuse Codex menu primitives from that bundle; do not render a separate menu system.
- Keep extension-specific menu behavior inside extension code.
