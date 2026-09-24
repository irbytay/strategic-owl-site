(function () {
  "use strict";

  const CACHE_KEY = "activeAppCountdownWebV1";
  const PLACEMENT = "voter_resources";
  const ONE_MINUTE = 60000;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function saveCache(value) {
    try {
      if (value) localStorage.setItem(CACHE_KEY, JSON.stringify(value));
      else localStorage.removeItem(CACHE_KEY);
    } catch {
      // The countdown still works when browser storage is unavailable.
    }
  }

  async function loadCountdown() {
    try {
      const client = window.StrategicOwlAccess?.getSupabaseClient();
      if (!client) throw new Error("Supabase is unavailable.");

      const { data, error } = await client
        .from("app_countdowns")
        .select("title,target_at,short_label,footer_text,completed_text")
        .eq("placement", PLACEMENT)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      saveCache(data || null);
      return data || null;
    } catch (error) {
      console.warn("Countdown is using its saved value.", error);
      return readCache();
    }
  }

  function localTargetDate(targetAt) {
    const stored = new Date(targetAt);
    if (Number.isNaN(stored.getTime())) return null;
    return new Date(stored.getUTCFullYear(), stored.getUTCMonth(), stored.getUTCDate());
  }

  function calendarDaysRemaining(target) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
  }

  function adaptiveResult(target) {
    const remainingMinutes = Math.floor((target.getTime() - Date.now()) / 60000);
    if (remainingMinutes <= 0) return "ELECTION DAY";

    if (remainingMinutes < 48 * 60) {
      const hours = Math.floor(remainingMinutes / 60);
      const minutes = remainingMinutes % 60;
      return `${hours} ${hours === 1 ? "HOUR" : "HOURS"} · ${minutes} ${minutes === 1 ? "MINUTE" : "MINUTES"}`;
    }

    if (remainingMinutes < 8 * 24 * 60) {
      const days = Math.floor(remainingMinutes / (24 * 60));
      const hours = Math.floor(remainingMinutes / 60) % 24;
      return `${days} ${days === 1 ? "DAY" : "DAYS"} · ${hours} ${hours === 1 ? "HOUR" : "HOURS"}`;
    }

    const days = calendarDaysRemaining(target);
    return `${days} ${days === 1 ? "DAY" : "DAYS"}`;
  }

  function eventLabel(countdown) {
    return String(countdown.short_label || countdown.title || "the next election").trim();
  }

  function renderCompact(host, countdown, target) {
    const complete = Date.now() >= target.getTime();
    const days = calendarDaysRemaining(target);
    host.textContent = complete && countdown.completed_text
      ? countdown.completed_text
      : `${days} ${days === 1 ? "day" : "days"} until ${eventLabel(countdown)}`;
    host.hidden = false;
  }

  function renderFull(host, countdown, target) {
    const complete = Date.now() >= target.getTime();
    const result = complete && countdown.completed_text
      ? countdown.completed_text
      : adaptiveResult(target);
    const formattedDate = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(target);

    host.innerHTML = `
      <div class="owl-countdown-result">${escapeHtml(result)}</div>
      ${complete ? "" : `<div class="owl-countdown-label">Until ${escapeHtml(eventLabel(countdown))}</div>`}
      <div class="owl-countdown-date">${escapeHtml(formattedDate)}</div>
      <button class="owl-countdown-action" type="button">Check Registration</button>`;
    host.hidden = false;

    host.querySelector(".owl-countdown-action")?.addEventListener("click", () => {
      document.getElementById("register-title")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      window.setTimeout(() => document.getElementById("state-select")?.focus(), 600);
    });
  }

  function render(countdown) {
    const target = localTargetDate(countdown?.target_at);
    if (!countdown || !target) return;

    document.querySelectorAll("[data-app-countdown]").forEach((host) => {
      if (host.dataset.appCountdown === "compact") renderCompact(host, countdown, target);
      else renderFull(host, countdown, target);
    });
  }

  async function initialize() {
    const countdown = await loadCountdown();
    if (!countdown) return;
    render(countdown);
    window.setInterval(() => render(countdown), ONE_MINUTE);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
