# Unpacked Codex App

## Goal

Run Codex from unpacked JS files inside a copied app bundle.

Identity must stay unchanged: `CFBundleIdentifier=com.openai.codex`, executable/name/display name `Codex`.

## Steps To Achieve

1. Use the app Sparkle feed to download the latest build. `aria2c` is optional for speed.

`https://persistent.oaistatic.com/codex-app-prod/appcast.xml`

2. Copy `Codex.app` to the target path and set `APP` to that path. Keep `Info.plist` identity unchanged.

3. Unpack app code and remove the ASAR:

```sh
asar extract \
  "$APP"/Contents/Resources/app.asar \
  "$APP"/Contents/Resources/app
rm "$APP"/Contents/Resources/app.asar
```

4. Patch Electron default launcher:

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

Use the `else` branch instead of a top-level `return`; `node --check` rejects top-level `return` in this file.

Why: otherwise Electron shows its default app, or Codex enters dev mode and looks for `bin/codex`. The bundled CLI is:

`Contents/Resources/codex`

5. Re-sign + verify:

```sh
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
node --check "$APP"/Contents/Resources/default_app/main.js
```

6. Smoke test: launch `Contents/MacOS/Codex` with no app path. It must not show Electron default app or `Codex (Dev) failed to start`.

# Browser Use Patch

## Original Goal

Make Browser plugin `iab` work from:

`$APP`

It failed because the app was ad hoc signed and Browser Use rejected the native-pipe peer identity.

## Steps To Achieve

1. Patch:

`$APP/Contents/Resources/app/.vite/build/main-*.js`

2. Change `cd()` to always authorize:

```js
function cd(){return()=>({authorized:!0});if(process.platform!==`darwin`)return()=>({authorized:!0});
```

3. Re-sign outer app:

```sh
codesign --force --sign - "$APP"
```

4. Verify:

```sh
codesign --verify --deep --strict --verbose=2 "$APP"
```

5. Confirm Browser works:

```js
globalThis.browser = await agent.browsers.get("iab");
await tab.goto("https://www.google.com/");
```

Result:

```json
{"title":"Google","url":"https://www.google.com/?zx=1783012842600"}
```
