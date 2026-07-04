# Extension Architecture

This project adds an extension system to Codex with minimal app changes and external extension source.

## Goals

- Keep app patches small and reusable across Codex releases.
- Put extension business logic outside the app bundle.
- Prefer general APIs over extension-specific app patches.
- Reuse Codex UI primitives and interaction patterns.
- Keep public extension APIs documented in `docs/apis.md`.

## App Patch Model

The app should only provide extension entry points:

- bootloader loading enabled extensions
- host bridge for extension files and settings
- generic UI/API hooks extensions can register against

Extension-specific behavior belongs in:

```
extensions/extensions/<extension-id>/src/main.js
$CODEX_HOME/extensions/<extension-id>/src/main.js
```

The clean app preparation flow is documented in `docs/prepare-codex.md`.
The local extension development loop is documented in `docs/local-extension-development.md`.

## Bootloader

The bootloader discovers enabled extensions through the registry documented in `docs/apis.md`.

It must create the shared extension namespace if needed. Extension globals live under that namespace, scoped by extension name.

## Extension Source

Runtime paths are rooted at Codex home: `$CODEX_HOME` when set, otherwise `$HOME/.codex`.

Extension ids must be dash-separated path-safe names.

Repository source:

`extensions/extensions/<extension-id>/src/main.js`

Runtime source:

`$CODEX_HOME/extensions/<extension-id>/src/main.js`

During development, keep both synced. The app bundle must not contain extension source.

## Extension Data

Extension data must stay under:

`$CODEX_HOME/extensions/<extension-id>/`

Settings live at:

`$CODEX_HOME/extensions/<extension-id>/settings.json`

Uninstalling an extension must remove its extension folder.

## API Design

API surfaces are demand-driven. Expose the smallest payload that current extension source needs, and keep unrelated Codex internals private.

Before adding app patches:

1. Check whether an existing extension API can support the need.
2. Prove the required fields by reading the extension code that will consume them.
3. Generalize the existing API only as far as current extensions require.
4. Add a new API only when the behavior is genuinely new and used now.
5. Update `docs/apis.md`.
6. Update existing extensions to match the API.

## UI Design

Extensions should borrow Codex components and mechanics wherever possible.

Thread overflow menu additions must use:

`threadMenus`

Header coloring must use:

`threadChrome`

Extension UI should support light and dark mode.
