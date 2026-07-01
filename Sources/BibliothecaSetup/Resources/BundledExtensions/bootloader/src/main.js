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

function receiptPath(extensionDir) {
  return require("node:path").join(extensionDir, ".bibliotheca-extension-receipt.json");
}

function installedReceipt(extension) {
  return readJson(receiptPath(extension.dir));
}

function compareVersions(left, right) {
  const leftParts = String(left ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    if ((leftParts[index] ?? 0) > (rightParts[index] ?? 0)) return 1;
    if ((leftParts[index] ?? 0) < (rightParts[index] ?? 0)) return -1;
  }
  return 0;
}

function satisfiesVersionRange(version, range) {
  if (!range) return true;
  return String(range).split(/\s+/).filter(Boolean).every((term) => {
    const match = term.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) return false;
    const operator = match[1] || "=";
    const comparison = compareVersions(version, match[2]);
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    return comparison === 0;
  });
}

function extensionCompatible(extension, appVersion) {
  if (extension.codexVersionRange) return satisfiesVersionRange(appVersion, extension.codexVersionRange);
  if (extension.codexAppVersion) return extension.codexAppVersion === appVersion;
  return true;
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
        codexVersionRange: manifest.codexVersionRange ?? null,
        compatible: extensionCompatible(manifest, appVersion),
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
    codexVersionRange: extension.codexVersionRange,
    compatible: extension.compatible,
    enabled: extension.enabled,
    internal: extension.internal,
  };
}

const registryURL = "https://raw.githubusercontent.com/zats/codex-extensions/refs/heads/main/registry.json";

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw Error(`Registry request failed: ${response.status}`);
  return response.json();
}

function resolveRegistryURL(pathOrURL) {
  return new URL(String(pathOrURL), registryURL).toString();
}

function manifestPathForRegistryEntry(entry) {
  return `packages/${ensureSafeExtensionID(entry.id)}/manifest.json`;
}

async function registryExtensions() {
  const index = await fetchJson(registryURL);
  const entries = Array.isArray(index?.extensions) ? index.extensions : [];
  return Promise.all(entries.map(async (entry) => {
    const manifest = await fetchJson(resolveRegistryURL(manifestPathForRegistryEntry(entry)));
    return {
      ...manifest,
      latestVersion: manifest.version,
    };
  }));
}

async function extensionCatalog(appVersion) {
  const installed = discover(appVersion).filter((extension) => !extension.internal);
  const installedByID = new Map(installed.map((extension) => [extension.id, extension]));
  const available = await registryExtensions();
  const rows = [];
  const seen = new Set();

  for (const entry of available) {
    const id = String(entry.id);
    const local = installedByID.get(id);
    const receipt = local ? installedReceipt(local) : null;
    const installedVersion = receipt?.version ?? local?.version ?? null;
    const latestVersion = entry.version ?? entry.latestVersion ?? null;
    const compatible = satisfiesVersionRange(appVersion, entry.codexVersionRange);
    const hasUpdate = !!installedVersion && !!latestVersion && compareVersions(installedVersion, latestVersion) < 0;
    rows.push({
      id,
      name: entry.name ?? local?.name ?? id,
      description: entry.description ?? local?.description ?? null,
      installed: !!local,
      enabled: local?.enabled ?? false,
      installedVersion,
      latestVersion,
      updateAvailable: hasUpdate,
      compatible,
      codexVersionRange: entry.codexVersionRange ?? null,
      canInstall: compatible && !!entry.assetURL && !!entry.sha256,
      canUpdate: !!local && hasUpdate && compatible && !!entry.assetURL && !!entry.sha256,
      canUninstall: !!local,
    });
    seen.add(id);
  }

  for (const local of installed) {
    if (seen.has(local.id)) continue;
    rows.push({
      ...publicExtension(local),
      installed: true,
      installedVersion: installedReceipt(local)?.version ?? local.version ?? null,
      latestVersion: null,
      updateAvailable: false,
      canInstall: false,
      canUpdate: false,
      canUninstall: true,
    });
  }

  return { extensions: rows.sort((left, right) => left.name.localeCompare(right.name)) };
}

async function registryExtension(id) {
  const entries = await registryExtensions();
  return entries.find((entry) => entry.id === id) ?? null;
}

function ensureSafeExtensionID(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id))) throw Error("Invalid extension id");
  return String(id);
}

async function downloadAsset(entry) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const id = ensureSafeExtensionID(entry.id);
  if (!entry.assetURL || !entry.sha256) throw Error("Extension release asset is missing");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `codex-extension-${id}-`));
  const archivePath = path.join(tempDir, `${id}.zip`);
  const response = await fetch(entry.assetURL, { cache: "no-store" });
  if (!response.ok) throw Error(`Download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  if (digest !== entry.sha256) throw Error("Downloaded extension checksum mismatch");
  fs.writeFileSync(archivePath, data);
  return { tempDir, archivePath };
}

function unpackExtension(archivePath, entry, appVersion) {
  const childProcess = require("node:child_process");
  const fs = require("node:fs");
  const path = require("node:path");
  const id = ensureSafeExtensionID(entry.id);
  const stageDir = path.join(path.dirname(archivePath), "stage");
  fs.mkdirSync(stageDir, { recursive: true });
  const result = childProcess.spawnSync("/usr/bin/ditto", ["-x", "-k", archivePath, stageDir], { encoding: "utf8" });
  if (result.status !== 0) throw Error(result.stderr || "Extension archive extraction failed");
  const manifest = readJson(path.join(stageDir, "manifest.json"));
  if (!manifest || manifest.id !== id) throw Error("Extension manifest id mismatch");
  if (manifest.version !== (entry.version ?? entry.latestVersion)) throw Error("Extension manifest version mismatch");
  if (manifest.codexVersionRange !== entry.codexVersionRange) throw Error("Extension compatibility range mismatch");
  if (!extensionCompatible(manifest, appVersion)) throw Error("Extension is not compatible with this Codex version");
  return stageDir;
}

function replaceExtension(stageDir, entry) {
  const fs = require("node:fs");
  const path = require("node:path");
  const id = ensureSafeExtensionID(entry.id);
  const p = paths();
  const destination = path.join(p.root, id);
  const backup = path.join(p.root, `.${id}.backup-${Date.now()}`);
  const restoreUserFiles = (sourceDir, targetDir) => {
    if (!fs.existsSync(sourceDir)) return;
    for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (item.name === "manifest.json" || item.name === ".bibliotheca-extension-receipt.json" || item.name === "src") continue;
      const source = path.join(sourceDir, item.name);
      const target = path.join(targetDir, item.name);
      if (fs.existsSync(target)) continue;
      fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
    }
  };
  fs.mkdirSync(p.root, { recursive: true });
  if (fs.existsSync(destination)) fs.renameSync(destination, backup);
  fs.renameSync(stageDir, destination);
  restoreUserFiles(backup, destination);
  writeJson(receiptPath(destination), {
    id,
    version: entry.version ?? entry.latestVersion,
    repo: entry.repo,
    sha256: entry.sha256,
    installedAt: new Date().toISOString(),
  });
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
}

async function installExtension(id, appVersion) {
  const entry = await registryExtension(ensureSafeExtensionID(id));
  if (!entry) throw Error("Extension not found");
  if (!satisfiesVersionRange(appVersion, entry.codexVersionRange)) throw Error("Extension is not compatible with this Codex version");
  const { tempDir, archivePath } = await downloadAsset(entry);
  try {
    replaceExtension(unpackExtension(archivePath, entry, appVersion), entry);
  } finally {
    require("node:fs").rmSync(tempDir, { recursive: true, force: true });
  }
  return extensionCatalog(appVersion);
}

function uninstallExtension(id, appVersion) {
  const fs = require("node:fs");
  const path = require("node:path");
  const safeID = ensureSafeExtensionID(id);
  const destination = path.join(paths().root, safeID);
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  return extensionCatalog(appVersion);
}

async function autoUpdateExtensions(appVersion) {
  const catalog = await extensionCatalog(appVersion);
  for (const extension of catalog.extensions) {
    if (extension.canUpdate) {
      await installExtension(extension.id, appVersion);
    }
  }
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
    .filter((extension) => extension.enabled && (!extension.internal || extension.id === "extensions-manager"))
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
  electron.ipcMain.handle("codex_desktop:extensions-catalog", async (event) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    return extensionCatalog(appVersion);
  });
  electron.ipcMain.handle("codex_desktop:extensions-check-updates", async (event) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    await autoUpdateExtensions(appVersion);
    return extensionCatalog(appVersion);
  });
  electron.ipcMain.handle("codex_desktop:extensions-install", async (event, id) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    return installExtension(id, appVersion);
  });
  electron.ipcMain.handle("codex_desktop:extensions-uninstall", async (event, id) => {
    if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    return uninstallExtension(id, appVersion);
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
  autoUpdateExtensions(appVersion).catch((error) => console.error("[codex-ext] auto-update failed", error));
  const updateTimer = setInterval(() => {
    autoUpdateExtensions(appVersion).catch((error) => console.error("[codex-ext] auto-update failed", error));
  }, 6 * 60 * 60 * 1000);
  cleanup.add(() => {
    electron.ipcMain.removeHandler("codex_desktop:extensions-list");
    electron.ipcMain.removeHandler("codex_desktop:extensions-set-enabled");
    electron.ipcMain.removeHandler("codex_desktop:extensions-catalog");
    electron.ipcMain.removeHandler("codex_desktop:extensions-check-updates");
    electron.ipcMain.removeHandler("codex_desktop:extensions-install");
    electron.ipcMain.removeHandler("codex_desktop:extensions-uninstall");
    electron.ipcMain.removeHandler("codex_desktop:extensions-confirm-reload");
    electron.ipcMain.removeHandler("codex_desktop:extensions-relaunch");
    electron.ipcMain.off("codex_desktop:extensions-bootloader-preload-source", bootloaderPreloadHandler);
    electron.ipcMain.off("codex_desktop:extensions-runtime-modules", runtimeModulesHandler);
    clearInterval(updateTimer);
  });

  for (const extension of discover(appVersion)) {
    if (!extension.enabled || extension.internal || !extension.main) continue;
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
