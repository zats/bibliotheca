"use strict";

function activate(context) {
  const { bridge, ipcRenderer } = context;
  bridge.codexbarListAccounts = async () =>
    ipcRenderer.invoke("codex_desktop:accounts-list");
  bridge.codexbarSwitchAccount = async (accountId) =>
    ipcRenderer.invoke("codex_desktop:accounts-switch", accountId);
  bridge.codexbarAddAccount = async () =>
    ipcRenderer.invoke("codex_desktop:accounts-add");
  bridge.codexbarLogoutCurrentAccount = async () =>
    ipcRenderer.invoke("codex_desktop:accounts-logout-current");
}

module.exports = { activate };
