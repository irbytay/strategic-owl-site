(function () {
  "use strict";

  const STORAGE_KEY = "strategicOwlAccessSession";
  const LEGACY_TRU_KEY = "truSubscriberValidationCache";
  const DEFAULT_ACCESS_DAYS = 7;
  const SUPABASE_FUNCTION_URL =
    "https://gopyzkcmvkbusdnwjlbb.supabase.co/functions/v1/validate-subscriber";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";
  const STRIPE_URL = "https://buy.stripe.com/cNicN5eVt24X2c6aEhdwc05";
  const SUBSTACK_URL = "https://strategicowl.substack.com/subscribe";
  let memorySession = null;

  function normalizeSession(value) {
    if (!value || typeof value !== "object") return null;
    const email = String(value.email || "").trim().toLowerCase();
    const expiresAt = Number(value.expiresAt);
    if (!email || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { email, expiresAt };
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
    if (locked) locked.hidden = Boolean(session);
    if (active) active.hidden = !session;
    if (email) email.textContent = session ? session.email : "";
  }

  function announceChange(session) {
    refreshButtons();
    updateDialog();
    window.dispatchEvent(new CustomEvent("strategic-owl-access-change", {
      detail: {
        active: Boolean(session),
        email: session ? session.email : "",
        expiresAt: session ? session.expiresAt : null
      }
    }));
  }

  function activate(email, expiresAt) {
    const session = normalizeSession({
      email,
      expiresAt: expiresAt || Date.now() + DEFAULT_ACCESS_DAYS * 86400000
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
    memorySession = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_TRU_KEY);
    } catch (error) {
      console.warn("Unable to clear Owl Access status", error);
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

    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
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
      activate(normalizedEmail, expiresAt);
    }

    return result;
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
        <p class="owl-access-intro">Unlock the complete researched view while keeping the public tools open to everyone.</p>
        <section class="owl-access-locked">
          <form class="owl-access-form" novalidate>
            <label for="owl-access-email">Email used for Stripe or paid Substack</label>
            <input id="owl-access-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required />
            <button class="owl-access-primary" type="submit">Check Owl Access</button>
          </form>
          <p class="owl-access-message" role="status" aria-live="polite"></p>
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
          <strong>Owl Access is active on this device.</strong>
          <p class="owl-access-session-email"></p>
          <button class="owl-access-secondary" type="button" data-owl-sign-out>Sign Out</button>
        </section>
      </div>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector(".owl-access-form");
    const input = dialog.querySelector("#owl-access-email");
    const submit = form?.querySelector('button[type="submit"]');
    const message = dialog.querySelector(".owl-access-message");

    dialog.querySelector(".owl-access-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-owl-sign-out]")?.addEventListener("click", () => {
      clear();
      if (message) message.textContent = "Signed out on this device.";
      input?.focus();
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
          if (message) message.textContent = result.message || "Owl Access confirmed.";
          updateDialog();
        } else if (message) {
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
            .check { position:absolute; right:2px; bottom:2px; box-sizing:border-box; width:17px; height:17px; display:none; place-items:center; border:2px solid var(--owl-header, #1A2B4C); border-radius:50%; background:var(--owl-success, #77C593); color:#0D1B2A; font:700 12px/1 system-ui,sans-serif; }
            button[data-state="active"] .check { display:grid; }
            button[data-state="loading"]::after { position:absolute; inset:3px; border:2px solid transparent; border-top-color:currentColor; border-radius:50%; content:""; animation:spin 700ms linear infinite; }
            @keyframes spin { to { transform:rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { button { transition:none; } button[data-state="loading"]::after { animation:none; } }
          </style>
          <button type="button" aria-haspopup="dialog">
            <svg class="person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.5"></circle><path d="M5 20c.55-4.15 3.15-6.4 7-6.4s6.45 2.25 7 6.4"></path></svg>
            <span class="check" aria-hidden="true">✓</span>
          </button>`;
        root.querySelector("button")?.addEventListener("click", open);
      }
      this.refresh();
    }

    refresh() {
      const button = this.shadowRoot?.querySelector("button");
      if (!button) return;
      const active = isActive();
      button.dataset.state = active ? "active" : "locked";
      button.setAttribute("aria-label", active ? "Owl Access is active" : "Open Owl Access");
      button.title = active ? "Owl Access active" : "Owl Access";
    }
  }

  if (!customElements.get("owl-access-button")) {
    customElements.define("owl-access-button", OwlAccessButton);
  }

  window.StrategicOwlAccess = Object.freeze({
    storageKey: STORAGE_KEY,
    activate,
    clear,
    getSession,
    isActive,
    open,
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
})();
