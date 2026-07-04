This repository is for rapid iteration on the Codex app extension system. It is being built outside of the Codex app and requires some considerations because Codex app is updated often in a closed-source fashion and distribution happens via an .asar Electron package, which randomizes compressed source code even if no changes to original source code were made.

High level description: after each update Codex.app loses all the patched extension code and needs to be patched again.
External macOS app detects this event and kicks off patching again
Patching is meant to be kept minimal:
- **bootloader** - loads all active extensions from external sources
    - Codex home is `$CODEX_HOME` when set, otherwise `$HOME/.codex`
    - extensions can be enabled or disabled from the native macOS app (to be developed), so we must keep a general `$CODEX_HOME/extensions/settings.json` with `{<extension-id>:{enabled:Boolean}}`
    - bootstrap must provide a way to get a list of active extensions and no other subsystem should address extensions directly, only a list of known extensions via bootloader discovery
    - the bootloader must create `window.extensions` if it does not exist. Extension globals must live under `window.extensions.<extensionName>`; never add extension objects directly onto `window`.
- **extension API** - generalizable patches over Codex app source making it extensible so that extension business logic can live in the extension source folders
    1. **entry points** - should be as small as possible to minimize thrash when we patch it over new Codex versions
    2. **callbacks** - events extensions need to listen to
    3. We must maintain centralized documentation over extension APIs to help future extension developers find existing functionality
    4. If new functionality is required for the extension we must first see if we can modify existing API to make it more generalizable
    5. Extension APIs, event payloads, and context objects must stay limited to data current extension code actually reads.
    6. Only as a measure of last resort we should create new API
    7. Any changes to existing APIs must be documented, no historical context needs to be preserved but documentation must be up to date with the latest state
    8. If API is changed we must go through any existing extensions and modify them to adhere to the updated API
    9. Thread overflow menu additions must use the generic `window.extensions.threadMenus` descriptor API. The app patch provides context and renders descriptors with Codex menu primitives; extension-specific menu logic must stay in the extension.

# Layout

- `apps/Codex-<version>.original.app` - original Codex app, must never be modified unless user explicitly overrides this instruction referencing it directly
- `apps/Codex-<version>.modified.app` - the app we are currently iterating over. Before any extension iteration, delete the existing modified app, duplicate `apps/Codex-<version>.original.app` into `apps/Codex-<version>.modified.app`, then apply app patches from `extensions/infrastructure` and documented patch points.
- `extensions/infrastructure` where we store minimal generalizable entry points for all extensions allowing to minimize impact on the patches
- `extensions/extensions/<extension-id>/src/main.js` is the repository source of truth for each extension. `<extension-id>` must match the extension folder name and be safe for paths. During iteration, sync each extension source into `$CODEX_HOME/extensions/<extension-id>/src/main.js`; do not bundle extension source into `.modified.app`.
- `docs/apis.md` always up to date public extension API documentation
- `docs/architecture.md` always up to date extension architecture and design principles
- `docs/prepare-codex.md` always up to date instructions for turning a clean Codex app into an unpacked, signed app that loads extensions, including target files, exact anchors/search strings, inserted behavior, copied infrastructure files, and update notes

While original Codex app ships with an .asar package inside, you can read `docs/prepare-codex.md` to understand how we take a freshly downloaded app and make it unpacked, re-signed Electron JS source code that loads extensions.

# Goal

Is to build an extensible system on top of Codex app allowing users to write extensions that provide functionality on top of Codex
An example of an extension can be the ability to switch accounts inside of the app that Codex does not provide or the ability to change color of a thread to easily tell them apart when switching between threads or anything else

# Challenge

Codex does not support extensions, meaning that each one needs to be coded directly into the source.
This also means that every release changes the source code completely and we need to recreate extensions from scratch.

# Design principles
When building an extension we must explore similar functionality that already exists in Codex
We must not reinvent design language but instead borrow from existing components and mechanics
All colors picked must work with in-app light/dark mode UI system
All UI components that can be reused must be reused

# Architecture principles
We must minimize invasive changes to the codebase since they will be fragile and the more extensions user builds the more brittle intertwined code dependencies we might introduce
Before adding helper logic, check for existing infrastructure that can own it. Extract common helpers when behavior repeats or is likely to repeat.
Instead we must always look for a way to create minimal incision that becomes a point for this and future extensions to be injected
An example: we want to add a menu item in the user menu, we should create an extensible system and our plugin should be first implementation loaded from an external file so that later we can leverage integration point for more extensions

We must approach creating extensions as two separate tasks:
1. Find generalizable extension entry points, create minimal integration points with the app itself
2. Document where when and what is being extended so that
    - We have single centralized extension documentation and any following extension can easily find existing extension APIs
    - We can easily replicate extensions entry points on the new version of Codex and load actual extension relatively easily
    - Infrastructure (i.e. extension entry points source code) must stay under `extensions/infrastructure` and only then be integrated into the ...modified.app
    - Any app source patch, anchor change, injected helper, copied infrastructure entry point, or patched target file must be documented in `docs/prepare-codex.md` in the same change with exact anchors/search strings
    - Any extension API change must be documented in `docs/apis.md` in the same change
    - Keep API payloads demand-driven; leave Codex internals private until extension source needs a specific field.
    - Specific extension code must stay outside of the app. Repository source lives at `extensions/extensions/<extension-id>/src/main.js`; runtime source lives at `$CODEX_HOME/extensions/<extension-id>/src/main.js`. During development, keep both synced.
    - No changes should exist only in the .modified.app since it might get updated and we will lose all progress
3. All extensions must pick a unique dash-separated identifier name
4. All extension data should be stored under `$CODEX_HOME/extensions/<extension-id>/` - no data belonging to the extension is allowed to live outside of this folder
5. If extension is uninstalled it must delete its corresponding `$CODEX_HOME/extensions/<extension-id>/` folder - no data belonging to the extension is allowed to survive extension uninstall

Ultimately we must prioritize code we build to have as little impact on the original app as possible so that it is easy to integrate it with the ever-changing contents of the app and seek to create extension points suitable for the currently available extensions
