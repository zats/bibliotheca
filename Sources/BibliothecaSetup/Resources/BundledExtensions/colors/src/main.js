"use strict";

function paths() {
  const path = require("node:path");
  const root = path.join(require("node:os").homedir(), ".codex", "extensions", "colors");
  return {
    root,
    store: path.join(root, "thread-colors.json"),
  };
}

function readStore() {
  const fs = require("node:fs");
  const p = paths();
  try {
    if (!fs.existsSync(p.store)) return { version: 1, threads: {} };
    const parsed = JSON.parse(fs.readFileSync(p.store, "utf8"));
    return {
      version: 1,
      threads: parsed && typeof parsed.threads === "object" && parsed.threads ? parsed.threads : {},
    };
  } catch {
    return { version: 1, threads: {} };
  }
}

function writeStore(store) {
  const fs = require("node:fs");
  const path = require("node:path");
  const p = paths();
  fs.mkdirSync(path.dirname(p.store), { recursive: true });
  const temp = `${p.store}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ version: 1, threads: store.threads }, null, 2)}\n`);
  fs.renameSync(temp, p.store);
}

function validHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function normalizeColor(color) {
  if (!color) return null;
  if (!validHex(color.light) || !validHex(color.dark)) return null;
  return {
    light: color.light.toLowerCase(),
    dark: color.dark.toLowerCase(),
  };
}

function activate(context) {
  const { electron } = context;

  electron.ipcMain.handle("codex_desktop:colors-list", async (event) => {
    if (!context.isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    return { colors: readStore().threads };
  });

  electron.ipcMain.handle("codex_desktop:colors-set", async (event, threadId, color) => {
    if (!context.isTrustedIpcEvent(event)) throw Error("Untrusted sender");
    if (typeof threadId !== "string" || !threadId) throw Error("Invalid thread id");
    const store = readStore();
    const normalized = normalizeColor(color);
    if (normalized) {
      store.threads[threadId] = { ...normalized, updatedAt: new Date().toISOString() };
    } else {
      delete store.threads[threadId];
    }
    writeStore(store);
    return { colors: store.threads };
  });

  context.cleanup.add(() => {
    electron.ipcMain.removeHandler("codex_desktop:colors-list");
    electron.ipcMain.removeHandler("codex_desktop:colors-set");
  });
}

module.exports = { activate };
