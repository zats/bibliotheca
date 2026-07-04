(function () {
  const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const activeExtensionIds = [];
  const namespace = (window.extensions ??= {});
  namespace.host ??= window.electronBridge?.extensions;
  const threadMenuProviders = new Map();
  const threadMenuListeners = new Set();
  const threadChromeProviders = new Map();
  const threadChromeListeners = new Set();
  const threadContextListeners = new Set();
  const THREAD_CHROME_TARGET_SELECTOR = "[data-codex-thread-chrome-region]";
  const THREAD_CHROME_CONTENT_SELECTOR = "[data-codex-thread-chrome-content]";
  const TOOLBAR_SELECTOR = ".electron\\:h-toolbar, .h-toolbar, .extension\\:h-toolbar-sm";
  let currentThreadContext = null;
  let threadChromeAnimationFrame = null;
  let threadChromeObserver = null;
  let threadChromeResizeObserver = null;
  const threadChromeResizeElements = new Set();

  function assertExtensionId(extensionId) {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) {
      throw new Error(`Invalid extension id: ${extensionId}`);
    }
  }

  function notifyThreadMenusChanged() {
    for (const listener of threadMenuListeners) {
      listener();
    }
    window.dispatchEvent(new CustomEvent("codex-extension-thread-menu-changed"));
  }

  function notifyThreadContextChanged() {
    for (const listener of threadContextListeners) {
      listener(currentThreadContext);
    }
    window.dispatchEvent(new CustomEvent("codex-extension-thread-context-changed"));
    notifyThreadChromeChanged();
  }

  function notifyThreadChromeChanged() {
    for (const listener of threadChromeListeners) {
      listener();
    }
    window.dispatchEvent(new CustomEvent("codex-extension-thread-chrome-changed"));
    scheduleThreadChromeSync();
  }

  function normalizeMenuItems(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter((item) => item && typeof item === "object");
  }

  namespace.threadMenus ??= {
    registerProvider(extensionId, provider) {
      assertExtensionId(extensionId);
      if (typeof provider !== "function") {
        throw new Error("Thread menu provider must be a function.");
      }
      threadMenuProviders.set(extensionId, provider);
      notifyThreadMenusChanged();
      return () => {
        if (threadMenuProviders.get(extensionId) === provider) {
          threadMenuProviders.delete(extensionId);
          notifyThreadMenusChanged();
        }
      };
    },
    getItems(context) {
      return Array.from(threadMenuProviders.entries()).flatMap(([extensionId, provider]) => {
        try {
          return normalizeMenuItems(provider(context));
        } catch (error) {
          console.error(`Thread menu provider failed: ${extensionId}`, error);
          return [];
        }
      });
    },
    subscribe(listener) {
      threadMenuListeners.add(listener);
      return () => threadMenuListeners.delete(listener);
    },
  };

  namespace.threadContext ??= {
    getCurrent() {
      return currentThreadContext;
    },
    setCurrent(context) {
      currentThreadContext = normalizeThreadContext(context);
      notifyThreadContextChanged();
    },
    subscribe(listener) {
      threadContextListeners.add(listener);
      return () => threadContextListeners.delete(listener);
    },
  };

  namespace.threadChrome ??= {
    registerProvider(extensionId, provider) {
      assertExtensionId(extensionId);
      if (typeof provider !== "function") {
        throw new Error("Thread chrome provider must be a function.");
      }
      threadChromeProviders.set(extensionId, provider);
      notifyThreadChromeChanged();
      return () => {
        if (threadChromeProviders.get(extensionId) === provider) {
          threadChromeProviders.delete(extensionId);
          notifyThreadChromeChanged();
        }
      };
    },
    getTheme(context = currentThreadContext) {
      for (const [extensionId, provider] of threadChromeProviders.entries()) {
        try {
          const theme = normalizeThreadChromeTheme(provider(context));
          if (theme) {
            return theme;
          }
        } catch (error) {
          console.error(`Thread chrome provider failed: ${extensionId}`, error);
        }
      }
      return null;
    },
    notifyChanged(extensionId) {
      assertExtensionId(extensionId);
      notifyThreadChromeChanged();
    },
    subscribe(listener) {
      threadChromeListeners.add(listener);
      return () => threadChromeListeners.delete(listener);
    },
  };

  function normalizeThreadChromeTheme(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const background = normalizeHex(value.background);
    if (!background) {
      return null;
    }
    const foreground = normalizeHex(value.foreground) ?? readableForeground(background);
    const stateBase = stateBackgroundBase(background);
    return {
      background,
      foreground,
      mutedForeground:
        normalizeHex(value.mutedForeground) ??
        mixHex(background, foreground, foreground === "#ffffff" ? 0.72 : 0.64),
      hoverBackground:
        normalizeHex(value.hoverBackground) ??
        mixHex(background, stateBase, stateBase === "#ffffff" ? 0.12 : 0.08),
      activeBackground:
        normalizeHex(value.activeBackground) ??
        mixHex(background, stateBase, stateBase === "#ffffff" ? 0.18 : 0.14),
      borderColor:
        normalizeHex(value.borderColor) ??
        mixHex(background, stateBase, stateBase === "#ffffff" ? 0.22 : 0.18),
    };
  }

  function normalizeThreadContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return {
      conversationId: typeof value.conversationId === "string" ? value.conversationId : null,
      title: typeof value.title === "string" ? value.title : null,
    };
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

  function readableForeground(background) {
    return perceivedBrightness(background) >= 160 ? "#000000" : "#ffffff";
  }

  function stateBackgroundBase(background) {
    return perceivedBrightness(background) < 48 ? "#ffffff" : "#000000";
  }

  function perceivedBrightness(background) {
    const [r, g, b] = hexToRgb(background);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  function hexToRgb(hex) {
    const value = hex.slice(1);
    return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  }

  function mixHex(a, b, amount) {
    const ar = hexToRgb(a);
    const br = hexToRgb(b);
    const mixed = ar.map((channel, index) =>
      Math.round(channel + (br[index] - channel) * amount),
    );
    return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function installThreadChromeRenderer() {
    installThreadChromeStyles();
    if (document.body) {
      observeThreadChromeTargets();
      observeThreadChromeWindow();
      scheduleThreadChromeSync();
      return;
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        observeThreadChromeTargets();
        observeThreadChromeWindow();
        scheduleThreadChromeSync();
      },
      { once: true },
    );
  }

  function installThreadChromeStyles() {
    if (document.getElementById("codex-extension-thread-chrome-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "codex-extension-thread-chrome-style";
    style.textContent = `
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_TARGET_SELECTOR} {
        background-color: var(--codex-thread-chrome-background) !important;
        border-color: var(--codex-thread-chrome-border) !important;
      }

      html[data-codex-thread-chrome-active="true"] header.app-header-tint[data-codex-thread-chrome-region="main"] {
        background: linear-gradient(
          to right,
          transparent 0,
          transparent var(--codex-thread-chrome-main-left),
          var(--codex-thread-chrome-background) var(--codex-thread-chrome-main-left),
          var(--codex-thread-chrome-background) var(--codex-thread-chrome-main-right),
          transparent var(--codex-thread-chrome-main-right),
          transparent 100%
        ) !important;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_TARGET_SELECTOR} :is(svg, path) {
        color: currentColor;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR},
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} :is(button, [role="button"], span, svg) {
        --color-token-text-primary: var(--codex-thread-chrome-foreground) !important;
        --color-token-text-secondary: var(--codex-thread-chrome-foreground) !important;
        --color-token-text-tertiary: var(--codex-thread-chrome-muted-foreground) !important;
        --color-token-border: var(--codex-thread-chrome-border) !important;
        color: var(--codex-thread-chrome-foreground) !important;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR}:is(button, [role="button"]):hover,
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} :is(button, [role="button"]):hover {
        background-color: var(--codex-thread-chrome-hover-background) !important;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR}:is(button, [role="button"]):is([aria-pressed="true"], [data-state="active"], [data-state="open"]),
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} :is(button, [role="button"]):is([aria-pressed="true"], [data-state="active"], [data-state="open"]) {
        background-color: var(--codex-thread-chrome-active-background) !important;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR}:is(button, [role="button"]).bg-token-main-surface-primary,
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} :is(button, [role="button"]).bg-token-main-surface-primary,
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR}:is(button, [role="button"]).bg-token-bg-fog,
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} :is(button, [role="button"]).bg-token-bg-fog {
        background-color: var(--codex-thread-chrome-active-background) !important;
        border-color: var(--codex-thread-chrome-border) !important;
      }

      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR}.bg-token-main-surface-primary,
      html[data-codex-thread-chrome-active="true"] ${THREAD_CHROME_CONTENT_SELECTOR} .bg-token-main-surface-primary {
        background-color: var(--codex-thread-chrome-active-background) !important;
        border-color: var(--codex-thread-chrome-border) !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] :is(button, [role="button"], [role="tab"], svg, span, div) {
        color: var(--codex-thread-chrome-foreground) !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] {
        --app-shell-tab-background: transparent !important;
        --color-token-main-surface-primary: var(--codex-thread-chrome-background) !important;
        --color-token-text-primary: var(--codex-thread-chrome-foreground) !important;
        --color-token-text-secondary: var(--codex-thread-chrome-foreground) !important;
        --color-token-text-tertiary: var(--codex-thread-chrome-muted-foreground) !important;
        --color-token-border: var(--codex-thread-chrome-border) !important;
        color: var(--codex-thread-chrome-foreground) !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] .bg-token-main-surface-primary,
      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] .sticky.right-0 {
        background-color: var(--codex-thread-chrome-background) !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] [role="button"] {
        background-color: var(--codex-thread-chrome-active-background) !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] [role="button"] > .absolute.inset-0,
      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] .bg-\\[var\\(--app-shell-tab-background\\)\\] {
        background-color: transparent !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] [role="button"] > button[role="tab"],
      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] button[role="tab"] {
        background-color: transparent !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] button:not([role="tab"]) {
        background-color: transparent !important;
        border-color: transparent !important;
      }

      html[data-codex-thread-chrome-active="true"] [data-codex-thread-chrome-region="side"] :is([role="button"], button:not([role="tab"])):hover {
        background-color: var(--codex-thread-chrome-hover-background) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function observeThreadChromeTargets() {
    if (threadChromeObserver || !document.body) {
      return;
    }
    threadChromeObserver = new MutationObserver(scheduleThreadChromeSync);
    threadChromeObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleThreadChromeSync() {
    if (threadChromeAnimationFrame) {
      return;
    }
    threadChromeAnimationFrame = window.requestAnimationFrame(() => {
      threadChromeAnimationFrame = null;
      syncThreadChrome();
    });
  }

  function syncThreadChrome() {
    const theme = namespace.threadChrome?.getTheme(currentThreadContext);
    if (!theme) {
      clearThreadChrome();
      return;
    }
    applyThreadChromeVariables(theme);
    syncThreadChromeTargets();
  }

  function applyThreadChromeVariables(theme) {
    const root = document.documentElement;
    root.dataset.codexThreadChromeActive = "true";
    root.style.setProperty("--codex-thread-chrome-background", theme.background);
    root.style.setProperty("--codex-thread-chrome-foreground", theme.foreground);
    root.style.setProperty("--codex-thread-chrome-muted-foreground", theme.mutedForeground);
    root.style.setProperty("--codex-thread-chrome-hover-background", theme.hoverBackground);
    root.style.setProperty("--codex-thread-chrome-active-background", theme.activeBackground);
    root.style.setProperty("--codex-thread-chrome-border", theme.borderColor);
  }

  function clearThreadChrome() {
    const root = document.documentElement;
    delete root.dataset.codexThreadChromeActive;
    for (const name of [
      "--codex-thread-chrome-background",
      "--codex-thread-chrome-foreground",
      "--codex-thread-chrome-muted-foreground",
      "--codex-thread-chrome-hover-background",
      "--codex-thread-chrome-active-background",
      "--codex-thread-chrome-border",
      "--codex-thread-chrome-main-left",
      "--codex-thread-chrome-main-right",
    ]) {
      root.style.removeProperty(name);
    }
    clearThreadChromeTargets();
    clearThreadChromeResizeTargets();
  }

  function clearThreadChromeTargets() {
    for (const element of document.querySelectorAll(THREAD_CHROME_TARGET_SELECTOR)) {
      element.removeAttribute("data-codex-thread-chrome-region");
    }
    for (const element of document.querySelectorAll(THREAD_CHROME_CONTENT_SELECTOR)) {
      element.removeAttribute("data-codex-thread-chrome-content");
    }
  }

  function observeThreadChromeWindow() {
    window.addEventListener("resize", scheduleThreadChromeSync);
  }

  function observeThreadChromeLayout(elements) {
    if (!window.ResizeObserver) {
      return;
    }
    threadChromeResizeObserver ??= new ResizeObserver(scheduleThreadChromeSync);
    const nextElements = new Set(elements.filter(Boolean));
    for (const element of threadChromeResizeElements) {
      if (!nextElements.has(element)) {
        threadChromeResizeObserver.unobserve(element);
        threadChromeResizeElements.delete(element);
      }
    }
    for (const element of nextElements) {
      if (!threadChromeResizeElements.has(element)) {
        threadChromeResizeObserver.observe(element);
        threadChromeResizeElements.add(element);
      }
    }
  }

  function clearThreadChromeResizeTargets() {
    if (!threadChromeResizeObserver) {
      return;
    }
    for (const element of threadChromeResizeElements) {
      threadChromeResizeObserver.unobserve(element);
    }
    threadChromeResizeElements.clear();
  }

  function syncThreadChromeTargets() {
    clearThreadChromeTargets();
    const title = currentThreadContext?.title?.trim();
    if (!title) {
      return;
    }
    const appHeader = document.querySelector("header.app-header-tint");
    const mainViewport = document.querySelector(".app-shell-main-content-viewport");
    if (!appHeader || !mainViewport || !appHeader.textContent?.includes(title)) {
      return;
    }
    const toolbars = Array.from(document.querySelectorAll(TOOLBAR_SELECTOR)).filter(isChromeToolbar);
    const mainRect = mainViewport.getBoundingClientRect();
    const headerRect = appHeader.getBoundingClientRect();
    const sideToolbars = [];
    for (const toolbar of toolbars) {
      if (toolbar === appHeader || toolbar.closest(".app-shell-left-panel")) {
        continue;
      }
      const rect = toolbar.getBoundingClientRect();
      const sameRow =
        Math.abs(rect.top - headerRect.top) <= 4 && Math.abs(rect.height - headerRect.height) <= 8;
      if (sameRow && toolbar.querySelector("[role='tablist']")) {
        sideToolbars.push(toolbar);
      }
    }
    const sideLeft = sideToolbars.length
      ? Math.min(...sideToolbars.map((toolbar) => toolbar.getBoundingClientRect().left))
      : window.innerWidth;
    const zoomFactor = currentCssZoomFactor(appHeader);
    const root = document.documentElement;
    root.style.setProperty(
      "--codex-thread-chrome-main-left",
      `${Math.max(0, Math.floor(mainRect.left / zoomFactor))}px`,
    );
    root.style.setProperty(
      "--codex-thread-chrome-main-right",
      `${Math.ceil(sideLeft / zoomFactor)}px`,
    );
    observeThreadChromeLayout([appHeader, mainViewport, ...sideToolbars]);
    appHeader.dataset.codexThreadChromeRegion = "main";
    syncMainHeaderContentTargets(appHeader, [
      { left: Math.max(0, mainRect.left), right: sideLeft },
      ...sideToolbars.map((toolbar) => {
        const rect = toolbar.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    ]);
    for (const toolbar of sideToolbars) {
      toolbar.dataset.codexThreadChromeRegion = "side";
    }
  }

  function currentCssZoomFactor(referenceElement) {
    const referenceRect = referenceElement?.getBoundingClientRect();
    const referenceHeight = Number.parseFloat(
      referenceElement ? window.getComputedStyle(referenceElement).height : "",
    );
    if (
      referenceRect &&
      Number.isFinite(referenceRect.height) &&
      Number.isFinite(referenceHeight) &&
      referenceHeight > 0
    ) {
      return referenceRect.height / referenceHeight;
    }
    const probe = document.createElement("div");
    probe.style.cssText =
      "height:0;left:-10000px;pointer-events:none;position:fixed;top:0;width:100px;";
    document.body.append(probe);
    const factor = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  }

  function syncMainHeaderContentTargets(appHeader, ranges) {
    for (const element of appHeader.querySelectorAll("button, [role='button'], span, svg, div")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      if (ranges.some((range) => rect.left >= range.left - 1 && rect.right <= range.right + 1)) {
        element.dataset.codexThreadChromeContent = "true";
      }
    }
  }

  function isChromeToolbar(element) {
    if (element.matches("button, [role='button'], [role='tab'], a, input, select, textarea")) {
      return false;
    }
    if (!["DIV", "HEADER", "NAV"].includes(element.tagName)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).display !== "none";
  }

  function enabledExtensionIds(registry) {
    if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
      return [];
    }
    return Object.entries(registry)
      .filter(([extensionId, config]) => {
        return (
          EXTENSION_ID_PATTERN.test(extensionId) &&
          config &&
          typeof config === "object" &&
          !Array.isArray(config) &&
          config.enabled === true
        );
      })
      .map(([extensionId]) => extensionId)
      .sort();
  }

  async function loadScript(extensionId) {
    const source = await namespace.host.readExtensionScript(extensionId);
    const blob = new Blob([`${source}\n//# sourceURL=codex-extension://${extensionId}/src/main.js`], {
      type: "text/javascript",
    });
    const objectUrl = URL.createObjectURL(blob);
    const script = document.createElement("script");
    script.defer = true;
    script.src = objectUrl;
    script.addEventListener(
      "load",
      () => {
        URL.revokeObjectURL(objectUrl);
        window.dispatchEvent(new CustomEvent("codex-extension-loaded"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  }

  async function start() {
    if (!namespace.host?.readExtensionRegistry || !namespace.host?.readExtensionScript) {
      console.error("Codex extension registry API is unavailable.");
      return;
    }
    activeExtensionIds.splice(
      0,
      activeExtensionIds.length,
      ...enabledExtensionIds(await namespace.host.readExtensionRegistry()),
    );
    installThreadChromeRenderer();
    await Promise.all(activeExtensionIds.map(loadScript));
  }

  const ready = start().catch(console.error);

  namespace.bootloader = {
    ready,
    getActiveExtensionIds() {
      return activeExtensionIds.slice();
    },
  };
})();
