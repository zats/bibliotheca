function activate(context) {
  "use strict";
  const { bridge } = context;

  const state = {
    extensionsView: false,
  };

  function textOf(node) {
    return (node?.textContent || "").trim();
  }

  async function extensionRows() {
    const result = await bridge?.codexExtensionsList?.();
    const rows = Array.isArray(result?.extensions) ? result.extensions : [];
    return rows.filter((extension) => extension.id !== "extensions-manager" && !extension.internal);
  }

  function settingsContentRoot() {
    if (!document.querySelector("input[placeholder^='Search settings'], input[aria-label*='Search settings']")) {
      return null;
    }
    return Array.from(document.querySelectorAll("div"))
      .find((element) => String(element.className).includes("main-surface") && textOf(element).length > 0);
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
    wrapper.className = "flex flex-col gap-[var(--padding-panel)]";

    const section = document.createElement("div");
    section.className = "flex flex-col gap-2";

    const header = document.createElement("div");
    header.className = "flex h-toolbar items-center justify-between gap-2 px-0 py-0";
    const headerText = document.createElement("div");
    headerText.className = "flex min-w-0 flex-1 flex-col gap-1";
    const title = document.createElement("div");
    title.className = "text-base font-medium text-token-text-primary";
    title.textContent = "Installed";
    headerText.append(title);
    header.append(headerText);

    const group = document.createElement("div");
    group.className = "flex flex-col divide-y-[0.5px] divide-token-border overflow-hidden rounded-lg border border-token-border";
    group.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";

    section.append(header, group);
    wrapper.append(section);
    return { wrapper, group };
  }

  function setSwitchState(toggle, enabled) {
    const stateName = enabled ? "checked" : "unchecked";
    toggle.dataset.state = stateName;
    toggle.setAttribute("aria-checked", String(enabled));
    const track = toggle.querySelector("[data-bibliothecas-switch-track='true']");
    if (track) {
      track.dataset.state = stateName;
      track.className = `relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out ${enabled ? "bg-token-charts-blue" : "bg-token-foreground/10"}`;
    }
    const thumb = toggle.querySelector("[data-bibliothecas-switch-thumb='true']");
    if (thumb) {
      thumb.dataset.state = stateName;
    }
  }

  function createSwitch(extension) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", extension.name || extension.id);
    toggle.className = "inline-flex cursor-interaction items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:rounded-full";

    const track = document.createElement("span");
    track.dataset.codexExtensionsSwitchTrack = "true";
    const thumb = document.createElement("span");
    thumb.dataset.codexExtensionsSwitchThumb = "true";
    thumb.className = "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-200 ease-out data-[state=unchecked]:translate-x-0 h-4 w-4 data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[14px]";
    track.append(thumb);
    toggle.append(track);
    setSwitchState(toggle, !!extension.enabled);

    toggle.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextEnabled = toggle.getAttribute("aria-checked") !== "true";
      setSwitchState(toggle, nextEnabled);
      const result = await bridge?.codexExtensionsConfirmReload?.();
      if (!result?.confirmed) {
        setSwitchState(toggle, !!extension.enabled);
        return;
      }
      await bridge?.codexExtensionsSetEnabled?.(extension.id, nextEnabled);
      await bridge?.codexExtensionsRelaunch?.();
    });

    return toggle;
  }

  function extensionDetail(extension) {
    if (!extension.compatible && extension.codexAppVersion) return "";
    return extension.version ? `Version ${extension.version}` : "";
  }

  function createCompatibilityWarning(extension) {
    if (extension.compatible || !extension.codexAppVersion) return null;
    const warning = document.createElement("span");
    warning.className = "inline-flex h-4 w-4 items-center justify-center text-xs text-token-text-tertiary";
    warning.textContent = "⚠️";
    warning.title = `Version mismatch: this extension was verified for Codex ${extension.codexAppVersion}.`;
    warning.setAttribute("aria-label", warning.title);
    return warning;
  }

  function createExtensionRow(extension) {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-4 p-3";

    const textWrap = document.createElement("div");
    textWrap.className = "flex min-w-0 items-center gap-3";
    const column = document.createElement("div");
    column.className = "flex min-w-0 flex-col gap-1";
    const name = document.createElement("div");
    name.className = "flex min-w-0 items-center gap-1.5 text-sm text-token-text-primary";
    const nameText = document.createElement("span");
    nameText.className = "min-w-0 truncate";
    nameText.textContent = extension.name || extension.id;
    name.append(nameText);
    const warning = createCompatibilityWarning(extension);
    if (warning) name.append(warning);
    column.append(name);

    if (extension.description) {
      const description = document.createElement("div");
      description.className = "text-token-text-secondary min-w-0 text-sm";
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
    action.append(createSwitch(extension));
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
    if (root.querySelector("[data-bibliothecas-settings='true']")) return;
    root.textContent = "";
    const scroller = document.createElement("div");
    scroller.className = "scrollbar-stable flex-1 overflow-y-auto p-panel";
    const content = document.createElement("div");
    content.className = "mx-auto flex w-full flex-col max-w-2xl electron:min-w-[calc(320px*var(--codex-window-zoom))]";
    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-3 pb-panel";
    const headerText = document.createElement("div");
    headerText.className = "flex min-w-0 flex-1 flex-col gap-1.5 pb-panel";
    const title = document.createElement("div");
    title.className = "electron:heading-lg heading-base truncate";
    title.textContent = "Extensions";
    headerText.append(title);
    header.append(headerText);
    const { wrapper, group } = extensionSectionShell();
    const rows = await extensionRows();
    for (const extension of rows) {
      group.append(createExtensionRow(extension));
    }
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "p-3 text-sm text-token-text-secondary";
      empty.textContent = "No extensions found";
      group.append(empty);
    }
    content.append(header, wrapper);
    scroller.append(content);
    root.append(scroller);
  }

  function renderExtensionsSidebarItem() {
    if (!settingsContentRoot()) return;
    if (document.querySelector("[data-bibliothecas-sidebar='true']")) return;
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
    renderExtensionsPage();
  }

  const observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("focus", tick);
  tick();
}

module.exports = { activate };
