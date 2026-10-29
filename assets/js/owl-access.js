(function () {
  "use strict";

  const STORAGE_KEY = "strategicOwlVerifiedAccessSession";
  const UNVERIFIED_ACCESS_KEY = "strategicOwlAccessSession";
  const IDENTITY_KEY = "strategicOwlMembershipIdentity";
  const LEGACY_TRU_KEY = "truSubscriberValidationCache";
  const ADMIN_PENDING_KEY = "strategicOwlAdministratorPending";
  const EMAIL_VERIFICATION_KEY = "strategicOwlEmailVerificationPending";
  const EMAIL_VERIFICATION_MINUTES = 15;
  const DEFAULT_ACCESS_DAYS = 7;
  const SUPABASE_URL = "https://gopyzkcmvkbusdnwjlbb.supabase.co";
  // Keep membership verification on the website origin. Netlify proxies this
  // path to the Supabase Edge Function, avoiding cross-origin preflight errors.
  const SUPABASE_FUNCTION_URL = "/api/validate-subscriber";
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
  let restorationPromise = null;

  const PUBLIC_CAPABILITIES = Object.freeze({
    radar: true,
    newsFeed: true,
    voterResources: true,
    constitution: true
  });

  const MEMBER_CAPABILITIES = Object.freeze({
    savedSources: true,
    owlReader: true,
    researchPrompt: true,
    candidatePositions: true
  });

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
    const source = String(value.source || "").trim().toLowerCase();
    if (!email && source !== "apple") return null;
    const rawExpiration = value.expiresAt;
    const expiresAt = rawExpiration == null || rawExpiration === "" ? null : Number(rawExpiration);
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) return null;
    const activeSources = normalizeSources(source, value.activeSources || value.sources);
    const verifiedAt = Number(value.verifiedAt) || Date.now();
    return { email, expiresAt, source, activeSources, verifiedAt };
  }

  function readStoredSession(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const session = normalizeSession(parsed);
      if (!session) localStorage.removeItem(key);
      return session;
    } catch (error) {
      console.warn("Unable to read Owl Membership status", error);
      return null;
    }
  }

  function getSession() {
    if (memorySession?.expiresAt && memorySession.expiresAt <= Date.now()) memorySession = null;
    if (memorySession) return memorySession;
    const stored = readStoredSession(STORAGE_KEY);
    if (stored) return (memorySession = stored);
    return null;
  }

  function isActive() {
    return Boolean(getSession());
  }

  function isAdministrator() {
    return getSession()?.source === "administrator";
  }

  function readIdentity() {
    try {
      const value = JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null");
      const email = String(value?.email || "").trim().toLowerCase();
      const source = String(value?.source || "").trim().toLowerCase();
      return email || source === "apple" ? { email, source } : null;
    } catch {
      localStorage.removeItem(IDENTITY_KEY);
      return null;
    }
  }

  function saveIdentity(email, source) {
    const identity = {
      email: String(email || "").trim().toLowerCase(),
      source: String(source || "").trim().toLowerCase()
    };
    if (!identity.email && identity.source !== "apple") return;
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  }

  function getCapabilities() {
    const active = isActive();
    const administrator = isAdministrator();
    return Object.freeze({
      ...PUBLIC_CAPABILITIES,
      ...Object.fromEntries(Object.keys(MEMBER_CAPABILITIES).map((key) => [key, active])),
      publisherTools: administrator
    });
  }

  function can(capability) {
    return getCapabilities()[capability] === true;
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

  function normalizePendingEmailVerification(value) {
    if (!value || typeof value !== "object") return null;
    const email = String(value.email || "").trim().toLowerCase();
    const type = value.type === "email" ? "email" : value.type === "email_change" ? "email_change" : "";
    const purpose = value.purpose === "civic_identity" ? "civic_identity" : "membership";
    const startedAt = Number(value.startedAt);
    const previousUserID = String(value.previousUserID || "").trim();
    const grant = value.grant && typeof value.grant === "object" ? value.grant : null;
    if (!email || !type || !Number.isFinite(startedAt)) return null;
    if (Date.now() - startedAt > EMAIL_VERIFICATION_MINUTES * 60000) return null;
    return { email, type, purpose, startedAt, previousUserID, grant };
  }

  function readPendingEmailVerification() {
    try {
      const pending = normalizePendingEmailVerification(
        JSON.parse(sessionStorage.getItem(EMAIL_VERIFICATION_KEY) || "null")
      );
      if (!pending) sessionStorage.removeItem(EMAIL_VERIFICATION_KEY);
      return pending;
    } catch {
      sessionStorage.removeItem(EMAIL_VERIFICATION_KEY);
      return null;
    }
  }

  function savePendingEmailVerification(value) {
    const pending = normalizePendingEmailVerification({ ...value, startedAt: Date.now() });
    if (!pending) throw new Error("Email verification could not be started.");
    sessionStorage.setItem(EMAIL_VERIFICATION_KEY, JSON.stringify(pending));
    return pending;
  }

  function clearPendingEmailVerification() {
    sessionStorage.removeItem(EMAIL_VERIFICATION_KEY);
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
        : "Owl Membership is active on this device.";
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
        activeSources: session ? session.activeSources : [],
        capabilities: getCapabilities()
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
        : activeSources,
      verifiedAt: Date.now()
    });
    if (!session) return false;
    memorySession = session;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      saveIdentity(session.email, session.source);
    } catch (error) {
      console.warn("Unable to save Owl Membership status", error);
    }
    announceChange(session);
    return true;
  }

  function clear() {
    memorySession = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(UNVERIFIED_ACCESS_KEY);
      localStorage.removeItem(IDENTITY_KEY);
      localStorage.removeItem(LEGACY_TRU_KEY);
      clearPendingAdministrator();
      clearPendingEmailVerification();
    } catch (error) {
      console.warn("Unable to clear Owl Membership status", error);
    }
    administratorAuthError = "";
    try {
      getSupabaseClient().auth.signOut().catch((error) => {
        console.warn("Unable to end the secure website session", error);
      });
    } catch (error) {
      console.warn("Unable to end the secure website session", error);
    }
    announceChange(null);
  }

  async function validateEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
      return {
        ok: false,
        valid: false,
        error: "Enter the email used for your Owl Membership."
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
      result = { ok: false, valid: false, error: "Owl Membership could not be checked. Please try again." };
    }

    if (!response.ok || result.ok !== true) {
      return {
        ...result,
        ok: false,
        valid: false,
        error: result.error || "Owl Membership could not be checked. Please try again."
      };
    }

    if (result.valid === true) {
      const verificationRequired = await beginEmailVerification(
        normalizedEmail,
        "membership",
        {
          accessExpiresAt: result.accessExpiresAt || null,
          source: result.source || "",
          activeSources: result.activeSources || []
        }
      );
      if (verificationRequired) {
        return {
          ...result,
          eligible: true,
          valid: false,
          verificationRequired: true,
          message: `Enter the six-digit code sent to ${normalizedEmail}.`
        };
      }

      const providedExpiration = Date.parse(result.accessExpiresAt || "");
      activate(
        normalizedEmail,
        Number.isFinite(providedExpiration) ? providedExpiration : null,
        result.source,
        result.activeSources
      );
    } else if (result.requiresAdministratorSignIn !== true) {
      memorySession = null;
      localStorage.removeItem(STORAGE_KEY);
      announceChange(null);
    }

    return result;
  }

  async function beginEmailVerification(email, purpose = "civic_identity", grant = null) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
      throw new Error("Enter a valid email address.");
    }

    const client = getSupabaseClient();
    const session = await ensureSupabaseSession();
    const currentEmail = String(session.user?.email || "").trim().toLowerCase();
    if (!session.user?.is_anonymous) {
      if (currentEmail !== normalizedEmail) {
        throw new Error("This browser is signed in with a different verified email. Sign out before connecting another email.");
      }
      clearPendingEmailVerification();
      return false;
    }

    let type = "email_change";
    const previousUserID = String(session.user?.id || "");
    const updateResult = await client.auth.updateUser({ email: normalizedEmail });
    if (updateResult.error) {
      const status = Number(updateResult.error.status || 0);
      if (status !== 400 && status !== 422) throw updateResult.error;
      const otpResult = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false }
      });
      if (otpResult.error) throw otpResult.error;
      type = "email";
    }

    savePendingEmailVerification({
      email: normalizedEmail,
      type,
      purpose,
      previousUserID,
      grant
    });
    return true;
  }

  async function completeEmailVerification(email, code) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedCode = String(code || "").replace(/\D/g, "");
    const pending = readPendingEmailVerification();
    if (!pending || pending.email !== normalizedEmail) {
      throw new Error("Request a new verification code and try again.");
    }
    if (normalizedCode.length !== 6) {
      throw new Error("Enter the six-digit code sent to your email.");
    }

    const client = getSupabaseClient();
    const verification = await client.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedCode,
      type: pending.type
    });
    if (verification.error) throw verification.error;
    const session = verification.data.session || (await client.auth.getSession()).data.session;
    const verifiedEmail = String(session?.user?.email || "").trim().toLowerCase();
    if (!session || session.user?.is_anonymous || verifiedEmail !== normalizedEmail) {
      throw new Error("That code did not finish verifying this email. Request a new code and try again.");
    }
    if (pending.type === "email_change" && pending.previousUserID && session.user.id !== pending.previousUserID) {
      throw new Error("Email verification returned a different profile identity, so no access was changed.");
    }

    clearPendingEmailVerification();
    if (pending.purpose === "membership") {
      const grant = pending.grant || {};
      const providedExpiration = Date.parse(grant.accessExpiresAt || "");
      activate(
        normalizedEmail,
        Number.isFinite(providedExpiration) ? providedExpiration : null,
        grant.source,
        grant.activeSources
      );
    }
    return {
      email: normalizedEmail,
      purpose: pending.purpose,
      userID: session.user.id
    };
  }

  async function checkAppleAccess() {
    const session = await ensureSupabaseSession();
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: "checkAppleAccess" })
    });
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || "Apple membership could not be restored.");
    }
    if (result.valid === true) {
      const providedExpiration = Date.parse(result.accessExpiresAt || "");
      activate(
        "",
        Number.isFinite(providedExpiration) ? providedExpiration : null,
        "apple",
        result.activeSources || ["apple"]
      );
    }
    return result;
  }

  async function restoreMembership() {
    if (restorationPromise) return restorationPromise;
    restorationPromise = (async () => {
      const cachedGrant = readStoredSession(STORAGE_KEY);
      if (cachedGrant) {
        memorySession = cachedGrant;
        saveIdentity(cachedGrant.email, cachedGrant.source);
        announceChange(cachedGrant);
        if (cachedGrant.source === "administrator") return restoreAdministratorSession();
        return true;
      }

      const pendingAdministrator = readPendingAdministrator();
      if (pendingAdministrator) return finishPendingAdministratorSignIn();

      const identity = readIdentity();
      if (identity?.source === "administrator") return restoreAdministratorSession();
      announceChange(null);
      return false;
    })().finally(() => { restorationPromise = null; });
    return restorationPromise;
  }

  async function requireMembership() {
    const current = getSession();
    if (current && current.source !== "administrator") return current;
    await restoreMembership();
    const restored = getSession();
    if (!restored || restored.source === "administrator") throw new Error("Owl Membership is required.");
    return restored;
  }

  async function invokeAudienceAction(action, values = {}) {
    await requireMembership();
    const owlSession = getSession();
    if (!owlSession || owlSession.source === "administrator") {
      throw new Error("Owl Membership is required.");
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
      memorySession = null;
      localStorage.removeItem(STORAGE_KEY);
      announceChange(null);
      throw new Error(
        result.error || "Owl Membership could not be confirmed. Please try again."
      );
    }

    return result;
  }

  async function deleteAccountData() {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session || session.user?.is_anonymous) {
      throw new Error("Verify your email before deleting your account and app data.");
    }
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: "deleteAccountData" })
    });
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok || result.ok !== true || result.deleted !== true) {
      throw new Error(result.error || "Your account and app data could not be deleted.");
    }
    memorySession = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(IDENTITY_KEY);
    clearPendingEmailVerification();
    clearPendingAdministrator();
    await client.auth.signOut().catch(() => {});
    announceChange(null);
    return result;
  }

  function confirmAccountDeletion() {
    return new Promise((resolve) => {
      let confirmation = document.getElementById("owl-delete-account-dialog");
      if (!confirmation) {
        confirmation = document.createElement("dialog");
        confirmation.id = "owl-delete-account-dialog";
        confirmation.className = "owl-delete-account-dialog";
        confirmation.innerHTML = `
          <div class="owl-delete-account-card">
            <p class="owl-access-code-heading">Delete account and app data?</p>
            <p>This permanently removes your profile, Civic Owl progress, ratings, badges, saved sources, and personal app activity.</p>
            <p>Your Apple, Google, Stripe, or Substack subscription is managed separately and will not be canceled.</p>
            <p class="owl-delete-account-message" role="status" aria-live="polite"></p>
            <div class="owl-delete-account-actions">
              <button class="owl-access-secondary" type="button" data-keep-account>Keep my account</button>
              <button class="owl-access-danger" type="button" data-confirm-account-delete>Delete permanently</button>
            </div>
          </div>`;
        document.body.appendChild(confirmation);
      }
      const finish = (value) => {
        confirmation.close();
        confirmation.removeEventListener("cancel", cancel);
        resolve(value);
      };
      const cancel = (event) => { event.preventDefault(); finish(false); };
      confirmation.addEventListener("cancel", cancel, { once: true });
      confirmation.querySelector("[data-keep-account]").onclick = () => finish(false);
      confirmation.querySelector("[data-confirm-account-delete]").onclick = () => finish(true);
      confirmation.querySelector(".owl-delete-account-message").textContent = "";
      confirmation.showModal();
      confirmation.querySelector("[data-keep-account]").focus();
    });
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
        null,
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
    const identity = readIdentity();
    const administratorEmail = owlSession?.source === "administrator" ? owlSession.email : identity?.source === "administrator" ? identity.email : "";
    if (!administratorEmail) return false;

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user?.is_anonymous) {
      clear();
      return false;
    }
    try {
      await authorizeAdministrator(administratorEmail, data.session);
      activate(administratorEmail, owlSession?.expiresAt || null, "administrator", ["administrator"]);
      return true;
    } catch {
      clear();
      return false;
    }
  }

  async function requireAdministrator() {
    const current = getSession();
    const identity = readIdentity();
    const administratorEmail = current?.source === "administrator" ? current.email : identity?.source === "administrator" ? identity.email : "";
    if (!administratorEmail) return null;

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user?.is_anonymous) return null;
    await authorizeAdministrator(administratorEmail, data.session);
    const owlSession = getSession() || normalizeSession({
      email: administratorEmail,
      source: "administrator",
      activeSources: ["administrator"]
    });
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
        <button class="owl-access-close" type="button" aria-label="Close Owl Membership">×</button>
        <h2 class="owl-access-heading" id="owl-access-heading">Owl Membership</h2>
        <div class="owl-access-intro">
          <p class="owl-access-promise">
            <span class="owl-access-promise-intro">Make your coverage personal.</span>
            <span class="owl-access-principle">No ads.</span>
            <span class="owl-access-principle">No algorithms.</span>
          </p>
          <p class="owl-access-benefits">Follow sources, filter your Feed, use Owl Reader where publishers permit it, copy research prompts, and unlock candidate issue positions.</p>
        </div>
        <section class="owl-access-locked">
          <form class="owl-access-form" novalidate>
            <label for="owl-access-email">Membership email</label>
            <input id="owl-access-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required />
            <button class="owl-access-primary" type="submit">Continue</button>
          </form>
          <form class="owl-access-form owl-access-code-form" data-owl-code-form hidden novalidate>
            <p class="owl-access-code-heading">Confirm your email</p>
            <p class="owl-access-code-instruction" data-owl-code-instruction></p>
            <label for="owl-access-code">Six-digit code</label>
            <input id="owl-access-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
            <button class="owl-access-primary" type="submit">Confirm Membership</button>
            <button class="owl-access-secondary" type="button" data-owl-cancel-code>Use another email</button>
          </form>
          <p class="owl-access-message" role="status" aria-live="polite"></p>
          <div class="owl-access-administrator-sign-in owl-access-apple-subscriber" data-owl-apple-subscriber>
            <p>or</p>
            <strong>Subscribed through Apple?</strong>
            <p>Apple purchases are restored through The Strategic Owl app and linked to its secure session.</p>
            <a class="owl-access-secondary" href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer">Restore Apple Membership in the App</a>
          </div>
          <div class="owl-access-administrator-sign-in" data-owl-administrator-sign-in hidden>
            <p>Administrator email confirmed. Continue with Apple to securely open The Owl’s Office.</p>
            <button class="owl-access-secondary" type="button" data-owl-continue-apple>Continue with Apple</button>
            <p class="owl-access-administrator-message" data-owl-administrator-message role="status" aria-live="polite"></p>
          </div>
          <div class="owl-access-offers">
            <p>Need Owl Membership?</p>
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
          <strong data-owl-active-label>Owl Membership is active on this device.</strong>
          <p class="owl-access-session-email"></p>
          <div class="owl-access-management" data-owl-management hidden>
            <p>Manage your subscription through the provider that bills you.</p>
            <div class="owl-access-links">
              <a class="owl-access-subscribe-link" data-owl-manage-stripe href="${STRIPE_MANAGE_URL}" target="_blank" rel="noopener noreferrer" hidden>Manage Stripe</a>
              <a class="owl-access-subscribe-link" data-owl-manage-substack href="${SUBSTACK_MANAGE_URL}" target="_blank" rel="noopener noreferrer" hidden>Manage Substack</a>
            </div>
          </div>
          <button class="owl-access-secondary" type="button" data-owl-sign-out>Sign Out</button>
          <button class="owl-access-danger" type="button" data-owl-delete-account>Delete account and app data</button>
          <small class="owl-access-deletion-note">Profile deletion does not cancel a subscription with its billing provider.</small>
        </section>
      </div>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector(".owl-access-form");
    const input = dialog.querySelector("#owl-access-email");
    const submit = form?.querySelector('button[type="submit"]');
    const codeForm = dialog.querySelector("[data-owl-code-form]");
    const codeInput = dialog.querySelector("#owl-access-code");
    const codeSubmit = codeForm?.querySelector('button[type="submit"]');
    const codeInstruction = dialog.querySelector("[data-owl-code-instruction]");
    const cancelCode = dialog.querySelector("[data-owl-cancel-code]");
    const message = dialog.querySelector(".owl-access-message");
    const administratorButton = dialog.querySelector("[data-owl-continue-apple]");
    const administratorMessage = dialog.querySelector("[data-owl-administrator-message]");

    dialog.querySelector(".owl-access-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-owl-sign-out]")?.addEventListener("click", () => {
      clear();
      if (message) message.textContent = "Signed out on this device.";
      input?.focus();
    });
    dialog.querySelector("[data-owl-delete-account]")?.addEventListener("click", async () => {
      if (!await confirmAccountDeletion()) return;
      const button = dialog.querySelector("[data-owl-delete-account]");
      button.disabled = true;
      button.textContent = "Deleting account";
      try {
        await deleteAccountData();
        if (dialog.open) dialog.close();
        window.location.assign("civic-owl.html?account=deleted");
      } catch (error) {
        if (message) message.textContent = error?.message || "Your account could not be deleted.";
        button.disabled = false;
        button.textContent = "Delete account and app data";
      }
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

    function syncEmailVerificationForm() {
      const pending = readPendingEmailVerification();
      const membershipPending = pending?.purpose === "membership" ? pending : null;
      if (form) form.hidden = Boolean(membershipPending);
      if (codeForm) codeForm.hidden = !membershipPending;
      if (codeInstruction) {
        codeInstruction.textContent = membershipPending
          ? `Enter the code sent to ${membershipPending.email}.`
          : "";
      }
      if (membershipPending && input) input.value = membershipPending.email;
    }

    cancelCode?.addEventListener("click", () => {
      clearPendingEmailVerification();
      if (codeInput) codeInput.value = "";
      if (message) message.textContent = "";
      syncEmailVerificationForm();
      input?.focus();
    });

    codeInput?.addEventListener("input", () => {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    });

    codeForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const pending = readPendingEmailVerification();
      const code = codeInput?.value || "";
      if (!pending || pending.purpose !== "membership") {
        clearPendingEmailVerification();
        syncEmailVerificationForm();
        if (message) message.textContent = "Request a new verification code and try again.";
        return;
      }
      if (code.replace(/\D/g, "").length !== 6) {
        if (message) message.textContent = "Enter the six-digit code sent to your email.";
        codeInput?.focus();
        return;
      }

      if (codeSubmit) codeSubmit.disabled = true;
      if (message) message.textContent = "Confirming your email...";
      try {
        await completeEmailVerification(pending.email, code);
        if (message) message.textContent = "Owl Membership confirmed.";
      } catch (error) {
        console.error("Email verification failed", error);
        if (message) message.textContent = error?.message || "That code could not be verified.";
      } finally {
        if (codeSubmit) codeSubmit.disabled = false;
      }
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = input ? input.value.trim().toLowerCase() : "";
      if (!email || !email.includes("@") || !email.includes(".")) {
        if (message) message.textContent = "Enter a valid email address.";
        input?.focus();
        return;
      }

      if (submit) submit.disabled = true;
      if (message) message.textContent = "Checking Owl Membership…";
      try {
        const result = await validateEmail(email);
        if (result.verificationRequired === true) {
          clearPendingAdministrator();
          administratorAuthError = "";
          if (message) message.textContent = result.message || "Enter the six-digit code sent to your email.";
          syncEmailVerificationForm();
          codeInput?.focus();
        } else if (result.valid === true) {
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
        console.error("Owl Membership validation failed", error);
        if (message) message.textContent = "Owl Membership could not be checked. Please try again.";
      } finally {
        if (submit) submit.disabled = false;
      }
    });

    syncEmailVerificationForm();
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
        : readPendingEmailVerification()?.purpose === "membership"
        ? dialog.querySelector("#owl-access-code")
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
          ? "Owl Membership is active"
          : "Open Owl Membership"
      );
      button.title = administrator
        ? "The Owl's Office"
        : active
        ? "Owl Membership active"
        : "Owl Membership";
    }
  }

  if (!customElements.get("owl-access-button")) {
    customElements.define("owl-access-button", OwlAccessButton);
  }

  window.StrategicOwlAccess = Object.freeze({
    storageKey: STORAGE_KEY,
    beginEmailVerification,
    can,
    checkAppleAccess,
    clear,
    confirmAccountDeletion,
    completeEmailVerification,
    deleteAccountData,
    getCapabilities,
    getSupabaseClient,
    getSession,
    isActive,
    isAdministrator,
    invokeAudienceAction,
    open,
    requireMembership,
    requireAdministrator,
    restoreMembership,
    refreshButtons,
    validateEmail
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === IDENTITY_KEY) {
      memorySession = readStoredSession(STORAGE_KEY);
      announceChange(memorySession);
      restoreMembership().catch((error) => console.warn("Unable to refresh Owl Membership", error));
    }
  });

  try {
    localStorage.removeItem(UNVERIFIED_ACCESS_KEY);
    localStorage.removeItem(LEGACY_TRU_KEY);
  } catch {
    // The verified session can still live in memory when storage is unavailable.
  }
  memorySession = getSession();
  restoreMembership().catch((error) => {
    console.warn("Unable to restore Owl Membership", error);
  });
})();
