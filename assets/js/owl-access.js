(function () {
  "use strict";

  const STORAGE_KEY = "strategicOwlAccessSession";
  const LEGACY_TRU_KEY = "truSubscriberValidationCache";
  const ADMIN_PENDING_KEY = "strategicOwlAdministratorPending";
  const DEFAULT_ACCESS_DAYS = 7;
  const SUPABASE_URL = "https://gopyzkcmvkbusdnwjlbb.supabase.co";
  const SUPABASE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/validate-subscriber`;
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";
  const STRIPE_URL = "https://buy.stripe.com/cNicN5eVt24X2c6aEhdwc05";
  const SUBSTACK_URL = "https://strategicowl.substack.com/subscribe";
  const STRIPE_MANAGE_URL =
    "https://billing.stripe.com/p/login/7sY8wP4gP5h9182aEhdwc00";
  const SUBSTACK_MANAGE_URL = "https://strategicowl.substack.com/";
  const APP_STORE_URL =
    "https://apps.apple.com/app/the-strategic-owl/id6748349497";
  let memorySession = null;
  let supabaseClient = null;
  let administratorAuthError = "";

  function normalizeSources(source, sources) {
    const normalized = Array.isArray(sources)
      ? sources.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const primarySource = String(source || "").trim().toLowerCase();
    if (primarySource && !normalized.includes(primarySource)) normalized.unshift(primarySource);
    return [...new Set(normalized)];
  }

  function normalizeSession(value) {
    if (!value || typeof value !== "object") return null;
    const email = String(value.email || "").trim().toLowerCase();
    const expiresAt = Number(value.expiresAt);
    if (!email || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const source = String(value.source || "").trim().toLowerCase();
    const activeSources = normalizeSources(source, value.activeSources || value.sources);
    return { email, expiresAt, source, activeSources };
  }

  function readStoredSession(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const session = normalizeSession(JSON.parse(raw));
      if (!session) localStorage.removeItem(key);
      return session;
    } catch (error) {
      console.warn("Unable to read Owl Access status", error);
      return null;
    }
  }

  function getSession() {
    const stored = readStoredSession(STORAGE_KEY);
    if (stored) {
      memorySession = stored;
      return stored;
    }

    const legacy = readStoredSession(LEGACY_TRU_KEY);
    if (legacy) {
      memorySession = legacy;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      } catch (error) {
        console.warn("Unable to migrate Owl Access status", error);
      }
      return legacy;
    }

    memorySession = null;
    return null;
  }

  function isActive() {
    return Boolean(getSession());
  }

  function isAdministrator() {
    return getSession()?.source === "administrator";
  }

  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase?.createClient) {
      throw new Error("The secure sign-in service did not load.");
    }
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      }
    );
    return supabaseClient;
  }

  async function ensureSupabaseSession() {
    const client = getSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session) return sessionData.session;

    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.session) throw new Error("A secure website session could not be created.");
    return data.session;
  }

  function readPendingAdministrator() {
    try {
      const raw = localStorage.getItem(ADMIN_PENDING_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      const email = String(pending?.email || "").trim().toLowerCase();
      const startedAt = Number(pending?.startedAt);
      if (!email || !Number.isFinite(startedAt) || Date.now() - startedAt > 30 * 60000) {
        localStorage.removeItem(ADMIN_PENDING_KEY);
        return null;
      }
      return { email, startedAt };
    } catch {
      localStorage.removeItem(ADMIN_PENDING_KEY);
      return null;
    }
  }

  function savePendingAdministrator(email) {
    const pending = {
      email: String(email || "").trim().toLowerCase(),
      startedAt: Date.now()
    };
    localStorage.setItem(ADMIN_PENDING_KEY, JSON.stringify(pending));
    return pending;
  }

  function clearPendingAdministrator() {
    localStorage.removeItem(ADMIN_PENDING_KEY);
  }

  function refreshButtons() {
    document.querySelectorAll("owl-access-button").forEach((element) => {
      if (typeof element.refresh === "function") element.refresh();
    });
  }

  function updateDialog() {
    const dialog = document.getElementById("owl-access-dialog");
    if (!dialog) return;
    const session = getSession();
    const locked = dialog.querySelector(".owl-access-locked");
    const active = dialog.querySelector(".owl-access-active");
    const email = dialog.querySelector(".owl-access-session-email");
    const stripeManagement = dialog.querySelector("[data-owl-manage-stripe]");
    const substackManagement = dialog.querySelector("[data-owl-manage-substack]");
    const management = dialog.querySelector("[data-owl-management]");
    const administratorSignIn = dialog.querySelector("[data-owl-administrator-sign-in]");
    const administratorMessage = dialog.querySelector("[data-owl-administrator-message]");
    const appleSubscriber = dialog.querySelector("[data-owl-apple-subscriber]");
    const activeLabel = dialog.querySelector("[data-owl-active-label]");
    const offers = dialog.querySelector(".owl-access-offers");
    const pendingAdministrator = readPendingAdministrator();
    if (locked) locked.hidden = Boolean(session);
    if (active) active.hidden = !session;
    if (email) email.textContent = session ? session.email : "";
    if (administratorSignIn) {
      administratorSignIn.hidden = Boolean(session) || !pendingAdministrator;
    }
    if (appleSubscriber) {
      appleSubscriber.hidden = Boolean(session) || Boolean(pendingAdministrator);
    }
    if (administratorMessage) administratorMessage.textContent = administratorAuthError;
    if (offers) offers.hidden = Boolean(pendingAdministrator) && !session;
    if (activeLabel) {
      activeLabel.textContent = session?.source === "administrator"
        ? "Administrator access is active on this device."
        : "Owl Access is active on this device.";
    }
    const sources = session?.activeSources || [];
    const showStripe = sources.includes("owl_access");
    const showSubstack = sources.includes("substack");
    if (stripeManagement) stripeManagement.hidden = !showStripe;
    if (substackManagement) substackManagement.hidden = !showSubstack;
    if (management) management.hidden = !showStripe && !showSubstack;
  }

  function announceChange(session) {
    refreshButtons();
    updateDialog();
    const dialog = document.getElementById("owl-access-dialog");
    if (session && dialog?.open) dialog.close();
    window.dispatchEvent(new CustomEvent("strategic-owl-access-change", {
      detail: {
        active: Boolean(session),
        email: session ? session.email : "",
        expiresAt: session ? session.expiresAt : null,
        source: session ? session.source : "",
        activeSources: session ? session.activeSources : []
      }
    }));
  }

  function activate(email, expiresAt, source, activeSources) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const existingSession = getSession();
    const preserveExistingSource =
      source === undefined && existingSession?.email === normalizedEmail;
    const session = normalizeSession({
      email: normalizedEmail,
      expiresAt: expiresAt || Date.now() + DEFAULT_ACCESS_DAYS * 86400000,
      source: preserveExistingSource ? existingSession.source : source,
      activeSources: preserveExistingSource
        ? existingSession.activeSources
        : activeSources
    });
    if (!session) return false;
    memorySession = session;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (error) {
      console.warn("Unable to save Owl Access status", error);
    }
    announceChange(session);
    return true;
  }

  function clear() {
    const previousSession = getSession();
    memorySession = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_TRU_KEY);
      clearPendingAdministrator();
    } catch (error) {
      console.warn("Unable to clear Owl Access status", error);
    }
    administratorAuthError = "";
    if (previousSession?.source === "administrator") {
      try {
        getSupabaseClient().auth.signOut().catch((error) => {
          console.warn("Unable to end administrator sign in", error);
        });
      } catch (error) {
        console.warn("Unable to end administrator sign in", error);
      }
    }
    announceChange(null);
  }

  async function validateEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
      return {
        ok: false,
        valid: false,
        error: "Enter the email used for your Stripe or paid Substack subscription."
      };
    }

    const session = await ensureSupabaseSession();
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: "validate", email: normalizedEmail })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      result = { ok: false, valid: false, error: "Owl Access could not be checked. Please try again." };
    }

    if (!response.ok || result.ok !== true) {
      return {
        ...result,
        ok: false,
        valid: false,
        error: result.error || "Owl Access could not be checked. Please try again."
      };
    }

    if (result.valid === true) {
      const providedExpiration = Date.parse(result.accessExpiresAt || "");
      const expiresAt = Number.isFinite(providedExpiration)
        ? providedExpiration
        : Date.now() + DEFAULT_ACCESS_DAYS * 86400000;
      activate(
        normalizedEmail,
        expiresAt,
        result.source,
        result.activeSources
      );
    }

    return result;
  }

  async function invokeAudienceAction(action, values = {}) {
    const owlSession = getSession();
    if (!owlSession || owlSession.source === "administrator") {
      throw new Error("Owl Access is required.");
    }

    const session = await ensureSupabaseSession();
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        ...values,
        action,
        email: owlSession.email
      })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      result = { ok: false, valid: false };
    }

    if (!response.ok || result.ok !== true || result.valid !== true) {
      throw new Error(
        result.error || "Owl Access could not be confirmed. Please try again."
      );
    }

    return result;
  }

  async function beginAdministratorSignIn(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) throw new Error("Enter the administrator email first.");

    savePendingAdministrator(normalizedEmail);
    administratorAuthError = "";
    const client = getSupabaseClient();
    const redirectTo = `${window.location.origin}/`;
    const { error } = await client.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async function authorizeAdministrator(email, session) {
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action: "authorizeAdministrator",
        email
      })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      result = { ok: false, administratorAuthorized: false };
    }
    if (!response.ok || result.administratorAuthorized !== true) {
      throw new Error(
        result.error || "This Apple account is not authorized for The Owl's Office."
      );
    }
    return result;
  }

  async function finishPendingAdministratorSignIn() {
    const pending = readPendingAdministrator();
    if (!pending) return false;

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session || session.user?.is_anonymous) return false;

    try {
      await authorizeAdministrator(pending.email, session);
      activate(
        pending.email,
        Date.now() + DEFAULT_ACCESS_DAYS * 86400000,
        "administrator",
        ["administrator"]
      );
      clearPendingAdministrator();
      administratorAuthError = "";
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    } catch (error) {
      administratorAuthError = error?.message || "Administrator access could not be confirmed.";
      clearPendingAdministrator();
      await client.auth.signOut();
      updateDialog();
      window.setTimeout(open, 0);
      return false;
    }
  }

  async function restoreAdministratorSession() {
    if (readPendingAdministrator()) {
      return finishPendingAdministratorSignIn();
    }
    const owlSession = getSession();
    if (owlSession?.source !== "administrator") return false;

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user?.is_anonymous) {
      clear();
      return false;
    }
    try {
      await authorizeAdministrator(owlSession.email, data.session);
      return true;
    } catch {
      clear();
      return false;
    }
  }

  async function requireAdministrator() {
    const owlSession = getSession();
    if (owlSession?.source !== "administrator") return null;

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user?.is_anonymous) return null;
    await authorizeAdministrator(owlSession.email, data.session);
    return { client, session: data.session, owlSession };
  }

  function ensureDialog() {
    let dialog = document.getElementById("owl-access-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "owl-access-dialog";
    dialog.className = "owl-access-dialog";
    dialog.setAttribute("aria-labelledby", "owl-access-heading");
    dialog.innerHTML = `
      <div class="owl-access-card">
        <button class="owl-access-close" type="button" aria-label="Close Owl Access">×</button>
        <h2 class="owl-access-heading" id="owl-access-heading">Owl Access</h2>
        <div class="owl-access-intro">
          <p class="owl-access-promise">
            <span class="owl-access-promise-intro">Choose the sources in your News Feed.</span>
            <span class="owl-access-principle">No ads.</span>
            <span class="owl-access-principle">No algorithms.</span>
          </p>
          <p class="owl-access-benefits">Owl Access includes Owl Insights, expanded candidate research, Ask the Owl, T.R.U. suggestions, and saved quiz history.</p>
        </div>
        <section class="owl-access-locked">
          <form class="owl-access-form" novalidate>
            <label for="owl-access-email">Email used for Stripe or paid Substack</label>
            <input id="owl-access-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required />
            <button class="owl-access-primary" type="submit">Check Owl Access</button>
          </form>
          <p class="owl-access-message" role="status" aria-live="polite"></p>
          <div class="owl-access-administrator-sign-in owl-access-apple-subscriber" data-owl-apple-subscriber>
            <p>or</p>
            <strong>Subscribed through Apple?</strong>
            <p>Apple subscriptions are verified in The Strategic Owl app.</p>
            <a class="owl-access-secondary" href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer">Check Apple Access in the App</a>
          </div>
          <div class="owl-access-administrator-sign-in" data-owl-administrator-sign-in hidden>
            <p>Administrator email confirmed. Continue with Apple to securely open The Owl’s Office.</p>
            <button class="owl-access-secondary" type="button" data-owl-continue-apple>Continue with Apple</button>
            <p class="owl-access-administrator-message" data-owl-administrator-message role="status" aria-live="polite"></p>
          </div>
          <div class="owl-access-offers">
            <p>Need Owl Access?</p>
            <div class="owl-access-links">
              <a class="owl-access-subscribe-link" href="${STRIPE_URL}" target="_blank" rel="noopener noreferrer">Stripe</a>
              <a class="owl-access-subscribe-link" href="${SUBSTACK_URL}" target="_blank" rel="noopener noreferrer">Substack</a>
            </div>
          </div>
        </section>
        <section class="owl-access-active" hidden>
          <div class="owl-access-active-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="3.5"></circle><path d="M5 20c.55-4.15 3.15-6.4 7-6.4s6.45 2.25 7 6.4"></path></svg>
            <span>✓</span>
          </div>
          <strong data-owl-active-label>Owl Access is active on this device.</strong>
          <p class="owl-access-session-email"></p>
          <div class="owl-access-management" data-owl-management hidden>
            <p>Manage your subscription through the provider that bills you.</p>
            <div class="owl-access-links">
              <a class="owl-access-subscribe-link" data-owl-manage-stripe href="${STRIPE_MANAGE_URL}" target="_blank" rel="noopener noreferrer" hidden>Manage Stripe</a>
              <a class="owl-access-subscribe-link" data-owl-manage-substack href="${SUBSTACK_MANAGE_URL}" target="_blank" rel="noopener noreferrer" hidden>Manage Substack</a>
            </div>
          </div>
          <button class="owl-access-secondary" type="button" data-owl-sign-out>Sign Out</button>
        </section>
      </div>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector(".owl-access-form");
    const input = dialog.querySelector("#owl-access-email");
    const submit = form?.querySelector('button[type="submit"]');
    const message = dialog.querySelector(".owl-access-message");
    const administratorButton = dialog.querySelector("[data-owl-continue-apple]");
    const administratorMessage = dialog.querySelector("[data-owl-administrator-message]");

    dialog.querySelector(".owl-access-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-owl-sign-out]")?.addEventListener("click", () => {
      clear();
      if (message) message.textContent = "Signed out on this device.";
      input?.focus();
    });
    administratorButton?.addEventListener("click", async () => {
      const pending = readPendingAdministrator();
      const email = pending?.email || input?.value.trim().toLowerCase() || "";
      administratorButton.disabled = true;
      administratorButton.textContent = "Opening Apple…";
      if (administratorMessage) administratorMessage.textContent = "";
      try {
        await beginAdministratorSignIn(email);
      } catch (error) {
        administratorAuthError = error?.message || "Apple sign in could not be started.";
        if (administratorMessage) administratorMessage.textContent = administratorAuthError;
        administratorButton.disabled = false;
        administratorButton.textContent = "Continue with Apple";
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => document.body.classList.remove("owl-dialog-open"));

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = input ? input.value.trim().toLowerCase() : "";
      if (!email || !email.includes("@") || !email.includes(".")) {
        if (message) message.textContent = "Enter a valid email address.";
        input?.focus();
        return;
      }

      if (submit) submit.disabled = true;
      if (message) message.textContent = "Checking Owl Access…";
      try {
        const result = await validateEmail(email);
        if (result.valid === true) {
          clearPendingAdministrator();
          administratorAuthError = "";
          if (dialog.open) dialog.close();
        } else if (result.requiresAdministratorSignIn === true) {
          savePendingAdministrator(email);
          administratorAuthError = "";
          if (message) {
            message.textContent = result.message || "Administrator email confirmed.";
          }
          updateDialog();
        } else if (message) {
          clearPendingAdministrator();
          message.textContent = result.message || result.error || "No active subscription was found for that email.";
        }
      } catch (error) {
        console.error("Owl Access validation failed", error);
        if (message) message.textContent = "Owl Access could not be checked. Please try again.";
      } finally {
        if (submit) submit.disabled = false;
      }
    });

    updateDialog();
    return dialog;
  }

  function open() {
    const dialog = ensureDialog();
    updateDialog();
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("owl-dialog-open");
    window.setTimeout(() => {
      const focusTarget = isActive()
        ? dialog.querySelector("[data-owl-sign-out]")
        : dialog.querySelector("#owl-access-email");
      focusTarget?.focus();
    }, 0);
  }

  class OwlAccessButton extends HTMLElement {
    connectedCallback() {
      if (!this.shadowRoot) {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
          <style>
            :host { display:inline-flex; width:44px; height:44px; vertical-align:middle; }
            button { position:relative; box-sizing:border-box; width:44px; height:44px; display:grid; place-items:center; padding:0; border:0; border-radius:12px; background:transparent; color:var(--owl-gold, #D4AF37); cursor:pointer; transition:background-color 150ms ease, transform 150ms ease; }
            button:hover { background:rgba(212,175,55,.1); }
            button:active { transform:scale(.96); }
            button:focus-visible { outline:3px solid rgba(212,175,55,.5); outline-offset:2px; }
            .person { width:27px; height:27px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.8; }
            .administrator { display:none; width:29px; height:29px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.7; }
            .check { position:absolute; right:2px; bottom:2px; box-sizing:border-box; width:17px; height:17px; display:none; place-items:center; border:2px solid var(--owl-header, #1A2B4C); border-radius:50%; background:var(--owl-success, #77C593); color:#0D1B2A; font:700 12px/1 system-ui,sans-serif; }
            button[data-state="active"] .check { display:grid; }
            button[data-state="administrator"] .person, button[data-state="administrator"] .check { display:none; }
            button[data-state="administrator"] .administrator { display:block; }
            button[data-state="loading"]::after { position:absolute; inset:3px; border:2px solid transparent; border-top-color:currentColor; border-radius:50%; content:""; animation:spin 700ms linear infinite; }
            @keyframes spin { to { transform:rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { button { transition:none; } button[data-state="loading"]::after { animation:none; } }
          </style>
          <button type="button" aria-haspopup="dialog">
            <svg class="person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.5"></circle><path d="M5 20c.55-4.15 3.15-6.4 7-6.4s6.45 2.25 7 6.4"></path></svg>
            <svg class="administrator" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19 5.4v5.4c0 4.7-2.8 8.5-7 10.7-4.2-2.2-7-6-7-10.7V5.4L12 2.5Z"></path><circle cx="12" cy="9" r="2.2"></circle><path d="M8.7 15.8c.45-2.1 1.55-3.2 3.3-3.2s2.85 1.1 3.3 3.2"></path></svg>
            <span class="check" aria-hidden="true">✓</span>
          </button>`;
        root.querySelector("button")?.addEventListener("click", () => {
          if (isAdministrator() && document.body.dataset.page !== "owl-office") {
            window.location.href = "owl-office.html";
            return;
          }
          open();
        });
      }
      this.refresh();
    }

    refresh() {
      const button = this.shadowRoot?.querySelector("button");
      if (!button) return;
      const active = isActive();
      const administrator = isAdministrator();
      button.dataset.state = administrator ? "administrator" : active ? "active" : "locked";
      button.setAttribute(
        "aria-label",
        administrator
          ? "Open The Owl's Office"
          : active
          ? "Owl Access is active"
          : "Open Owl Access"
      );
      button.title = administrator
        ? "The Owl's Office"
        : active
        ? "Owl Access active"
        : "Owl Access";
    }
  }

  if (!customElements.get("owl-access-button")) {
    customElements.define("owl-access-button", OwlAccessButton);
  }

  window.StrategicOwlAccess = Object.freeze({
    storageKey: STORAGE_KEY,
    activate,
    clear,
    getSupabaseClient,
    getSession,
    isActive,
    isAdministrator,
    invokeAudienceAction,
    open,
    requireAdministrator,
    refreshButtons,
    validateEmail
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_TRU_KEY) {
      memorySession = null;
      announceChange(getSession());
    }
  });

  getSession();
  restoreAdministratorSession().catch((error) => {
    console.warn("Unable to restore administrator access", error);
  });
})();
