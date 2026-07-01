function activate(context) {
  "use strict";
  const { bridge } = context;

  const state = {
    extensionsView: false,
    rows: null,
    loading: false,
    error: null,
  };

  function textOf(node) {
    return (node?.textContent || "").trim();
  }

  function localExtensionRow(extension) {
    return {
      ...extension,
      installed: true,
      installedVersion: extension.version ?? null,
      latestVersion: null,
      updateAvailable: false,
      canInstall: false,
      canUpdate: false,
      canUninstall: true,
    };
  }

  async function loadLocalExtensions() {
    const result = await bridge?.codexExtensionsList?.();
    const rows = Array.isArray(result?.extensions) ? result.extensions : [];
    return rows
      .filter((extension) => extension.id !== "extensions-manager" && !extension.internal)
      .map(localExtensionRow);
  }

  async function loadExtensions(options = {}) {
    if (state.loading) return;
    state.loading = true;
    state.error = null;
    if (!state.rows) {
      try {
        state.rows = await loadLocalExtensions();
      } catch {}
    }
    renderExtensionsPage();
    try {
      const result = options.checkUpdates
        ? await bridge?.codexExtensionsCheckUpdates?.()
        : await bridge?.codexExtensionsCatalog?.();
      const rows = Array.isArray(result?.extensions) ? result.extensions : [];
      state.rows = rows.filter((extension) => extension.id !== "extensions-manager" && !extension.internal);
    } catch (error) {
      state.error = error?.message || "Failed to load extensions";
    } finally {
      state.loading = false;
      renderExtensionsPage();
    }
  }

  function settingsContentRoot() {
    if (!document.querySelector("input[placeholder^='Search settings'], input[aria-label*='Search settings']")) {
      return null;
    }
    const existing = document.querySelector("[data-codex-extensions-content-root='true']");
    if (existing) return existing;
    const headings = Array.from(document.querySelectorAll("h1, h2, [class*='heading']"))
      .filter((element) => {
        const text = textOf(element);
        return text && !element.closest("button") && !element.querySelector("input");
      });
    for (const heading of headings) {
      let current = heading.parentElement;
      while (current && current !== document.body) {
        if (current.querySelector("input[placeholder^='Search settings'], input[aria-label*='Search settings']")) break;
        if (current.querySelectorAll("button, input, [role='switch']").length >= 2) return current;
        current = current.parentElement;
      }
    }
    return null;
  }

  function personalSettingsButtons() {
    if (!settingsContentRoot()) return [];
    return Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const text = textOf(button);
        return [
          "General",
          "Profile",
          "Appearance",
          "Configuration",
          "Personalization",
          "Pets",
          "Keyboard shortcuts",
          "Usage & billing",
        ].includes(text);
      });
  }

  function extensionSectionShell() {
    const wrapper = document.createElement("div");
    wrapper.dataset.codexExtensionsSettings = "true";
    wrapper.className = "flex flex-col";

    const group = document.createElement("div");
    group.className = "flex flex-col divide-y-[0.5px] divide-token-border";

    wrapper.append(group);
    return { wrapper, group };
  }

  function createButton(label, disabled, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "px-0 py-1 text-sm text-token-text-primary hover:text-token-text-secondary disabled:cursor-not-allowed disabled:opacity-40";
    button.textContent = label;
    button.disabled = !!disabled || state.loading;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        state.error = error?.message || "Extension action failed";
        renderExtensionsPage();
      } finally {
        button.disabled = !!disabled || state.loading;
      }
    });
    return button;
  }

  function extensionDetail(extension) {
    if (!extension.compatible) return "Incompatible";
    if (extension.updateAvailable) return `${extension.installedVersion} -> ${extension.latestVersion}`;
    if (extension.installed) return extension.installedVersion ? `Installed ${extension.installedVersion}` : "Installed";
    if (extension.latestVersion) return "";
    return "";
  }

  function createCompatibilityWarning(extension) {
    if (extension.compatible) return null;
    const warning = document.createElement("span");
    warning.className = "inline-flex h-4 w-4 items-center justify-center text-xs text-token-text-tertiary";
    warning.textContent = "!";
    warning.title = extension.codexVersionRange
      ? `Requires Codex ${extension.codexVersionRange}.`
      : "This extension is not compatible with this Codex version.";
    warning.setAttribute("aria-label", warning.title);
    return warning;
  }

  async function mutateExtension(extension, action) {
    const result = await bridge?.codexExtensionsConfirmReload?.();
    if (!result?.confirmed) return;
    if (action === "install" || action === "update") {
      await bridge?.codexExtensionsInstall?.(extension.id);
    } else if (action === "uninstall") {
      await bridge?.codexExtensionsUninstall?.(extension.id);
    }
    await bridge?.codexExtensionsRelaunch?.();
  }

  async function setExtensionEnabled(extension, enabled) {
    const result = await bridge?.codexExtensionsConfirmReload?.();
    if (!result?.confirmed) return;
    await bridge?.codexExtensionsSetEnabled?.(extension.id, enabled);
    await bridge?.codexExtensionsRelaunch?.();
  }

  function createExtensionRow(extension) {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-4 py-3";

    const textWrap = document.createElement("div");
    textWrap.className = "flex min-w-0 items-center gap-3";
    const column = document.createElement("div");
    column.className = "flex min-w-0 flex-col gap-1";
    const name = document.createElement("div");
    name.className = "flex min-w-0 items-center gap-1.5 text-sm font-medium text-token-text-primary";
    const nameText = document.createElement("span");
    nameText.className = "min-w-0 truncate";
    nameText.textContent = extension.name || extension.id;
    name.append(nameText);
    const warning = createCompatibilityWarning(extension);
    if (warning) name.append(warning);
    column.append(name);

    if (extension.description) {
      const description = document.createElement("div");
      description.className = "text-token-text-secondary min-w-0 text-xs";
      description.textContent = extension.description;
      column.append(description);
    }

    const detail = extensionDetail(extension);
    if (detail) {
      const detailNode = document.createElement("div");
      detailNode.className = "text-token-text-tertiary min-w-0 text-xs";
      detailNode.textContent = detail;
      column.append(detailNode);
    }

    textWrap.append(column);
    const action = document.createElement("div");
    action.className = "flex shrink-0 items-center gap-2";
    if (extension.installed) {
      action.append(createButton(extension.enabled ? "Disable" : "Enable", false, () => setExtensionEnabled(extension, !extension.enabled)));
      if (extension.updateAvailable) {
        action.append(createButton("Update", !extension.canUpdate, () => mutateExtension(extension, "update")));
      }
      action.append(createButton("Uninstall", !extension.canUninstall, () => mutateExtension(extension, "uninstall")));
    } else {
      action.append(createButton("Install", !extension.canInstall, () => mutateExtension(extension, "install")));
    }
    row.append(textWrap, action);
    return row;
  }

  async function renderExtensionsPage() {
    if (!state.extensionsView) return;
    const root = settingsContentRoot();
    if (!root) {
      state.extensionsView = false;
      return;
    }
    root.dataset.codexExtensionsContentRoot = "true";
    root.textContent = "";
    const scroller = document.createElement("div");
    scroller.className = "scrollbar-stable flex-1 overflow-y-auto p-panel";
    const content = document.createElement("div");
    content.className = "mx-auto flex w-full flex-col max-w-2xl electron:min-w-[calc(320px*var(--codex-window-zoom))]";
    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-3 pb-4";
    const headerText = document.createElement("div");
    headerText.className = "flex min-w-0 flex-1 flex-col gap-1.5";
    const title = document.createElement("div");
    title.className = "electron:heading-lg heading-base truncate";
    title.textContent = "Extensions";
    headerText.append(title);
    const refresh = createButton("Check", false, async () => {
      await loadExtensions({ checkUpdates: true });
    });
    header.append(headerText);
    header.append(refresh);
    const { wrapper, group } = extensionSectionShell();
    if (!state.rows && !state.loading) {
      loadExtensions();
    }
    const rows = state.rows ?? [];
    if (state.error) {
      const error = document.createElement("div");
      error.className = "mb-3 text-sm text-token-text-secondary";
      error.textContent = state.error;
      content.append(error);
    }
    for (const extension of rows) {
      group.append(createExtensionRow(extension));
    }
    if (state.loading) {
      const loading = document.createElement("div");
      loading.className = "py-3 text-sm text-token-text-secondary";
      loading.textContent = "Loading";
      group.append(loading);
    } else if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "py-3 text-sm text-token-text-secondary";
      empty.textContent = "No extensions found";
      group.append(empty);
    }
    content.append(header, wrapper);
    scroller.append(content);
    root.append(scroller);
  }

  function renderExtensionsSidebarItem() {
    if (!settingsContentRoot()) return;
    if (document.querySelector("[data-codex-extensions-sidebar='true']")) return;
    const usage = personalSettingsButtons().find((button) => textOf(button) === "Usage & billing");
    if (!usage) return;
    const button = usage.cloneNode(true);
    button.dataset.codexExtensionsSidebar = "true";
    button.type = "button";
    button.setAttribute("aria-label", "Extensions");
    button.removeAttribute("data-settings-panel-slug");
    const icon = button.querySelector("svg");
    if (icon) {
      icon.outerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" style="width:20px;height:20px" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.833" stroke-linecap="round" stroke-linejoin="round" class="icon-sm inline-block align-middle lucide lucide-puzzle-icon lucide-puzzle"><g transform="translate(2 2) scale(0.667)"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></g></svg>';
    }
    const label = button.querySelector(".truncate") ?? button.querySelector("span, div");
    if (label) {
      label.textContent = "Extensions";
    } else {
      button.textContent = "Extensions";
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.extensionsView = true;
      for (const item of personalSettingsButtons()) {
        item.removeAttribute("aria-current");
        item.classList.remove("bg-token-list-hover-background");
      }
      button.setAttribute("aria-current", "page");
      button.classList.add("bg-token-list-hover-background");
      renderExtensionsPage();
    });
    usage.insertAdjacentElement("afterend", button);
    for (const item of personalSettingsButtons()) {
      if (item.dataset.codexExtensionsNativeBound === "true") continue;
      item.dataset.codexExtensionsNativeBound = "true";
      item.addEventListener("click", () => {
        state.extensionsView = false;
      }, true);
    }
  }

  function tick() {
    if (personalSettingsButtons().length === 0) {
      state.extensionsView = false;
    }
    renderExtensionsSidebarItem();
  }

  const observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("focus", tick);
  tick();
}

module.exports = { activate };
