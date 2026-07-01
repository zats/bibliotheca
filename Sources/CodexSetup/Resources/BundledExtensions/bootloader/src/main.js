"use strict";

function paths() {
  const path = require("node:path");
  const root = path.join(require("node:os").homedir(), ".codex", "extensions");
  return {
    root,
    state: path.join(root, "state.json"),
  };
}

function readJson(filePath) {
  const fs = require("node:fs");
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  const fs = require("node:fs");
  const path = require("node:path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function entryPath(extension, relativePath) {
  if (!relativePath) return null;
  const path = require("node:path");
  const root = path.resolve(extension.dir);
  const target = path.resolve(extension.dir, relativePath);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

function readText(filePath) {
  try {
    return filePath ? require("node:fs").readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
}

function discover(appVersion) {
  const fs = require("node:fs");
  const path = require("node:path");
  const p = paths();
  const state = readJson(p.state) ?? {};
  const extensions = [];
  try {
    for (const item of fs.readdirSync(p.root, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const dir = path.join(p.root, item.name);
      const manifest = readJson(path.join(dir, "manifest.json"));
      if (!manifest || typeof manifest !== "object") continue;
      const id = String(manifest.id ?? item.name);
      const entrypoints = manifest.entrypoints ?? {};
      extensions.push({
        id,
        name: String(manifest.name ?? id),
        description: manifest.description ? String(manifest.description) : null,
        version: manifest.version ?? null,
        codexAppVersion: manifest.codexAppVersion ?? null,
        compatible: manifest.codexAppVersion === appVersion,
        enabled: state[id] !== false,
        internal: manifest.internal === true,
        dir,
        main: entrypoints.main ? String(entrypoints.main) : null,
        preload: entrypoints.preload ? String(entrypoints.preload) : null,
        renderer: entrypoints.renderer ? String(entrypoints.renderer) : null,
      });
    }
  } catch {}
  return extensions.sort((left, right) => Number(left.internal) - Number(right.internal) || left.name.localeCompare(right.name));
}

function publicExtension(extension) {
  return {
    id: extension.id,
    name: extension.name,
    description: extension.description,
    version: extension.version,
    codexAppVersion: extension.codexAppVersion,
    compatible: extension.compatible,
    enabled: extension.enabled,
    internal: extension.internal,
  };
}

function setEnabled(id, enabled, appVersion) {
  const p = paths();
  const state = readJson(p.state) ?? {};
  state[id] = !!enabled;
  writeJson(p.state, state);
  return { extensions: discover(appVersion).map(publicExtension) };
}

function runtimeModules(appVersion) {
  return discover(appVersion)
    .filter((extension) => extension.compatible && extension.enabled && !extension.internal)
    .map((extension) => ({
      extension: publicExtension(extension),
      preloadSource: readText(entryPath(extension, extension.preload)),
      rendererSource: readText(entryPath(extension, extension.renderer)),
    }));
}

function bootloaderPreloadSource() {
  return readText(require("node:path").join(paths().root, "bootloader", "src", "preload.js"));
}

function appBundlePath() {
  const path = require("node:path");
  let current = process.execPath;
  for (;;) {
    if (path.extname(current) === ".app") return current;
    const parent = path.dirname(current);
    if (parent === current) return process.execPath;
    current = parent;
  }
}

function bootloaderRuntime() {
  const key = "__codexExtensionsBootloaderRuntime";
  const previous = globalThis[key];
  if (previous?.cleanup) {
    for (const cleanup of previous.cleanup) {
      try {
        cleanup();
      } catch {}
    }
  }
  const runtime = { cleanup: new Set() };
  globalThis[key] = runtime;
  return {
    add(cleanup) {
      if (typeof cleanup === "function") runtime.cleanup.add(cleanup);
    },
  };
}

function isTrustedIpcEvent(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  return url.startsWith("file://") || url.startsWith("app://") || url.startsWith("codex://");
}

function reloadWindowsSoon(electron, delay = 250) {
  setTimeout(() => {
    try {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        window.webContents.reloadIgnoringCache();
      }
    } catch {}
  }, delay);
}

function activate(context) {
  const electron = context.electron;
  const appVersion = context.appVersion;
  const cleanup = bootloaderRuntime();
  const extensionContext = {
    ...context,
    isTrustedIpcEvent,
    cleanup,
    reloadWindowsSoon: (delay) => reloadWindowsSoon(electron, delay),
  };
  const runtimeModulesHandler = (event) => {
    event.returnValue = isTrustedIpcEvent(event) ? runtimeModules(appVersion) : [];
  };
  const bootloaderPreloadHandler = (event) => {
    event.returnValue = isTrustedIpcEvent(event) ? bootloaderPreloadSource() : null;
  };

  electron.ipcMain.on("codex_desktop:extensions-bootloader-preload-source", bootloaderPreloadHandler);
  electron.ipcMain.handle("codex_desktop:extensions-list", async (event) =>
    isTrustedIpcEvent(event)
      ? { extensions: discover(appVersion).map(publicExtension) }
      : { extensions: [] },
  );
  electron.ipcMain.handle("codex_desktop:extensions-set-enabled", async (event, id, enabled) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    return setEnabled(id, enabled, appVersion);
  });
  electron.ipcMain.handle("codex_desktop:extensions-confirm-reload", async (event) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const result = await electron.dialog.showMessageBox(window ?? undefined, {
      type: "warning",
      message: "Reload Codex?",
      detail: "Reloading Codex can interrupt running threads.",
      buttons: ["Cancel", "Reload"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    return { confirmed: result.response === 1 };
  });
  electron.ipcMain.handle("codex_desktop:extensions-relaunch", async (event) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    require("node:child_process").spawn("/usr/bin/open", ["-n", appBundlePath()], {
      detached: true,
      stdio: "ignore",
    }).unref();
    electron.app.exit(0);
  });
  electron.ipcMain.on("codex_desktop:extensions-runtime-modules", runtimeModulesHandler);
  cleanup.add(() => {
    electron.ipcMain.removeHandler("codex_desktop:extensions-list");
    electron.ipcMain.removeHandler("codex_desktop:extensions-set-enabled");
    electron.ipcMain.removeHandler("codex_desktop:extensions-confirm-reload");
    electron.ipcMain.removeHandler("codex_desktop:extensions-relaunch");
    electron.ipcMain.off("codex_desktop:extensions-bootloader-preload-source", bootloaderPreloadHandler);
    electron.ipcMain.off("codex_desktop:extensions-runtime-modules", runtimeModulesHandler);
  });

  for (const extension of discover(appVersion)) {
    if (!extension.compatible || !extension.enabled || extension.internal || !extension.main) continue;
    try {
      const mod = require(entryPath(extension, extension.main));
      if (typeof mod.activate === "function") {
        mod.activate({ ...extensionContext, extension: publicExtension(extension) });
      }
    } catch (error) {
      try {
        console.error("[codex-ext] main extension failed", extension.id, error);
      } catch {}
    }
  }
}

module.exports = { activate };
