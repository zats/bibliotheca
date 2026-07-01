"use strict";

function runtimeModules(context) {
  try {
    return context.ipcRenderer.sendSync("codex_desktop:extensions-runtime-modules", context.appVersion) || [];
  } catch (error) {
    console.error("[codex-ext] module discovery failed", error);
    return [];
  }
}

function evaluate(source, context, extension) {
  const module = { exports: {} };
  return new Function("module", "exports", "context", `${source}\n;return module.exports;`)(
    module,
    module.exports,
    { ...context, extension },
  );
}

function activateRendererExtensions(context) {
  for (const entry of runtimeModules(context)) {
    if (!entry.rendererSource) continue;
    try {
      const mod = evaluate(entry.rendererSource, context, entry.extension);
      if (typeof mod.activate === "function") {
        mod.activate({ ...context, extension: entry.extension });
      }
    } catch (error) {
      console.error("[codex-ext] renderer extension failed", entry.extension?.id, error);
    }
  }
}

function activate(context) {
  const run = () => activateRendererExtensions(context);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

module.exports = { activate };
