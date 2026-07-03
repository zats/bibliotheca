(function () {
  const { ipcMain } = require("electron");
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function extensionsRoot() {
    return path.join(os.homedir(), ".codex", "extensions");
  }

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
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
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
})();
