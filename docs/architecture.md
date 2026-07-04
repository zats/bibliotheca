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
src/extensions/<extension-id>/src/main.js
~/.codex/extensions/<extension-id>/src/main.js
```

The clean app preparation flow is documented in `docs/prepare-codex.md`.

## Bootloader

The bootloader discovers enabled extensions through the registry documented in `docs/apis.md`.

It must create the shared extension namespace if needed. Extension globals live under that namespace, scoped by extension name.

## Extension Source

Extension ids must be dash-separated path-safe names.

Repository source:

`src/extensions/<extension-id>/src/main.js`

Runtime source:

`~/.codex/extensions/<extension-id>/src/main.js`

During development, keep both synced. The app bundle must not contain extension source.

## Extension Data

Extension data must stay under:

`~/.codex/extensions/<extension-id>/`

Settings live at:

`~/.codex/extensions/<extension-id>/settings.json`

Uninstalling an extension must remove its extension folder.

## API Design

Before adding app patches:

1. Check whether an existing extension API can support the need.
2. Generalize the existing API if that keeps the surface coherent.
3. Add a new API only when the behavior is genuinely new.
4. Update `docs/apis.md`.
5. Update existing extensions to match the API.

## UI Design

Extensions should borrow Codex components and mechanics wherever possible.

Thread overflow menu additions must use:

`threadMenus`

Header coloring must use:

`threadChrome`

Extension UI should support light and dark mode.
