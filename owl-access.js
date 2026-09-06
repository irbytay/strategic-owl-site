(function () {
  "use strict";

  const STORAGE_KEY = "strategicOwlAccessSession";
  const LEGACY_TRU_KEY = "truSubscriberValidationCache";
  const DEFAULT_ACCESS_DAYS = 7;
  const SUPABASE_FUNCTION_URL =
    "https://gopyzkcmvkbusdnwjlbb.supabase.co/functions/v1/validate-subscriber";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";
  let memorySession = null;

  function normalizeSession(value) {
    if (!value || typeof value !== "object") return null;

    const email = String(value.email || "").trim().toLowerCase();
    const expiresAt = Number(value.expiresAt);

    if (!email || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

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
    const storedSession = readStoredSession(STORAGE_KEY);
    if (storedSession) {
      memorySession = storedSession;
      return storedSession;
    }

    const legacyTRUSession = readStoredSession(LEGACY_TRU_KEY);
    if (legacyTRUSession) {
      memorySession = legacyTRUSession;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyTRUSession));
      } catch (error) {
        console.warn("Unable to migrate Owl Access status", error);
      }
      return legacyTRUSession;
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

  function announceChange(session) {
    refreshButtons();
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
      expiresAt: expiresAt || Date.now() + DEFAULT_ACCESS_DAYS * 24 * 60 * 60 * 1000
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
      body: JSON.stringify({
        action: "validate",
        email: normalizedEmail
      })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      result = {
        ok: false,
        valid: false,
        error: "Owl Access could not be checked. Please try again."
      };
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
        : Date.now() + DEFAULT_ACCESS_DAYS * 24 * 60 * 60 * 1000;

      activate(normalizedEmail, expiresAt);
    }

    return result;
  }

  class OwlAccessButton extends HTMLElement {
    static get observedAttributes() {
      return ["data-access"];
    }

    connectedCallback() {
      if (!this.shadowRoot) {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
          <style>
            :host {
              display: inline-flex;
              width: 42px;
              height: 42px;
              flex: 0 0 42px;
              vertical-align: middle;
            }

            button {
              position: relative;
              box-sizing: border-box;
              width: 42px;
              height: 42px;
              display: grid;
              place-items: center;
              padding: 0;
              border: 1px solid var(--understanding, #D4AF37);
              border-radius: 50%;
              background: #0B1C3D;
              color: var(--text, #FFFFFF);
              cursor: pointer;
              transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
            }

            button:hover {
              box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.16);
            }

            button:focus-visible {
              outline: 3px solid rgba(212, 175, 55, 0.45);
              outline-offset: 3px;
            }

            .person {
              width: 23px;
              height: 23px;
              fill: none;
              stroke: currentColor;
              stroke-linecap: round;
              stroke-linejoin: round;
              stroke-width: 1.9;
            }

            .check {
              position: absolute;
              right: -3px;
              bottom: -2px;
              box-sizing: border-box;
              width: 17px;
              height: 17px;
              display: none;
              place-items: center;
              border: 2px solid #0D1B2A;
              border-radius: 50%;
              background: #28A745;
              color: #FFFFFF;
            }

            .check svg {
              width: 10px;
              height: 10px;
              fill: none;
              stroke: currentColor;
              stroke-linecap: round;
              stroke-linejoin: round;
              stroke-width: 2.5;
            }

            button[data-state="active"] {
              background: var(--understanding, #D4AF37);
              color: var(--background, #0D1B2A);
              box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.18);
            }

            button[data-state="active"] .check {
              display: grid;
            }

            button[data-state="loading"]::after {
              position: absolute;
              inset: -4px;
              border: 2px solid transparent;
              border-top-color: var(--understanding, #D4AF37);
              border-radius: 50%;
              content: "";
              animation: owl-access-spin 700ms linear infinite;
            }

            @keyframes owl-access-spin {
              to { transform: rotate(360deg); }
            }

            @media (prefers-reduced-motion: reduce) {
              button { transition: none; }
              button[data-state="loading"]::after { animation: none; }
            }
          </style>
          <button type="button" aria-haspopup="dialog">
            <svg class="person" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="7.5" r="3.5"></circle>
              <path d="M5 20c.55-4.15 3.15-6.4 7-6.4s6.45 2.25 7 6.4"></path>
            </svg>
            <span class="check" aria-hidden="true">
              <svg viewBox="0 0 12 12"><path d="m2.2 6.2 2.2 2.2 5.2-5.2"></path></svg>
            </span>
          </button>
        `;
      }

      this.refresh();
    }

    attributeChangedCallback() {
      this.refresh();
    }

    refresh() {
      if (!this.shadowRoot) return;

      const requestedState = this.getAttribute("data-access") || "locked";
      const active = requestedState === "active" || requestedState === "preview" || isActive();
      const state = requestedState === "loading" ? "loading" : (active ? "active" : "locked");
      const button = this.shadowRoot.querySelector("button");

      if (!button) return;

      button.dataset.state = state;
      button.setAttribute("aria-label", active ? "Owl Access is active" : "Open Owl Access");
      button.title = active ? "Owl Access active" : "Owl Access";
      button.setAttribute("aria-busy", String(state === "loading"));
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
