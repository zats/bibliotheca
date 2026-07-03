(function () {
  const EXTENSION_ID = "thread-colors";
  const STORAGE_VERSION = 1;
  const CUSTOM_COLOR_ID = "custom";
  const COLORS = [
    { id: "default", label: "Default", value: null, dot: "#bdbdbd" },
    { id: "blue", label: "Blue", value: { light: "#3b82f6", dark: "#2563eb" } },
    { id: "green", label: "Green", value: { light: "#55b867", dark: "#2f855a" } },
    { id: "yellow", label: "Yellow", value: { light: "#f6c343", dark: "#b7791f" } },
    { id: "pink", label: "Pink", value: { light: "#e36f69", dark: "#be4b49" } },
    { id: "orange", label: "Orange", value: { light: "#ef7d3a", dark: "#c05621" } },
    { id: "purple", label: "Purple", value: { light: "#8b5cf6", dark: "#6d28d9" } },
    { id: "black", label: "Black", value: { light: "#050505", dark: "#1f1f1f" } },
  ];
  const COLOR_BY_ID = new Map(COLORS.map((color) => [color.id, color]));
  const listeners = new Set();
  let settings = { version: STORAGE_VERSION, threads: {} };
  let settingsReady = false;
  let currentThreadId = null;
  let activeColorScheme = null;
  let colorInput = null;
  let threadListMarkerObserver = null;
  let threadListMarkerAnimationFrame = null;

  function storage() {
    return window.extensions?.host;
  }

  async function loadSettings() {
    const loaded = await storage().readSettings(EXTENSION_ID);
    settings = normalizeSettings(loaded);
    settingsReady = true;
  }

  function normalizeSettings(value) {
    const threads =
      value && typeof value === "object" && value.threads && typeof value.threads === "object"
        ? value.threads
        : {};
    return { version: STORAGE_VERSION, threads };
  }

  async function saveSettings() {
    await storage().writeSettings(EXTENSION_ID, settings);
  }

  function parseThreadId() {
    return parseThreadIdFromPath(window.location.pathname);
  }

  function parseThreadIdFromPath(pathname) {
    const parts = pathname.split("/").filter(Boolean);
    const routeIndex = parts.findIndex((part) =>
      ["local", "remote", "thread", "conversation"].includes(part),
    );
    if (routeIndex >= 0 && parts[routeIndex + 1]) {
      return decodeURIComponent(parts[routeIndex + 1]);
    }
    return null;
  }

  function selectedColorId(threadId = currentThreadId) {
    if (!threadId) {
      return "default";
    }
    const thread = settings.threads[threadId];
    if (thread?.color === CUSTOM_COLOR_ID && customColorValue(thread)) {
      return CUSTOM_COLOR_ID;
    }
    const selected = thread?.color;
    return COLOR_BY_ID.has(selected) ? selected : "default";
  }

  function selectedColor(threadId = currentThreadId) {
    const thread = threadId ? settings.threads[threadId] : null;
    if (thread?.color === CUSTOM_COLOR_ID) {
      const value = customColorValue(thread);
      if (value) {
        return { id: CUSTOM_COLOR_ID, label: "Custom", value };
      }
    }
    return COLOR_BY_ID.get(selectedColorId(threadId)) ?? COLORS[0];
  }

  function selectedThreadMarkerColor(threadId) {
    const color = selectedColor(threadId);
    return color.id === "default" ? null : colorValue(color);
  }

  function currentColorScheme() {
    return activeColorScheme ?? detectColorScheme();
  }

  function detectColorScheme() {
    const root = document.documentElement;
    if (root.classList.contains("dark")) {
      return "dark";
    }
    if (root.classList.contains("light")) {
      return "light";
    }
    const colorScheme = window.getComputedStyle?.(root).colorScheme;
    if (colorScheme === "dark") {
      return "dark";
    }
    if (colorScheme === "light") {
      return "light";
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function normalizeColorScheme(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.toLowerCase();
    if (normalized.includes("dark")) {
      return "dark";
    }
    if (normalized.includes("light")) {
      return "light";
    }
    return null;
  }

  function colorValue(color, scheme = currentColorScheme()) {
    if (!color?.value) {
      return null;
    }
    if (typeof color.value === "string") {
      return color.value;
    }
    return color.value[scheme] ?? color.value.light ?? null;
  }

  function dotColor(color) {
    return color.dot ?? colorValue(color);
  }

  function customColorValue(thread) {
    if (!thread?.custom || typeof thread.custom !== "object") {
      return null;
    }
    const light = normalizeHex(thread.custom.light);
    const dark = normalizeHex(thread.custom.dark);
    return light && dark ? { light, dark } : null;
  }

  function normalizeHex(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      return `#${[1, 2, 3].map((index) => trimmed[index] + trimmed[index]).join("")}`.toLowerCase();
    }
    return null;
  }

  function pairedCustomColors(hex, scheme = currentColorScheme()) {
    const selected = normalizeHex(hex);
    if (!selected) {
      return null;
    }
    if (scheme === "dark") {
      return { light: adaptColorForScheme(selected, "light"), dark: selected };
    }
    return { light: selected, dark: adaptColorForScheme(selected, "dark") };
  }

  function adaptColorForScheme(hex, targetScheme) {
    const hsl = rgbToHsl(...hexToRgb(hex));
    if (targetScheme === "dark") {
      hsl.l = clamp(hsl.l * 0.72, 0.32, 0.48);
      hsl.s = clamp(hsl.s * 0.96, 0.34, 0.88);
    } else {
      hsl.l = clamp(0.62 + (hsl.l - 0.5) * 0.25, 0.56, 0.7);
      hsl.s = clamp(hsl.s, 0.34, 0.88);
    }
    return rgbToHex(...hslToRgb(hsl.h, hsl.s, hsl.l));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToRgb(hex) {
    const value = hex.slice(1);
    return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b]
      .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function rgbToHsl(r, g, b) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === red) {
        h = ((green - blue) / delta) % 6;
      } else if (max === green) {
        h = (blue - red) / delta + 2;
      } else {
        h = (red - green) / delta + 4;
      }
      h /= 6;
      if (h < 0) {
        h += 1;
      }
    }
    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
  }

  function hslToRgb(h, s, l) {
    const hueToRgb = (p, q, t) => {
      let hue = t;
      if (hue < 0) {
        hue += 1;
      }
      if (hue > 1) {
        hue -= 1;
      }
      if (hue < 1 / 6) {
        return p + (q - p) * 6 * hue;
      }
      if (hue < 1 / 2) {
        return q;
      }
      if (hue < 2 / 3) {
        return p + (q - p) * (2 / 3 - hue) * 6;
      }
      return p;
    };
    if (s === 0) {
      const channel = Math.round(l * 255);
      return [channel, channel, channel];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
      Math.round(hueToRgb(p, q, h) * 255),
      Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    ];
  }

  async function setThreadColor(threadId, colorId) {
    if (!threadId || !COLOR_BY_ID.has(colorId)) {
      return;
    }
    if (colorId === "default") {
      delete settings.threads[threadId];
    } else {
      settings.threads[threadId] = { color: colorId };
    }
    await saveSettings();
    applyThreadColor(threadId);
    notify();
  }

  async function setThreadCustomColor(threadId, hex, shouldSave = true) {
    const custom = pairedCustomColors(hex);
    if (!threadId || !custom) {
      return;
    }
    settings.threads[threadId] = { color: CUSTOM_COLOR_ID, custom };
    if (shouldSave) {
      await saveSettings();
    }
    applyThreadColor(threadId);
    notify();
  }

  function openCustomColorPicker(threadId) {
    if (!threadId) {
      return;
    }
    colorInput ??= createColorInput();
    const current = colorValue(selectedColor(threadId)) ?? "#3b82f6";
    colorInput.value = current;
    colorInput.oninput = () => setThreadCustomColor(threadId, colorInput.value, false);
    colorInput.onchange = () => setThreadCustomColor(threadId, colorInput.value, true);
    colorInput.showPicker();
  }

  function createColorInput() {
    const input = document.createElement("input");
    input.type = "color";
    input.style.position = "fixed";
    input.style.left = "-100px";
    input.style.top = "-100px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.tabIndex = -1;
    document.body.append(input);
    return input;
  }

  function notify() {
    for (const listener of listeners) {
      listener();
    }
    scheduleThreadListMarkers();
  }

  function applyCurrentRouteColor() {
    applyThreadColor(parseThreadId());
  }

  function handleThemeChanged(value) {
    activeColorScheme = normalizeColorScheme(value) ?? detectColorScheme();
    applyCurrentRouteColor();
    scheduleThreadListMarkers();
  }

  function setActiveThread(threadId) {
    if (!threadId) {
      return;
    }
    applyThreadColor(threadId);
    notify();
  }

  function applyThreadColor(threadId) {
    currentThreadId = threadId;
    window.extensions?.threadChrome?.notifyChanged(EXTENSION_ID);
  }

  function patchHistory() {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        window.setTimeout(applyCurrentRouteColor, 0);
        return result;
      };
    }
    window.addEventListener("popstate", applyCurrentRouteColor);
  }

  function installThreadListMarkers() {
    installThreadListMarkerStyles();
    observeThreadListMarkers();
    scheduleThreadListMarkers();
  }

  function installThreadListMarkerStyles() {
    if (document.getElementById("thread-colors-list-marker-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "thread-colors-list-marker-style";
    style.textContent = `
      .app-shell-left-panel [data-thread-colors-row] {
        position: relative;
      }

      .app-shell-left-panel [data-thread-colors-row]::before {
        background: var(--thread-colors-marker);
        border-radius: 2px;
        content: "";
        bottom: 8px;
        left: 22px;
        pointer-events: none;
        position: absolute;
        top: 8px;
        width: 3px;
        z-index: 2;
      }
    `;
    document.head.append(style);
  }

  function observeThreadListMarkers() {
    if (threadListMarkerObserver || !document.body) {
      return;
    }
    threadListMarkerObserver = new MutationObserver(scheduleThreadListMarkers);
    threadListMarkerObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-app-action-sidebar-thread-id", "data-app-action-sidebar-thread-row"],
      childList: true,
      subtree: true,
    });
  }

  function scheduleThreadListMarkers() {
    if (threadListMarkerAnimationFrame) {
      return;
    }
    threadListMarkerAnimationFrame = window.requestAnimationFrame(() => {
      threadListMarkerAnimationFrame = null;
      syncThreadListMarkers();
    });
  }

  function syncThreadListMarkers() {
    const leftPanel = document.querySelector(".app-shell-left-panel");
    if (!leftPanel) {
      return;
    }
    for (const row of leftPanel.querySelectorAll("[data-thread-colors-row]")) {
      row.removeAttribute("data-thread-colors-row");
      row.style.removeProperty("--thread-colors-marker");
    }
    const rows = leftPanel.querySelectorAll(
      "[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id]",
    );
    for (const row of rows) {
      const threadId = parseSidebarThreadId(row.getAttribute("data-app-action-sidebar-thread-id"));
      const markerColor = threadId ? selectedThreadMarkerColor(threadId) : null;
      if (!markerColor) {
        continue;
      }
      row.dataset.threadColorsRow = "true";
      row.style.setProperty("--thread-colors-marker", markerColor);
    }
  }

  function parseSidebarThreadId(value) {
    if (!value) {
      return null;
    }
    const parts = String(value).split(":");
    return parts[parts.length - 1] || null;
  }

  function threadMenuItems(context) {
    const threadId = context?.conversationId;
    if (!threadId) {
      return [];
    }
    const selected = selectedColor(threadId);
    return [
      {
        type: "submenu",
        id: "thread-colors.color",
        label: "Color",
        icon: { type: "dot", color: dotColor(selected) },
        children: [
          ...COLORS.map((color) => ({
            type: "item",
            id: `thread-colors.color.${color.id}`,
            label: color.label,
            icon: { type: "dot", color: dotColor(color) },
            checked: selected.id === color.id,
            onSelect() {
              return setThreadColor(threadId, color.id);
            },
          })),
          { type: "separator", id: "thread-colors.custom.separator" },
          {
            type: "item",
            id: "thread-colors.color.custom",
            label: "Custom...",
            icon: { type: "dot", color: selected.id === CUSTOM_COLOR_ID ? dotColor(selected) : "#bdbdbd" },
            checked: selected.id === CUSTOM_COLOR_ID,
            onSelect() {
              openCustomColorPicker(threadId);
            },
          },
        ],
      },
    ];
  }

  function subscribeToThreadContext() {
    const threadContext = window.extensions?.threadContext;
    if (!threadContext) {
      return;
    }
    const applyContext = (context) => setActiveThread(context?.conversationId);
    applyContext(threadContext.getCurrent());
    threadContext.subscribe(applyContext);
  }

  function registerThreadMenuProvider() {
    window.extensions?.threadMenus?.registerProvider(EXTENSION_ID, threadMenuItems);
  }

  function registerThreadChromeProvider() {
    window.extensions?.threadChrome?.registerProvider(EXTENSION_ID, (context) => {
      const color = selectedColor(context?.conversationId ?? currentThreadId);
      const background = colorValue(color);
      return background ? { background } : null;
    });
  }

  async function start() {
    if (!storage()) {
      return;
    }
    window.extensions.threadColors = {
      colors: COLORS,
      getColor: selectedColorId,
      setColor: setThreadColor,
      setActiveThread,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    registerThreadMenuProvider();
    registerThreadChromeProvider();
    subscribeToThreadContext();
    patchHistory();
    installThreadListMarkers();
    await loadSettings();
    if (currentThreadId) {
      applyThreadColor(currentThreadId);
    } else {
      applyCurrentRouteColor();
    }
    notify();
    window.electronBridge?.subscribeToSystemThemeVariant?.(handleThemeChanged);
    window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.(
      "change",
      handleThemeChanged,
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start().catch(console.error), { once: true });
  } else {
    start().catch(console.error);
  }
})();
