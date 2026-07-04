(function () {
  const { ipcMain } = require("electron");
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
    await fs.promises.mkdir(path.dirname(probePath()), { recursive: true });
    await fs.promises.writeFile(
      probePath(),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        codexAppPath: codexAppPath(),
        platform: os.platform(),
        ...metadata,
      })}\n`,
      "utf8",
    );
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
  ipcMain.handle("codex_extensions:write-ready-probe", writeReadyProbe);
  void writeReadyProbe().catch((error) => {
    console.error("Failed to write Bibliotheca readiness probe", error);
  });
})();
