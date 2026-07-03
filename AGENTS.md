This repository is for rapid iteration on Codex app extension system. It is being built outside of the Codex app and requires some considerations as Codex app is being updated often in a closed-source fashion as well as distribution happening via .asar electron package which randomizes compressed source code even if no changes to original source code were made. 

High level description: after each update Codex.app loses all the patched extension code and needs to be patched again.
External macOS app detects this event and kicks off patching again
Patching is meant to be kept minimal:
- **bootloader** - loads all active extensions from external sources
    - extensions can be enabled or disabled from the native macOS app (to be developed) as such we must keep a general `~/.codex/extensions/settings.json` with `{<extension-id>:{enabled:Boolean}}`
    - as such bootstrap must provide a way to get a list of active extensions and no other subsystem should address extensions directly, only a lits of known extensions via bootloader discovery
- **extension API** - generalizable patches over Codex app source making it extensible so that extension business logic can live in the extension source folders
    1. **entry points** - should be as small as possible to minimize thrash when we patch it over new Codex versions
    2. **callbacks** - events extensions need to listen to
    3. We must maintain centralized documentation over extensions API to help future extension developers to find all functionality existing
    4. If New functionality is required for the extension we must first see if we can modify existing API to make it more generalizable
    5. Only as a measure of last resort we should create new API
    6. Any changes to existing APIs must be documented, no historical context needs to be preserved but documentation must be up to date with the latest state
    7. If API is changed we must go through any existing extensions and modify them to adhere to the updated API

# Layout

- `apps/Codex-<version>.original.app` - original Codex app, must never be modified unless user explicitly overrides this instruction referencing it directly
- `apps/Codex-<version>.modified.app` - the app we are currently iterating over. Before any extension iteration, trash the existing modified app, duplicate `apps/Codex-<version>.original.app` into `apps/Codex-<version>.modified.app`, then apply all app patches from `src/infrastructure`, `src/extensions`, and documented patch points.
- `src/infrastructure` where we store minimal generalizable entry points for all extensions allowing to minimize impact on the patches
- `src/extensions` root folder for all extensions known
- `docs/apis.md` always up to date api documentation

While original Codex app is shipping with .asar package inside, you can read docs/unpack.md to understand how we take freshly downloaded app and make it unpacked resigned electron js source code we can iterate on faster

# Goal

Is to build an extensible system on top of Codex app allowing users to write extensions providing functionality on top of Codex
An example of extension can be ability to switch accounts inside of the app that Codex does not provide or ability to change color of a thread to easily tell them apart when switching between threads or anything else

# Challenge

Firstly Codex does not support extensions meaning that each one needs to be coded in directly into the source.
This also means that every release changes the source code completely and we need to recreate extensions from scratch.

# Design principles
When building an extension we must explore similar functionality that already exists in Codex
We must not reinvent design language but instead borrow from existing components and mechanics
All colors picked must work with in-app light/dark mode UI system
All UI components that can be reused must be reused

# Architecture principles
We must minimize invasive changes to the codebase since they will be fragile and the more extensions user builds the more brittle intertwined code dependencies we might introduce
Instead we must always look for a way to create minimal incision that becomes a point for this and future extensions to be injected
An example: we want to add a menu item in the user menu, we should create an extensible system and our plugin should be first implementation loaded from an external file so that later we can leverage integration point for more extensions

We must approach creating extensions as two separate tasks:
1. Find generalizable extension entry points, create minimal integration points with the app itself
2. Document where when and what is being extended so that
    - We have a single centralized extension documentation and any following extension being created can easily know what extension
    - We can easily replicate extensions entry points on the new version of Codex and load actual extension relatively easily
    - Infrastructure (i.e. extension entry points source code) must stay under `src/infrastructure` and only then be integrated into the ...modified.app
    - Specific extensions code must stay outside of the app under `src/extensions`
    - No changes must be only in the .modified.app since it might get updated and we will lose all the progress
3. All extensions must pick a unique dash-separated identifier name
4. All extension data should be stored under `~/.codex/extensions/<extension-id>/` - no data belonging to the extension is allowed to live outside of this folder
5. If extension is uninstalled it must delete its corresponding `~/.codex/extensions/<extension-id>/` folder - no data belonging to the extension is allowed survive extension uninstall

Ultimately we must prioritize code we build to have as little of impact on the original app so that it is easy to integrate it with every changing contents of the app as it is being up to date and seek to create extension point suitable for the currently available extensions
