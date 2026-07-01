"use strict";

function json(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function paths() {
  const path = require("node:path");
  const os = require("node:os");
  const extensionRoot = path.join(os.homedir(), ".codex", "extensions", "accounts");
  const liveHome = path.join(os.homedir(), ".codex");
  return {
    extensionRoot,
    liveHome,
    liveAuth: path.join(liveHome, "auth.json"),
    registry: path.join(extensionRoot, "managed-accounts.json"),
    homes: path.join(extensionRoot, "homes"),
  };
}

function readFile(filePath) {
  const fs = require("node:fs");
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch {
    return null;
  }
}

function claims(token) {
  if (typeof token !== "string") return null;
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

function fingerprint(value) {
  const crypto = require("node:crypto");
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)))
    .digest("hex");
}

function identityFromAuth(auth, authFingerprint) {
  const tokens = auth?.tokens ?? auth ?? {};
  const tokenClaims = claims(tokens.id_token) || claims(tokens.access_token) || {};
  const authClaims = tokenClaims["https://api.openai.com/auth"] ?? {};
  const profileClaims = tokenClaims["https://api.openai.com/profile"] ?? {};
  return {
    email: profileClaims.email ?? tokenClaims.email ?? auth?.email ?? null,
    providerAccountID:
      tokens.account_id ??
      authClaims.chatgpt_account_id ??
      authClaims.account_id ??
      auth?.providerAccountID ??
      null,
    userId: authClaims.chatgpt_user_id ?? authClaims.user_id ?? auth?.userId ?? null,
    plan: authClaims.chatgpt_plan_type ?? auth?.plan ?? null,
    workspaceLabel: auth?.workspaceLabel ?? authClaims.workspace_name ?? null,
    workspaceAccountID: auth?.workspaceAccountID ?? authClaims.account_id ?? null,
    authFingerprint,
  };
}

function identityFromFile(filePath) {
  const contents = readFile(filePath);
  if (!contents) return null;
  const parsed = json(contents.toString("utf8"));
  return parsed ? identityFromAuth(parsed, fingerprint(contents)) : null;
}

function normalizeRegistry(raw) {
  if (Array.isArray(raw)) return { kind: "array", raw, accounts: raw };
  if (raw && Array.isArray(raw.accounts)) {
    return { kind: "accounts", raw, accounts: raw.accounts };
  }
  if (raw && typeof raw === "object") {
    return {
      kind: "object",
      raw,
      accounts: Object.values(raw).filter((entry) => entry && typeof entry === "object" && entry.id),
    };
  }
  return { kind: "accounts", raw: { accounts: [] }, accounts: [] };
}

function readRegistry() {
  const p = paths();
  const contents = readFile(p.registry);
  if (!contents) return normalizeRegistry(null);
  return normalizeRegistry(json(contents.toString("utf8")));
}

function writeRegistry(registry, accounts) {
  const fs = require("node:fs");
  const path = require("node:path");
  const p = paths();
  let body;
  if (registry.kind === "array") {
    body = accounts;
  } else if (registry.raw && typeof registry.raw === "object" && !Array.isArray(registry.raw)) {
    body = { ...registry.raw, accounts };
  } else {
    body = { accounts };
  }
  fs.mkdirSync(path.dirname(p.registry), { recursive: true });
  fs.writeFileSync(p.registry, `${JSON.stringify(body, null, 2)}\n`);
}

function sameIdentity(left, right) {
  return !!(
    left &&
    right &&
    ((left.providerAccountID &&
      right.providerAccountID &&
      left.providerAccountID === right.providerAccountID) ||
      (left.userId && right.userId && left.userId === right.userId) ||
      (left.workspaceAccountID &&
        right.workspaceAccountID &&
        left.workspaceAccountID === right.workspaceAccountID) ||
      (!left.providerAccountID &&
        !right.providerAccountID &&
        !left.workspaceAccountID &&
        !right.workspaceAccountID &&
        left.email &&
        right.email &&
        String(left.email).toLowerCase() === String(right.email).toLowerCase()) ||
      (left.authFingerprint &&
        right.authFingerprint &&
        left.authFingerprint === right.authFingerprint))
  );
}

function accountRows() {
  const path = require("node:path");
  const p = paths();
  const registry = readRegistry();
  const live = identityFromFile(p.liveAuth);
  const rows = registry.accounts.map((account) => {
    const managedHomePath =
      account.managedHomePath ??
      account.homePath ??
      account.codexHomePath ??
      path.join(p.homes, account.id);
    const stored = identityFromFile(path.join(managedHomePath, "auth.json")) ?? {};
    const authFingerprint = account.authFingerprint || stored.authFingerprint || null;
    return {
      id: account.id,
      email: account.email ?? stored.email ?? null,
      providerAccountID: account.providerAccountID ?? stored.providerAccountID ?? null,
      userId: account.userId ?? stored.userId ?? null,
      plan: account.plan ?? stored.plan ?? null,
      workspaceLabel: account.workspaceLabel ?? stored.workspaceLabel ?? null,
      workspaceAccountID: account.workspaceAccountID ?? stored.workspaceAccountID ?? null,
      managedHomePath,
      authFingerprint,
      isCurrent: sameIdentity(live, { ...account, ...stored, authFingerprint }),
    };
  });
  if (live && !rows.some((row) => row.isCurrent)) {
    rows.unshift({
      id: "__live__",
      email: live.email,
      providerAccountID: live.providerAccountID,
      userId: live.userId,
      plan: live.plan,
      workspaceLabel: live.workspaceLabel,
      workspaceAccountID: live.workspaceAccountID,
      authFingerprint: live.authFingerprint,
      isCurrent: true,
      isLive: true,
    });
  }
  return {
    accounts: rows.sort(
      (left, right) =>
        Number(right.isCurrent) - Number(left.isCurrent) ||
        String(left.email ?? left.workspaceLabel ?? left.id).localeCompare(
          String(right.email ?? right.workspaceLabel ?? right.id),
        ),
    ),
  };
}

function preserveLive(registry, targetIdentity) {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const p = paths();
  const liveAuth = readFile(p.liveAuth);
  if (!liveAuth) return registry;
  const live = identityFromAuth(json(liveAuth.toString("utf8")) ?? {}, fingerprint(liveAuth));
  if (!live || sameIdentity(live, targetIdentity)) return registry;
  const now = new Date().toISOString();
  const existingIndex = registry.accounts.findIndex((account) => sameIdentity(live, account));
  if (existingIndex >= 0) {
    const existing = registry.accounts[existingIndex];
    const managedHomePath =
      existing.managedHomePath ??
      existing.homePath ??
      existing.codexHomePath ??
      path.join(p.homes, existing.id);
    fs.mkdirSync(managedHomePath, { recursive: true });
    fs.writeFileSync(path.join(managedHomePath, "auth.json"), liveAuth);
    fs.chmodSync(path.join(managedHomePath, "auth.json"), 0o600);
    registry.accounts[existingIndex] = {
      ...existing,
      email: live.email ?? existing.email,
      providerAccountID: live.providerAccountID ?? existing.providerAccountID,
      userId: live.userId ?? existing.userId,
      plan: live.plan ?? existing.plan,
      workspaceLabel: live.workspaceLabel ?? existing.workspaceLabel,
      workspaceAccountID: live.workspaceAccountID ?? existing.workspaceAccountID,
      authFingerprint: live.authFingerprint,
      managedHomePath,
      updatedAt: now,
      lastAuthenticatedAt: now,
    };
    writeRegistry(registry, registry.accounts);
    return registry;
  }
  const id = crypto.randomUUID();
  const managedHomePath = path.join(p.homes, id);
  fs.mkdirSync(managedHomePath, { recursive: true });
  fs.writeFileSync(path.join(managedHomePath, "auth.json"), liveAuth);
  fs.chmodSync(path.join(managedHomePath, "auth.json"), 0o600);
  registry.accounts.push({
    id,
    email: live.email,
    providerAccountID: live.providerAccountID,
    userId: live.userId,
    plan: live.plan,
    workspaceLabel: live.workspaceLabel,
    workspaceAccountID: live.workspaceAccountID,
    authFingerprint: live.authFingerprint,
    managedHomePath,
    createdAt: now,
    updatedAt: now,
    lastAuthenticatedAt: now,
  });
  writeRegistry(registry, registry.accounts);
  return registry;
}

async function prepareAddAccount() {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const p = paths();
  preserveLive(readRegistry(), null);
  try {
    if (fs.existsSync(p.liveAuth)) {
      fs.renameSync(
        p.liveAuth,
        path.join(p.liveHome, `auth.json.accounts-add-${crypto.randomUUID()}`),
      );
    }
  } catch {}
  return accountRows();
}

async function switchAccount(account, options = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const accountId = typeof account === "string" ? account : account?.id;
  if (!accountId || accountId === "__live__") throw Error("Invalid account");
  const p = paths();
  const registry = readRegistry();
  const row = accountRows().accounts.find((entry) => entry.id === accountId);
  if (!row?.managedHomePath) throw Error("Managed account not found");
  const managedAuthPath = path.join(row.managedHomePath, "auth.json");
  const managedAuth = fs.readFileSync(managedAuthPath);
  const targetIdentity = identityFromAuth(json(managedAuth.toString("utf8")) ?? {}, fingerprint(managedAuth));
  if (!options.skipPreserveLive) preserveLive(registry, targetIdentity);
  try {
    const live = identityFromFile(p.liveAuth);
    const existing = readRegistry().accounts.find((entry) => sameIdentity(live, entry));
    if (existing) {
      const existingHome =
        existing.managedHomePath ??
        existing.homePath ??
        existing.codexHomePath ??
        path.join(p.homes, existing.id);
      fs.mkdirSync(existingHome, { recursive: true });
      fs.copyFileSync(p.liveAuth, path.join(existingHome, "auth.json"));
      fs.chmodSync(path.join(existingHome, "auth.json"), 0o600);
    }
  } catch {}
  fs.mkdirSync(p.liveHome, { recursive: true });
  const staged = path.join(p.liveHome, `auth.json.accounts-staged-${crypto.randomUUID()}`);
  fs.writeFileSync(staged, managedAuth);
  fs.chmodSync(staged, 0o600);
  fs.renameSync(staged, p.liveAuth);
  try {
    const liveAuth = readFile(p.liveAuth);
    if (liveAuth) {
      fs.writeFileSync(managedAuthPath, liveAuth);
      fs.chmodSync(managedAuthPath, 0o600);
    }
  } catch {}
  const live = identityFromFile(p.liveAuth);
  return { ...accountRows(), switchedTo: live?.email ?? row.email ?? row.workspaceLabel ?? null };
}

async function logoutCurrentAccount(trashItem) {
  const path = require("node:path");
  const p = paths();
  const registry = readRegistry();
  const live = identityFromFile(p.liveAuth);
  const currentIndex = registry.accounts.findIndex((account) => sameIdentity(live, account));
  if (currentIndex < 0) return { ...accountRows(), fallback: true };
  const current = registry.accounts[currentIndex];
  const remaining = registry.accounts.filter((_, index) => index !== currentIndex);
  if (remaining.length === 0) return { ...accountRows(), fallback: true };
  const switched = await switchAccount(remaining[0].id, { skipPreserveLive: true });
  writeRegistry(registry, remaining);
  const removedHome =
    current.managedHomePath ??
    current.homePath ??
    current.codexHomePath ??
    path.join(p.homes, current.id);
  try {
    if (typeof trashItem === "function") await trashItem(removedHome);
  } catch {}
  const rows = accountRows();
  const active = rows.accounts.find((account) => account.isCurrent);
  return {
    ...rows,
    removedAccount: current.email ?? current.workspaceLabel ?? current.id,
    switchedTo: switched?.switchedTo ?? active?.email ?? active?.workspaceLabel ?? null,
  };
}

function activate(context) {
  const {
    electron,
    isTrustedIpcEvent,
    reloadWindowsSoon,
    cleanup,
  } = context;
  const handlers = [
    ["codex_desktop:accounts-list", async (event) => {
      if (!isTrustedIpcEvent(event)) return { accounts: [] };
      preserveLive(readRegistry(), null);
      return accountRows();
    }],
    ["codex_desktop:accounts-add", async (event) => {
      if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
      const result = await prepareAddAccount();
      reloadWindowsSoon();
      return result;
    }],
    ["codex_desktop:accounts-switch", async (event, accountId) => {
      if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
      const result = await switchAccount(accountId);
      reloadWindowsSoon();
      return result;
    }],
    ["codex_desktop:accounts-logout-current", async (event) => {
      if (!isTrustedIpcEvent(event)) throw Error("Untrusted sender");
      const result = await logoutCurrentAccount(
        electron.shell?.trashItem?.bind(electron.shell),
      );
      reloadWindowsSoon();
      return result;
    }],
  ];
  for (const [channel, handler] of handlers) {
    electron.ipcMain.handle(channel, handler);
  }
  cleanup.add(() => {
    for (const [channel] of handlers) electron.ipcMain.removeHandler(channel);
  });
}

module.exports = { activate };
