function activate(context) {
  "use strict";
  if (window.__codexColorsExtensionActive) return;
  window.__codexColorsExtensionActive = true;

  const { bridge } = context;
  const state = {
    colors: {},
    activeThreadId: null,
    submenu: null,
    submenuAnchor: null,
    submenuCloseTimer: null,
    customThreadId: null,
    pendingDeleteThreadId: null,
    writeTimer: null,
    writeQueue: new Map(),
    resizeObserver: null,
    resizeObserved: new WeakSet(),
    syncScheduled: false,
  };

  const presets = [
    { name: "Default", light: null, dark: null },
    { name: "Blue", light: "#4285f4", dark: "#6ea8ff" },
    { name: "Green", light: "#4caf5a", dark: "#70d77d" },
    { name: "Yellow", light: "#f6bd3d", dark: "#ffd86a" },
    { name: "Pink", light: "#df746b", dark: "#ff9b92" },
    { name: "Orange", light: "#f37a32", dark: "#ff9d62" },
    { name: "Purple", light: "#8052e6", dark: "#a78bfa" },
    { name: "Black", light: "#000000", dark: "#d9d9d9" },
  ];

  function textOf(node) {
    return (node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function deepQueryAll(selector, root = document) {
    const results = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      results.push(...node.querySelectorAll(selector));
      for (const element of node.querySelectorAll("*")) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    return results;
  }

  function rows() {
    return Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-id]"));
  }

  function activeThreadId() {
    const active =
      document.querySelector('[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id]') ||
      document.querySelector('[aria-current="page"][data-app-action-sidebar-thread-id]');
    const id = active?.getAttribute("data-app-action-sidebar-thread-id") || null;
    if (id) return id;
    return headerRoot() ? state.activeThreadId : null;
  }

  function appIsDark() {
    return (
      document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark") ||
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    );
  }

  function parseHex(hex) {
    const raw = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  function toHex({ r, g, b }) {
    const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  function luminance(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 1;
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function mix(left, right, amount) {
    return {
      r: left.r + (right.r - left.r) * amount,
      g: left.g + (right.g - left.g) * amount,
      b: left.b + (right.b - left.b) * amount,
    };
  }

  function darkVariant(hex) {
    const base = parseHex(hex);
    if (!base) return "#ffffff";
    let candidate = toHex(base);
    for (let amount = 0; luminance(candidate) < 0.45 && amount <= 0.8; amount += 0.1) {
      candidate = toHex(mix(base, { r: 255, g: 255, b: 255 }, amount));
    }
    return candidate;
  }

  function currentColor(entry) {
    if (!entry) return null;
    return appIsDark() ? entry.dark : entry.light;
  }

  function readableText(background) {
    return luminance(background) < 0.42 ? "#ffffff" : "#111111";
  }

  function ensureStyles() {
    if (document.getElementById("codex-colors-style")) return;
    const style = document.createElement("style");
    style.id = "codex-colors-style";
    style.textContent = `
      [data-codex-colors-header-fg="true"],
      [data-codex-colors-header-fg="true"] * {
        color: var(--codex-colors-header-fg) !important;
      }
      [data-codex-colors-header-fg="true"] button:hover {
        background: color-mix(in srgb, var(--codex-colors-header-fg) 12%, transparent) !important;
      }
      [data-codex-colors-header-button="tint"],
      [data-codex-colors-header-button="selected"] {
        background: var(--codex-colors-header-bg) !important;
        border-color: color-mix(in srgb, var(--codex-colors-header-fg) 14%, transparent) !important;
      }
      [data-codex-colors-header-button="tint"]:hover {
        background: color-mix(in srgb, var(--codex-colors-header-bg) 88%, var(--codex-colors-header-fg)) !important;
      }
      [data-codex-colors-header-underlay="true"] {
        position: absolute;
        top: 0;
        bottom: 0;
        pointer-events: none;
        z-index: -1;
      }
      [data-codex-colors-submenu-open="true"] {
        background: var(--color-token-list-hover-background, rgba(0, 0, 0, 0.06)) !important;
      }
      [data-codex-colors-dot="true"] {
        pointer-events: none;
        transition: opacity 120ms ease-out;
        z-index: 0;
      }
    `;
    document.head.append(style);
  }

  function headerRoot() {
    const buttons = Array.from(document.querySelectorAll('button[aria-label="Chat actions"]'));
    const actions =
      buttons
        .map((button) => ({ button, rect: button.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.top >= -2 && rect.top <= 80)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)[0]?.button ||
      null;
    if (!actions) return null;
    const actionRect = actions.getBoundingClientRect();
    let best = actions;
    let bestRect = actionRect;
    for (let node = actions.parentElement; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.top > actionRect.top + 2 || rect.bottom < actionRect.bottom - 2) continue;
      if (rect.height > 80 || rect.left < 180) continue;
      if (rect.width > bestRect.width) {
        best = node;
        bestRect = rect;
      }
    }
    return best;
  }

  function topToolbarRect() {
    return { left: 0, top: 0, right: window.innerWidth, bottom: 46, height: 46 };
  }

  function sidebarBoundary() {
    const firstRow = rows()[0];
    if (!firstRow) return 0;
    const rowRect = firstRow.getBoundingClientRect();
    let right = rowRect.right;
    for (let node = firstRow.parentElement; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left > rowRect.left + 1 || rect.right < rowRect.right - 1) continue;
      if (rect.right > window.innerWidth * 0.5) continue;
      right = Math.max(right, rect.right);
    }
    return right;
  }

  function scheduleSync() {
    if (state.syncScheduled) return;
    state.syncScheduled = true;
    window.requestAnimationFrame(() => {
      state.syncScheduled = false;
      sync();
    });
  }

  function observeResizeTarget(element) {
    if (!element || state.resizeObserved.has(element)) return;
    if (!state.resizeObserver) state.resizeObserver = new ResizeObserver(scheduleSync);
    state.resizeObserver.observe(element);
    state.resizeObserved.add(element);
  }

  function observeLayoutResize() {
    observeResizeTarget(headerRoot());
    const firstRow = rows()[0];
    if (!firstRow) return;
    const rowRect = firstRow.getBoundingClientRect();
    for (let node = firstRow; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left > rowRect.left + 1 || rect.right < rowRect.right - 1) continue;
      if (rect.right > window.innerWidth * 0.5) continue;
      observeResizeTarget(node);
    }
  }

  function clearHeader() {
    deepQueryAll('[data-codex-colors-header-underlay="true"]').forEach((element) => element.remove());
    deepQueryAll('[data-codex-colors-header="true"], [data-codex-colors-header-fg="true"]').forEach((header) => {
      if (header.dataset.codexColorsPrevBackground !== undefined) {
        header.style.background = header.dataset.codexColorsPrevBackground;
        delete header.dataset.codexColorsPrevBackground;
      } else {
        header.style.removeProperty("background");
      }
      header.style.removeProperty("color");
      header.style.removeProperty("border-color");
      header.style.removeProperty("box-shadow");
      if (header.dataset.codexColorsPrevPosition !== undefined) {
        header.style.position = header.dataset.codexColorsPrevPosition;
        delete header.dataset.codexColorsPrevPosition;
      }
      if (header.dataset.codexColorsPrevZIndex !== undefined) {
        header.style.zIndex = header.dataset.codexColorsPrevZIndex;
        delete header.dataset.codexColorsPrevZIndex;
      }
      if (header.dataset.codexColorsPrevIsolation !== undefined) {
        header.style.isolation = header.dataset.codexColorsPrevIsolation;
        delete header.dataset.codexColorsPrevIsolation;
      }
      header.style.removeProperty("--codex-colors-header-fg");
      header.style.removeProperty("--codex-colors-header-bg");
      header.style.removeProperty("--app-shell-tab-background");
      header.style.removeProperty("--codex-titlebar-tint");
      header.style.removeProperty("--color-token-text-primary");
      header.style.removeProperty("--color-token-text-secondary");
      header.style.removeProperty("--color-token-text-tertiary");
      delete header.dataset.codexColorsHeader;
      delete header.dataset.codexColorsHeaderFg;
      delete header.dataset.codexColorsHeaderButton;
    });
  }

  function applyHeaderForeground(element, foreground) {
    element.dataset.codexColorsHeaderFg = "true";
    element.style.color = foreground;
    element.style.setProperty("--codex-colors-header-fg", foreground);
    element.style.setProperty("--color-token-text-primary", foreground);
    element.style.setProperty("--color-token-text-secondary", foreground);
    element.style.setProperty("--color-token-text-tertiary", foreground);
  }

  function selectedTabColor(color) {
    const base = parseHex(color);
    if (!base) return color;
    return toHex(mix(base, appIsDark() ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }, appIsDark() ? 0.2 : 0.24));
  }

  function selectedTabRoot(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (!node.querySelector) continue;
      if (
        (node.classList?.contains("group/tab") || node.getAttribute?.("role") === "button") &&
        node.querySelector('[role="tab"][aria-selected="true"]')
      ) {
        return node;
      }
    }
    return null;
  }

  function isSelectedHeaderControl(element) {
    if (
      element.matches?.(
        '[aria-selected="true"], [aria-pressed="true"], [aria-current], [data-state="open"], [data-state="active"]',
      )
    ) {
      return true;
    }
    const classes = Array.from(element.classList || []);
    if (classes.includes("bg-token-foreground/5")) {
      return true;
    }
    if (element.querySelector?.('[aria-selected="true"], [aria-pressed="true"], [data-state="open"]')) {
      return true;
    }
    return Boolean(
      element.closest?.(
        '[aria-selected="true"], [aria-pressed="true"], [aria-current], [data-state="open"], [data-state="active"], [role="tab"][aria-selected="true"]',
      ),
    );
  }

  function tintHeaderControl(element, color, foreground) {
    if (isSelectedHeaderControl(element)) return;
    element.dataset.codexColorsHeaderFg = "true";
    element.dataset.codexColorsHeaderButton = "tint";
    element.style.setProperty("--codex-colors-header-bg", color);
    element.style.setProperty("--codex-colors-header-fg", foreground);
    element.style.setProperty("--app-shell-tab-background", color);
  }

  function tintSelectedTab(element, background, foreground) {
    const root = selectedTabRoot(element);
    if (!root) return false;
    root.dataset.codexColorsHeaderFg = "true";
    root.dataset.codexColorsHeaderButton = "selected";
    root.style.setProperty("--codex-colors-header-bg", background);
    root.style.setProperty("--codex-colors-header-fg", foreground);
    root.style.setProperty("--app-shell-tab-background", background);
    applyHeaderForeground(root, foreground);
    for (const child of root.querySelectorAll("[role='tab'], button, [aria-label], span, svg")) {
      applyHeaderForeground(child, foreground);
      child.style.setProperty("--app-shell-tab-background", background);
    }
    return true;
  }

  function tintOpenHeaderControl(element, background, foreground) {
    if (element.getAttribute?.("aria-pressed") === "true") return false;
    if (element.matches?.('[role="tab"], [aria-selected="true"]')) return false;
    const isOpen = element.getAttribute?.("data-state") === "open" || element.getAttribute?.("aria-expanded") === "true";
    if (!isOpen) return false;
    element.dataset.codexColorsHeaderFg = "true";
    element.dataset.codexColorsHeaderButton = "selected";
    element.style.setProperty("--codex-colors-header-bg", background);
    element.style.setProperty("--codex-colors-header-fg", foreground);
    element.style.setProperty("--app-shell-tab-background", background);
    applyHeaderForeground(element, foreground);
    element.style.setProperty("background", background, "important");
    element.style.setProperty("color", foreground, "important");
    for (const child of element.querySelectorAll("button, [aria-label], span, svg")) {
      applyHeaderForeground(child, foreground);
      child.style.setProperty("color", foreground, "important");
    }
    return true;
  }

  function shouldSkipHeaderForeground(element) {
    if (!isSelectedHeaderControl(element)) return false;
    return Boolean(element.closest?.("[role='tab'], [role='button'], button") || element.matches?.("[role='tab'], [role='button'], button"));
  }

  function nativeRightPanelToolbarElements(contentLeft, toolbarRect) {
    return Array.from(document.querySelectorAll(".h-toolbar.bg-token-main-surface-primary")).filter((element) => {
      if (element.classList.contains("app-header-tint")) return false;
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 0 &&
        rect.left >= contentLeft - 2 &&
        rect.top <= toolbarRect.top + 2 &&
        rect.bottom >= toolbarRect.bottom - 2 &&
        rect.height <= toolbarRect.height + 8
      );
    });
  }

  function appHeaderElement() {
    return document.querySelector("header.app-header-tint") || headerRoot()?.closest("header");
  }

  function prepareUnderlayHost(element) {
    if (!element) return;
    const style = getComputedStyle(element);
    element.dataset.codexColorsHeader = "true";
    if (style.position === "static") {
      element.dataset.codexColorsPrevPosition = element.style.position;
      element.style.position = "relative";
    }
    element.dataset.codexColorsPrevIsolation = element.style.isolation;
    element.style.isolation = "isolate";
  }

  function addHeaderUnderlay(parent, left, width, color) {
    if (!parent) return;
    if (width <= 0) return;
    prepareUnderlayHost(parent);
    const underlay = document.createElement("div");
    underlay.dataset.codexColorsHeaderUnderlay = "true";
    underlay.style.left = `${left}px`;
    underlay.style.width = `${width}px`;
    underlay.style.background = color;
    parent.prepend(underlay);
  }

  function applyHeader() {
    clearHeader();
    const id = activeThreadId();
    state.activeThreadId = id;
    const color = currentColor(state.colors[id]);
    if (!id || !color) return;
    const header = appHeaderElement();
    if (!header) return;
    const foreground = readableText(color);
    const selectedBackground = selectedTabColor(color);
    const selectedForeground = readableText(selectedBackground);
    const toolbarRect = topToolbarRect();
    const contentLeft = sidebarBoundary();
    const rightPanelToolbars = nativeRightPanelToolbarElements(contentLeft, toolbarRect);
    const rightPanelLeft = rightPanelToolbars.reduce((left, element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 ? Math.min(left, rect.left) : left;
    }, window.innerWidth);
    const isInsideRightPanelToolbar = (element) => rightPanelToolbars.some((toolbar) => toolbar.contains(element));
    const isMainToolbar = (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= toolbarRect.top &&
      rect.top <= toolbarRect.bottom &&
      rect.bottom <= toolbarRect.bottom + 2 &&
      rect.height <= toolbarRect.height + 24;
    const shouldColorForeground = (rect) =>
      isMainToolbar(rect) && (contentLeft <= 0 || rect.left >= contentLeft - 1);

    addHeaderUnderlay(header, contentLeft, Math.max(0, rightPanelLeft - contentLeft), color);
    for (const toolbar of rightPanelToolbars) {
      const rect = toolbar.getBoundingClientRect();
      if (isMainToolbar(rect)) addHeaderUnderlay(toolbar, 0, rect.width, color);
    }

    const foregroundElements = new Set([
      ...header.querySelectorAll("button, [role='button'], [role='tab'], [aria-label], input, svg, span"),
      ...rightPanelToolbars.flatMap((toolbar) =>
        Array.from(
          toolbar.querySelectorAll(
            "button, [role='button'], [role='tab'], [aria-label], input, svg, span, .sticky",
          ),
        ),
      ),
    ]);
    for (const element of foregroundElements) {
      const rect = element.getBoundingClientRect();
      if (!shouldColorForeground(rect) && !isInsideRightPanelToolbar(element)) continue;
      if (tintSelectedTab(element, selectedBackground, selectedForeground)) continue;
      if (tintOpenHeaderControl(element, selectedBackground, selectedForeground)) continue;
      if (shouldSkipHeaderForeground(element)) continue;
      applyHeaderForeground(element, foreground);
      if (element.matches?.("button, [role='button'], [role='tab']") || element.classList?.contains("sticky")) {
        tintHeaderControl(element, color, foreground);
      }
    }
  }

  function syncRowDots() {
    for (const row of rows()) {
      const threadId = row.getAttribute("data-app-action-sidebar-thread-id");
      const color = currentColor(state.colors[threadId]);
      let dot = row.querySelector('[data-codex-colors-dot="true"]');
      if (!color) {
        dot?.remove();
        continue;
      }
      if (!dot) {
        dot = document.createElement("span");
        dot.dataset.codexColorsDot = "true";
        row.append(dot);
      }
      if (getComputedStyle(row).position === "static") row.style.position = "relative";
      dot.style.position = "absolute";
      dot.style.left = "calc(0.55rem - 4px)";
      dot.style.top = "50%";
      dot.style.width = "3px";
      dot.style.height = "14px";
      dot.style.borderRadius = "2px";
      dot.style.transform = "translateY(-50%)";
      dot.style.zIndex = "0";
      dot.style.opacity = "0.9";
      dot.style.backgroundColor = color;
    }
  }

  function flushWrites() {
    const queue = Array.from(state.writeQueue.entries());
    state.writeQueue.clear();
    for (const [threadId, color] of queue) {
      bridge?.codexColorsSet?.(threadId, color).catch((error) => {
        console.error("[colors] failed to save thread color", error);
      });
    }
  }

  function saveThreadColor(threadId, color, immediate = false) {
    state.writeQueue.set(threadId, color);
    window.clearTimeout(state.writeTimer);
    state.writeTimer = window.setTimeout(flushWrites, immediate ? 0 : 120);
  }

  function setThreadColor(threadId, color, immediate = true) {
    if (!threadId) return;
    if (color?.light && color?.dark) {
      state.colors[threadId] = { light: color.light.toLowerCase(), dark: color.dark.toLowerCase() };
    } else {
      delete state.colors[threadId];
    }
    saveThreadColor(threadId, state.colors[threadId] || null, immediate);
    sync();
  }

  function createMenuRow(label, icon, trailing) {
    const row = document.createElement("div");
    row.setAttribute("role", "menuitem");
    row.tabIndex = -1;
    row.className =
      "no-drag text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm group hover:bg-token-list-hover-background focus:bg-token-list-hover-background cursor-interaction flex items-center gap-3";
    const iconSlot = document.createElement("span");
    iconSlot.className = "flex h-5 w-5 shrink-0 items-center justify-center text-token-text-secondary";
    iconSlot.innerHTML = icon;
    const text = document.createElement("span");
    text.className = "min-w-0 flex-1 truncate";
    text.textContent = label;
    row.append(iconSlot, text);
    if (trailing) row.append(trailing);
    return row;
  }

  function colorIcon(color) {
    if (!color) {
      return '<span style="width:14px;height:14px;border-radius:999px;border:1px solid currentColor;display:block;opacity:.65"></span>';
    }
    return `<span style="width:14px;height:14px;border-radius:999px;background:${color};display:block;box-shadow:0 0 0 1px rgba(0,0,0,.12)"></span>`;
  }

  function chevron() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("ml-auto", "text-token-text-tertiary");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m9 18 6-6-6-6");
    svg.append(path);
    return svg;
  }

  function threadMenu() {
    return Array.from(document.querySelectorAll('[role="menu"]')).find((menu) => {
      const text = textOf(menu);
      return text.includes("Pin chat") && text.includes("Rename chat");
    });
  }

  function archiveItem(menu) {
    return Array.from(menu.querySelectorAll('[role="menuitem"]')).find((row) =>
      textOf(row).includes("Archive chat"),
    );
  }

  function copyItem(menu) {
    return Array.from(menu.querySelectorAll('[role="menuitem"]')).find((row) => textOf(row) === "Copy");
  }

  function insertBeforeArchive(menu, item) {
    const archive = archiveItem(menu);
    if (archive) {
      menu.insertBefore(item, archive);
      return;
    }
    menu.prepend(item);
  }

  function applyNativeMenuRowClass(menu, item) {
    const native = copyItem(menu) || archiveItem(menu);
    if (native?.className) item.className = native.className;
  }

  function closeSubmenu() {
    window.clearTimeout(state.submenuCloseTimer);
    state.submenuCloseTimer = null;
    if (state.submenuAnchor) {
      delete state.submenuAnchor.dataset.codexColorsSubmenuOpen;
    }
    state.submenu?.remove();
    state.submenu = null;
    state.submenuAnchor = null;
  }

  function cancelSubmenuClose() {
    window.clearTimeout(state.submenuCloseTimer);
    state.submenuCloseTimer = null;
  }

  function scheduleSubmenuClose() {
    cancelSubmenuClose();
    state.submenuCloseTimer = window.setTimeout(closeSubmenu, 180);
  }

  function colorPicker() {
    let input = document.getElementById("codex-colors-picker");
    if (input) return input;
    input = document.createElement("input");
    input.id = "codex-colors-picker";
    input.type = "color";
    input.style.position = "fixed";
    input.style.left = "-1000px";
    input.style.top = "-1000px";
    input.addEventListener("input", () => {
      const light = input.value;
      setThreadColor(state.customThreadId, { light, dark: darkVariant(light) }, false);
    });
    input.addEventListener("change", () => {
      const light = input.value;
      setThreadColor(state.customThreadId, { light, dark: darkVariant(light) }, true);
    });
    document.body.append(input);
    return input;
  }

  function openSubmenu(anchor, threadId, rootMenu) {
    if (state.submenu && state.submenuAnchor === anchor) {
      cancelSubmenuClose();
      return;
    }
    closeSubmenu();
    anchor.dataset.codexColorsSubmenuOpen = "true";
    state.submenuAnchor = anchor;
    const menu = document.createElement("div");
    menu.dataset.codexColorsSubmenu = "true";
    menu.setAttribute("role", "menu");
    menu.className =
      rootMenu?.className ||
      "no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border z-50 m-px flex select-none flex-col overflow-y-auto rounded-xl ring-[0.5px] px-1 py-1 shadow-xl-spread backdrop-blur-sm";
    menu.style.position = "fixed";
    menu.style.zIndex = "9999";
    menu.style.minWidth = "180px";
    menu.addEventListener("pointerenter", cancelSubmenuClose);
    menu.addEventListener("pointerleave", scheduleSubmenuClose);

    for (const preset of presets) {
      const row = createMenuRow(preset.name, colorIcon(preset.light), null);
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setThreadColor(threadId, preset.light ? { light: preset.light, dark: preset.dark } : null);
        closeSubmenu();
      });
      menu.append(row);
    }

    const custom = createMenuRow("Custom...", colorIcon(currentColor(state.colors[threadId]) || "#999999"), null);
    custom.addEventListener("pointerdown", (event) => event.preventDefault());
    custom.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.customThreadId = threadId;
      const picker = colorPicker();
      picker.value = state.colors[threadId]?.light || "#3b82f6";
      picker.click();
    });
    menu.append(custom);

    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth || 180;
    const left = Math.min(window.innerWidth - width - 8, rect.right + 6);
    const top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.top);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    state.submenu = menu;
  }

  function paletteSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette-icon lucide-palette"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
  }

  function replaceTextNode(root, from, to) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue?.trim() === from) {
        node.nodeValue = node.nodeValue.replace(from, to);
        return true;
      }
    }
    return false;
  }

  function createNativeColorItem(menu) {
    const template = copyItem(menu);
    if (!template) return null;
    const item = template.cloneNode(true);
    item.dataset.codexColorsMenuItem = "true";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    replaceTextNode(item, "Copy", "Color");
    const svg = item.querySelector("svg");
    if (svg) svg.outerHTML = paletteSvg();
    return item;
  }

  function injectMenu() {
    const menu = threadMenu();
    if (!menu) {
      closeSubmenu();
      return;
    }
    if (menu.querySelector('[data-codex-colors-menu-item="true"]')) return;
    const item =
      createNativeColorItem(menu) || createMenuRow("Color", paletteSvg(), chevron());
    item.dataset.codexColorsMenuItem = "true";
    applyNativeMenuRowClass(menu, item);
    item.addEventListener("pointerdown", (event) => event.preventDefault());
    item.addEventListener("pointerenter", () => openSubmenu(item, activeThreadId(), menu));
    item.addEventListener("pointerleave", scheduleSubmenuClose);
    item.addEventListener("focus", () => openSubmenu(item, activeThreadId(), menu));
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSubmenu(item, activeThreadId(), menu);
    });
    if (!menu.dataset.codexColorsPointerClose) {
      menu.dataset.codexColorsPointerClose = "true";
      menu.addEventListener("pointerenter", cancelSubmenuClose);
      menu.addEventListener("pointerleave", scheduleSubmenuClose);
      menu.addEventListener("pointerover", (event) => {
        const row = event.target?.closest?.('[role="menuitem"]');
        if (!row || row.closest('[data-codex-colors-submenu="true"]')) return;
        if (row !== state.submenuAnchor) closeSubmenu();
      });
    }
    insertBeforeArchive(menu, item);
  }

  function sync() {
    ensureStyles();
    observeLayoutResize();
    syncRowDots();
    applyHeader();
    injectMenu();
  }

  async function load() {
    const result = await bridge?.codexColorsList?.();
    state.colors = result?.colors && typeof result.colors === "object" ? result.colors : {};
    sync();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSubmenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!state.submenu) return;
    if (state.submenu.contains(event.target) || event.target?.closest?.('[data-codex-colors-menu-item="true"]')) return;
    closeSubmenu();
  });
  document.addEventListener(
    "click",
    (event) => {
      const control = event.target?.closest?.('button, [role="menuitem"]');
      const label = textOf(control);
      if (!control || !label) return;
      if (/^Delete (chat|thread)$/i.test(label)) {
        state.pendingDeleteThreadId = activeThreadId();
        return;
      }
      if (state.pendingDeleteThreadId && /^Delete$/i.test(label)) {
        setThreadColor(state.pendingDeleteThreadId, null);
        state.pendingDeleteThreadId = null;
      }
      if (/^Cancel$/i.test(label)) {
        state.pendingDeleteThreadId = null;
      }
    },
    true,
  );

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "aria-current",
      "data-app-action-sidebar-thread-active",
      "data-app-action-sidebar-thread-id",
      "role",
      "aria-label",
    ],
  });
  window.addEventListener("resize", scheduleSync);
  window.setInterval(sync, 500);
  load().catch((error) => console.error("[colors] failed to load", error));
}

module.exports = { activate };
