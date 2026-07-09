(function () {
  const { BrowserWindow, ipcMain } = require("electron");
  const crypto = require("crypto");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { codexHome, extensionsRoot } = require("./extension-paths.js");
  const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function registryPath() {
    return path.join(extensionsRoot(), "settings.json");
  }

  function assertExtensionId(extensionId) {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) {
      throw new Error(`Invalid extension id: ${extensionId}`);
    }
  }

  function settingsPath(extensionId) {
    return path.join(extensionsRoot(), extensionId, "settings.json");
  }

  function sourcePath(extensionId) {
    return path.join(extensionsRoot(), extensionId, "src", "main.js");
  }

  function authPath() {
    return path.join(codexHome(), "auth.json");
  }

  function extensionDataPath(extensionId, relativePath) {
    assertExtensionId(extensionId);
    if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
      throw new Error("Extension data path must be a non-empty string.");
    }
    const extensionRoot = path.resolve(extensionsRoot(), extensionId);
    const resolved = path.resolve(extensionRoot, relativePath);
    if (resolved !== extensionRoot && !resolved.startsWith(`${extensionRoot}${path.sep}`)) {
      throw new Error("Extension data path must stay inside the extension directory.");
    }
    return resolved;
  }

  function packageJsonPath() {
    const resourcesPath = process.env.CODEX_ELECTRON_RESOURCES_PATH?.trim() || process.resourcesPath;
    return path.join(resourcesPath, "app", "package.json");
  }

  async function packageMetadata() {
    try {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath(), "utf8"));
      return {
        codexVersion: packageJson.version ?? null,
        patchPackVersion: packageJson.bibliothecaPatchPackVersion ?? null,
        extensionApiVersion: packageJson.bibliothecaExtensionApiVersion ?? null,
      };
    } catch {
      return {
        codexVersion: null,
        patchPackVersion: null,
        extensionApiVersion: null,
      };
    }
  }

  function codexAppPath() {
    return path.resolve(path.dirname(process.execPath), "..", "..");
  }

  function probePath() {
    return path.join(codexHome(), "extensions", `.${process.pid}.json`);
  }

  async function writeReadyProbe() {
    if (process.env.BIBLIOTHECA_WAIT_FOR_READY !== "1") {
      return false;
    }
    const metadata = await packageMetadata();
    await writeJson(probePath(), {
      timestamp: new Date().toISOString(),
      codexAppPath: codexAppPath(),
      platform: os.platform(),
      ...metadata,
    });
    return true;
  }

  async function readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  async function writeJson(filePath, value) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  ipcMain.handle("codex_extensions:read-extension-registry", async () => readJson(registryPath(), {}));
  ipcMain.handle("codex_extensions:read-extension-script", async (_event, extensionId) => {
    assertExtensionId(extensionId);
    return fs.promises.readFile(sourcePath(extensionId), "utf8");
  });
  ipcMain.handle("codex_extensions:read-settings", async (_event, extensionId) => {
    assertExtensionId(extensionId);
    return readJson(settingsPath(extensionId), null);
  });
  ipcMain.handle("codex_extensions:write-settings", async (_event, extensionId, settings) => {
    assertExtensionId(extensionId);
    await writeJson(settingsPath(extensionId), settings);
    return true;
  });
  ipcMain.handle("codex_extensions:read-data", async (_event, extensionId, relativePath) => {
    return readJson(extensionDataPath(extensionId, relativePath), null);
  });
  ipcMain.handle("codex_extensions:list-data", async (_event, extensionId, relativePath) => {
    const directoryPath = extensionDataPath(extensionId, relativePath);
    try {
      const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  });
  ipcMain.handle("codex_extensions:write-data", async (_event, extensionId, relativePath, value) => {
    await writeJson(extensionDataPath(extensionId, relativePath), value);
    return true;
  });
  ipcMain.handle("codex_extensions:delete-data", async (_event, extensionId, relativePath) => {
    const filePath = extensionDataPath(extensionId, relativePath);
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return true;
  });
  ipcMain.handle("codex_extensions:read-codex-auth", async () => readJson(authPath(), null));
  ipcMain.handle("codex_extensions:write-codex-auth", async (_event, auth) => {
    await writeJson(authPath(), auth);
    return true;
  });
  ipcMain.handle("codex_extensions:remove-codex-auth", async () => {
    try {
      await fs.promises.unlink(authPath());
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return true;
  });
  ipcMain.handle("codex_extensions:reload-window", async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.reload();
    return true;
  });
  ipcMain.handle("codex_extensions:write-ready-probe", writeReadyProbe);
  void writeReadyProbe().catch((error) => {
    console.error("Failed to write Bibliotheca readiness probe", error);
  });
})();
