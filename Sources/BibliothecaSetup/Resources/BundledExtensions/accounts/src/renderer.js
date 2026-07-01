function activate(context) {
  "use strict";
  const { bridge } = context;

  const state = {
    accounts: [],
    switchOpen: false,
    loading: false,
  };
  let activeMenu = null;

  function isElement(value) {
    return value instanceof HTMLElement || value instanceof SVGElement;
  }

  function textOf(node) {
    return (node?.textContent || "").trim();
  }

  function findClickableByText(text) {
    return Array.from(document.querySelectorAll("button, [role='button'], [role='menuitem'], [cmdk-item]"))
      .find((element) => textOf(element) === text);
  }

  function findSettingsMenu() {
    const switchButton = findClickableByText("Switch account");
    if (switchButton?.dataset.accountsExtensionSwitch === "true") {
      for (let node = switchButton.parentElement; node; node = node.parentElement) {
        if (Array.from(node.children).some((child) => textOf(child) === "Log out")) return node;
      }
    }
    const logout = findClickableByText("Log out");
    return logout?.parentElement ?? null;
  }

  function syncMenuLifecycle() {
    const menu = findSettingsMenu();
    if (!menu) {
      activeMenu = null;
      state.switchOpen = false;
      return null;
    }
    if (activeMenu && activeMenu !== menu) {
      state.switchOpen = false;
    }
    activeMenu = menu;
    return menu;
  }

  function buttonBase(extra = "") {
    return `flex h-8 w-full items-center rounded px-2 text-left text-sm text-token-text-primary hover:bg-token-list-hover-background ${extra}`.trim();
  }

  function repeatIcon() {
    const wrapper = document.createElement("span");
    wrapper.className = "icon-xs shrink-0 opacity-75";
    wrapper.style.width = "12.8px";
    wrapper.style.height = "12.8px";
    wrapper.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>';
    return wrapper;
  }

  function chevronIcon(expanded) {
    const wrapper = document.createElement("span");
    wrapper.className = `ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center text-token-text-tertiary ${expanded ? "rotate-90" : ""}`.trim();
    wrapper.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm"><path d="m9 18 6-6-6-6"></path></svg>';
    return wrapper;
  }

  async function loadAccounts() {
    if (state.loading) return;
    state.loading = true;
    try {
      const result = await bridge?.codexbarListAccounts?.();
      state.accounts = Array.isArray(result?.accounts) ? result.accounts : [];
    } catch {
      state.accounts = [];
    } finally {
      state.loading = false;
    }
  }

  async function switchAccount(id) {
    try {
      await bridge.codexbarSwitchAccount(id);
      window.location.reload();
    } catch (error) {
      console.error(error);
    }
  }

  async function addAccount() {
    try {
      await bridge?.codexbarAddAccount?.();
      window.location.reload();
    } catch (error) {
      console.error(error);
    }
  }

  async function logoutCurrentAccount() {
    try {
      const result = await bridge?.codexbarLogoutCurrentAccount?.();
      if (result?.fallback) return false;
      window.location.reload();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  function renderAccountMenu() {
    const menu = syncMenuLifecycle();
    if (!menu || menu.dataset.accountsExtensionMenu === "true") return;
    const logout = findClickableByText("Log out");
    if (!logout || !menu.contains(logout)) return;
    menu.querySelector("[data-accounts-extension-container='true']")?.remove();
    menu.dataset.accountsExtensionMenu = "true";

    const container = document.createElement("div");
    container.dataset.accountsExtensionContainer = "true";

    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm text-token-text-primary hover:bg-token-list-hover-background";
    switchButton.dataset.accountsExtensionSwitch = "true";
    switchButton.setAttribute("aria-expanded", String(state.switchOpen));
    switchButton.append(repeatIcon());
    const label = document.createElement("span");
    label.className = "min-w-0 truncate";
    label.textContent = "Switch account";
    switchButton.append(label);
    switchButton.append(chevronIcon(state.switchOpen));
    switchButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.switchOpen = !state.switchOpen;
      await loadAccounts();
      menu.dataset.accountsExtensionMenu = "false";
      renderAccountMenu();
    });
    container.append(switchButton);

    if (state.switchOpen) {
      const submenu = document.createElement("div");
      submenu.className = "pl-6";
      for (const account of state.accounts) {
        const accountButton = document.createElement("button");
        accountButton.type = "button";
        accountButton.disabled = !!account.isCurrent || account.id === "__live__";
        accountButton.className = buttonBase("disabled:cursor-default disabled:opacity-60");
        accountButton.textContent = `${account.email || account.workspaceLabel || account.id}${account.isCurrent ? " (current)" : ""}`;
        accountButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          switchAccount(account.id);
        });
        submenu.append(accountButton);
      }
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = buttonBase();
      addButton.textContent = "Add account";
      addButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        addAccount();
      });
      submenu.append(addButton);
      container.append(submenu);
    }

    if (logout.dataset.accountsExtensionLogoutBound !== "true") {
      logout.dataset.accountsExtensionLogoutBound = "true";
      logout.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const handled = await logoutCurrentAccount();
          if (!handled) {
            logout.dataset.accountsExtensionBypass = "true";
            logout.click();
          }
        },
        true,
      );
    }

    const personalAccount = Array.from(menu.children).find((child) => textOf(child) === "Personal account");
    if (personalAccount) {
      personalAccount.insertAdjacentElement("afterend", container);
    } else {
      menu.insertBefore(container, logout);
    }
  }

  function tick() {
    renderAccountMenu();
  }

  loadAccounts();
  const observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("focus", () => {
    loadAccounts().then(tick);
  });
  tick();
}

module.exports = { activate };
