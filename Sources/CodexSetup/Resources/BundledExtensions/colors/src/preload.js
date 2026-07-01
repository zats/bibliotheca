"use strict";

function activate(context) {
  const { bridge, ipcRenderer } = context;
  bridge.codexColorsList = async () => ipcRenderer.invoke("codex_desktop:colors-list");
  bridge.codexColorsSet = async (threadId, color) =>
    ipcRenderer.invoke("codex_desktop:colors-set", threadId, color);
}

module.exports = { activate };
