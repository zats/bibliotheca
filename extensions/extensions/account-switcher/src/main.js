(function () {
  const EXTENSION_ID = "account-switcher";
  const LAST_ACCOUNT_KEY = "account-switcher.lastAccountId";
  const LAST_ACCOUNT_PATH = "last-account";
  const LEGACY_PENDING_PREVIOUS_KEY = "account-switcher.pendingPreviousAccountId";
  const LEGACY_PENDING_PREVIOUS_PATH = "pending-add.json";
  const namespace = (window.extensions.accountSwitcher ??= {});
  let state = { activeAccountId: null, accounts: [], lastAccountId: null, loadError: null };
  let stateReady = false;
  let refreshInFlight = null;
  let lastRefreshAt = 0;

  function host() {
    return window.extensions?.host;
  }

  function authPath(accountId) {
    return `auth-${accountId}.json`;
  }

  async function readStoredAuth(accountId) {
    return host().readData(EXTENSION_ID, authPath(accountId));
  }

  async function writeStoredAuth(accountId, auth) {
    await host().writeData(EXTENSION_ID, authPath(accountId), auth);
  }

  async function readLastAccountId() {
    const lastAccount = await host().readData(EXTENSION_ID, LAST_ACCOUNT_PATH);
    const legacyPending = await host().readData(EXTENSION_ID, LEGACY_PENDING_PREVIOUS_PATH);
    const accountId = firstString(
      sessionStorage.getItem(LAST_ACCOUNT_KEY),
      sessionStorage.getItem(LEGACY_PENDING_PREVIOUS_KEY),
      lastAccount?.accountId,
      lastAccount?.previousAccountId,
      legacyPending?.previousAccountId,
    );
    if (lastAccount?.previousAccountId && !lastAccount?.accountId && accountId) {
      await writeLastAccountId(accountId);
    }
    if (legacyPending || sessionStorage.getItem(LEGACY_PENDING_PREVIOUS_KEY)) {
      sessionStorage.removeItem(LEGACY_PENDING_PREVIOUS_KEY);
      await host().deleteData(EXTENSION_ID, LEGACY_PENDING_PREVIOUS_PATH);
      if (accountId) {
        await writeLastAccountId(accountId);
      }
    }
    return accountId;
  }

  async function writeLastAccountId(accountId) {
    sessionStorage.setItem(LAST_ACCOUNT_KEY, accountId);
    await host().writeData(EXTENSION_ID, LAST_ACCOUNT_PATH, { accountId });
  }

  async function clearLastAccountId() {
    sessionStorage.removeItem(LAST_ACCOUNT_KEY);
    sessionStorage.removeItem(LEGACY_PENDING_PREVIOUS_KEY);
    await host().deleteData(EXTENSION_ID, LAST_ACCOUNT_PATH);
    await host().deleteData(EXTENSION_ID, LEGACY_PENDING_PREVIOUS_PATH);
  }

  function currentLastAccountId() {
    return firstString(sessionStorage.getItem(LAST_ACCOUNT_KEY), state.lastAccountId);
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function firstString(...values) {
    return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
  }

  function decodeJwtPayload(token) {
    if (typeof token !== "string") {
      return null;
    }
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    try {
      return JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    } catch {
      return null;
    }
  }

  async function authIdentity(auth) {
    const token = firstString(
      auth?.id_token,
      auth?.idToken,
      auth?.tokens?.id_token,
      auth?.tokens?.idToken,
      auth?.openai?.id_token,
      auth?.openai?.idToken,
    );
    const claims = decodeJwtPayload(token) ?? {};
    const authClaims = claims["https://api.openai.com/auth"] ?? {};
    const fingerprint = await digest(JSON.stringify(auth));
    const accountId = firstString(
      auth?.account_id,
      auth?.accountId,
      auth?.chatgpt_account_id,
      auth?.chatgptAccountId,
      claims["https://api.openai.com/auth.chatgpt_account_id"],
      authClaims.chatgpt_account_id,
      authClaims.account_id,
    );
    const userId = firstString(
      auth?.user_id,
      auth?.userId,
      claims["https://api.openai.com/auth.chatgpt_user_id"],
      authClaims.chatgpt_user_id,
      claims.sub,
    );
    const email = firstString(auth?.email, claims.email, authClaims.email);
    const name = firstString(auth?.name, claims.name, authClaims.name);
    const stableKey = userId ?? email ?? fingerprint;
    return {
      id: accountId ?? (await digest(stableKey)).slice(0, 24),
      accountId,
      userId,
      email,
      name,
      fingerprint,
      label: name ?? email ?? accountId ?? userId ?? "ChatGPT account",
    };
  }

  async function saveAuth(auth) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
      return null;
    }
    const account = await authIdentity(auth);
    await writeStoredAuth(account.id, auth);
    return account;
  }

  async function saveCurrentAccount() {
    return saveAuth(await host().readCodexAuth());
  }

  async function listStoredAccounts() {
    const entries = await host().listData(EXTENSION_ID, ".");
    const accounts = await Promise.all(
      entries
        .filter((entry) => entry.type === "file" && /^auth-[a-z0-9-]+\.json$/.test(entry.name))
        .map(async (entry) => {
          const accountId = entry.name.slice("auth-".length, -".json".length);
          const auth = await readStoredAuth(accountId);
          if (!auth) {
            return null;
          }
          return authIdentity(auth);
        }),
    );
    return accounts.filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));
  }

  async function migrateLegacyStorage() {
    const registry = await host().readData(EXTENSION_ID, "accounts.json");
    const legacyAccounts = Array.isArray(registry?.accounts) ? registry.accounts : [];
    for (const account of legacyAccounts) {
      if (!account?.id) {
        continue;
      }
      const auth = await host().readData(EXTENSION_ID, `accounts/${account.id}/auth.json`);
      if (auth) {
        await saveAuth(auth);
        await host().deleteData(EXTENSION_ID, `accounts/${account.id}/auth.json`);
      }
    }
    if (registry) {
      await host().deleteData(EXTENSION_ID, "accounts.json");
    }
  }

  async function refreshState() {
    await migrateLegacyStorage();
    const auth = await host().readCodexAuth();
    const active = auth ? await saveAuth(auth) : null;
    const accounts = await listStoredAccounts();
    state = {
      activeAccountId: active?.id ?? null,
      accounts,
      lastAccountId: await readLastAccountId(),
      loadError: null,
    };
    stateReady = true;
    lastRefreshAt = Date.now();
    notifyChanged();
    return state;
  }

  function notifyChanged() {
    window.extensions.profileMenus?.notifyChanged(EXTENSION_ID);
    window.extensions.loginRoute?.notifyChanged(EXTENSION_ID);
  }

  function requestRefresh() {
    if (stateReady && Date.now() - lastRefreshAt < 1000) {
      return Promise.resolve(state);
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = refreshState()
      .catch((error) => {
        console.error("Account switcher failed to load accounts", error);
        state = {
          ...state,
          loadError: error instanceof Error ? error.message : String(error),
        };
        stateReady = true;
        notifyChanged();
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  }

  function normalized(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
  }

  function isActiveAccount(account, context) {
    if (state.activeAccountId) {
      return account.id === state.activeAccountId;
    }
    const contextAccountId = normalized(context?.accountId);
    const contextEmail = normalized(context?.email);
    const accountIds = [account.id, account.accountId, account.userId].map(normalized).filter(Boolean);
    if (contextAccountId && accountIds.includes(contextAccountId)) {
      return true;
    }
    return contextEmail != null && normalized(account.email) === contextEmail;
  }

  function inactiveAccounts(context) {
    return state.accounts.filter((account) => !isActiveAccount(account, context));
  }

  function accountLabel(account) {
    return account.email ?? account.name ?? account.accountId ?? account.userId ?? account.label ?? "ChatGPT account";
  }

  function menuItems(context) {
    if (context?.authMethod !== "chatgpt") {
      return [];
    }
    void requestRefresh();
    const accounts = inactiveAccounts(context);
    return [
      {
        type: "expandable",
        id: `${EXTENSION_ID}.switch-account`,
        label: "Switch account",
        icon: {
          type: "svg",
          viewBox: "0 0 24 24",
          strokeWidth: 1,
          className: "lucide lucide-arrow-right-left-icon lucide-arrow-right-left",
          paths: ["m16 3 4 4-4 4", "M20 7H4", "m8 21-4-4 4-4", "M4 17h16"],
        },
        children: [
          ...accounts.map((account) => ({
            type: "item",
            id: `${EXTENSION_ID}.switch.${account.id}`,
            label: accountLabel(account),
            onSelect: (context) => switchAccount(account.id, context),
          })),
          ...(state.loadError
            ? [
                {
                  type: "item",
                  id: `${EXTENSION_ID}.load-error`,
                  label: `Could not load accounts`,
                  disabled: true,
                },
              ]
            : []),
          ...(accounts.length > 0 ? [{ type: "separator", id: `${EXTENSION_ID}.separator` }] : []),
          {
            type: "item",
            id: `${EXTENSION_ID}.add-account`,
            label: "Add account",
            onSelect: addAccount,
          },
        ],
      },
    ];
  }

  async function refreshCodexAuthState(context) {
    if (typeof context?.refreshAuthState !== "function") {
      throw new Error("Profile menu auth refresh flow is unavailable.");
    }
    await context.refreshAuthState("chatgpt");
    await saveCurrentAccount();
    await refreshState();
  }

  async function switchAccount(accountId, context) {
    await clearLastAccountId();
    await saveCurrentAccount();
    const auth = await readStoredAuth(accountId);
    if (!auth) {
      return;
    }
    await host().writeCodexAuth(auth);
    await refreshCodexAuthState(context);
  }

  async function addAccount(context) {
    if (typeof context?.startLogin !== "function") {
      throw new Error("Profile menu login flow is unavailable.");
    }
    const previous = await saveCurrentAccount();
    if (previous) {
      await writeLastAccountId(previous.id);
    } else {
      await clearLastAccountId();
    }
    const result = await context.startLogin();
    if (result?.success) {
      await saveCurrentAccount();
      await clearLastAccountId();
      await refreshCodexAuthState(context);
    }
  }

  async function finalizeLastAccountIfNeeded() {
    const nextState = await refreshState();
    if (!nextState.lastAccountId || window.location.pathname === "/login") {
      return;
    }
    await saveCurrentAccount();
    await clearLastAccountId();
    await refreshState();
  }

  async function cancelAddAccount() {
    window.extensions.profileAuth?.cancelActiveLogin?.();
    const previousAccountId = currentLastAccountId();
    if (previousAccountId) {
      const previousAuth = await readStoredAuth(previousAccountId);
      if (previousAuth) {
        await host().writeCodexAuth(previousAuth);
      }
    }
    await clearLastAccountId();
    await window.extensions.profileAuth?.refreshAuthState?.("chatgpt");
    window.location.assign("/");
  }

  async function handleBeforeLogout(context) {
    await clearLastAccountId();
    if (context?.authMethod !== "chatgpt") {
      return false;
    }
    const currentAuth = await host().readCodexAuth();
    const active = currentAuth ? await authIdentity(currentAuth) : null;
    const target = state.accounts.find((account) => account.id !== active?.id) ?? null;
    const targetAuth = target ? await readStoredAuth(target.id) : null;
    if (!targetAuth) {
      return false;
    }
    await host().writeCodexAuth(targetAuth);
    await refreshCodexAuthState(context);
    return true;
  }

  function loginActions(context) {
    void requestRefresh();
    if (context?.pathname !== "/login" || !currentLastAccountId()) {
      return [];
    }
    return [
      {
        id: `${EXTENSION_ID}.cancel-add-account`,
        label: "Cancel",
        onSelect: cancelAddAccount,
      },
    ];
  }

  function watchRouteChanges() {
    let current = window.location.href;
    window.setInterval(() => {
      if (window.location.pathname === "/login") {
        void requestRefresh().catch(console.error);
      }
      if (window.location.href === current) {
        return;
      }
      current = window.location.href;
      void finalizeLastAccountIfNeeded().catch(console.error);
    }, 500);
  }

  namespace.refresh = refreshState;
  namespace.getState = () => state;
  namespace.isReady = () => stateReady;

  window.extensions.profileMenus?.registerProvider(EXTENSION_ID, menuItems);
  window.extensions.profileAuth?.registerBeforeLogoutHandler(EXTENSION_ID, handleBeforeLogout);
  window.extensions.loginRoute?.registerActionProvider(EXTENSION_ID, loginActions);
  watchRouteChanges();
  void finalizeLastAccountIfNeeded().catch(console.error);
  void requestRefresh();
})();
