/* Matches the public dashboard logic in Flutter dash.dart. */
(function () {
  "use strict";

  const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const DASHBOARD_RANGE = "Dashboards!A1:Q43";

  const roleColumns = {
    Influencers: { highest: [0, 1], lowest: [2, 3] },
    Journalists: { highest: [4, 5], lowest: [6, 7] },
    Politicians: { highest: [8, 9], lowest: [10, 11] },
    "Media Companies": { highest: [12, 13], lowest: [14, 15] }
  };

  let dashboardRows = [];
  let countData = new Map();
  let selectedRole = "Influencers";
  let selectedScoreGroup = "highest";

  function setHidden(id, hidden) {
    const element = document.getElementById(id);
    if (element) element.hidden = hidden;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value ?? "");
  }

  function valueFor(labels) {
    for (const label of labels) {
      const value = countData.get(label);
      if (value && value.trim()) return value.trim();
    }
    return "0";
  }

  function formatScore(rawScore) {
    const value = Number.parseFloat(String(rawScore || "").trim());
    if (!Number.isFinite(value)) return String(rawScore || "").trim();
    return Math.round(value).toLocaleString("en-US");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  async function fetchDashboardData() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const encodedRange = encodeURIComponent(DASHBOARD_RANGE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedRange}?key=${API_KEY}`;

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Google Sheets returned ${response.status}.`);
      const data = await response.json();
      if (!Array.isArray(data.values)) throw new Error("The dashboard response had no values.");
      return data.values.map((row) => Array.isArray(row) ? row.map((cell) => String(cell)) : []);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function parseDashboard(values) {
    dashboardRows = values.slice(0, 11);
    countData = new Map();

    for (let index = 11; index <= 18 && index < values.length; index += 1) {
      const label = String(values[index]?.[0] || "").trim();
      const value = String(values[index]?.[1] || "").trim();
      if (label && value) countData.set(label, value);
    }
  }

  function renderCounts() {
    setText("total-profiles", valueFor(["Total Scores Analyzed", "Total Scores Published"]));
    setText("count-high-office", valueFor(["High Office", "Total High Office"]));
    setText("count-politicians", valueFor(["Politicians", "Total Politicians"]));
    setText("count-influencers", valueFor(["Influencers", "Total Influencers"]));
    setText("count-journalists", valueFor(["Journalists", "Total Journalists"]));
    setText("count-media-companies", valueFor(["Media Companies", "Total Media Companies"]));
    setText("positive-politicians", valueFor([
      "Positive-Scored Politicians",
      "Count of Positive-Scored Politicians"
    ]));
    setText("negative-politicians", valueFor([
      "Count of Negative-Scored Politicians",
      "Negative-Scored Politicians"
    ]));
  }

  function rankingEntries() {
    const columns = roleColumns[selectedRole]?.[selectedScoreGroup] || roleColumns.Influencers.highest;
    const [nameColumn, scoreColumn] = columns;

    return dashboardRows.slice(1).map((row) => ({
      name: String(row[nameColumn] || "").trim(),
      rawScore: String(row[scoreColumn] || "").trim()
    })).filter((entry) => entry.name || entry.rawScore);
  }

  function renderRanking() {
    const groupLabel = selectedScoreGroup === "highest" ? "Highest Scores" : "Lowest Scores";
    const entries = rankingEntries();
    const list = document.getElementById("ranking-list");

    setText("ranking-role-title", selectedRole);
    setText("ranking-group-title", groupLabel);
    if (!list) return;

    if (!entries.length) {
      list.innerHTML = '<li class="ranking-empty">No scores are listed yet.</li>';
      return;
    }

    list.innerHTML = entries.map((entry, index) => {
      const numericScore = Number.parseFloat(entry.rawScore);
      const scoreClass = Number.isFinite(numericScore) && numericScore < 0
        ? "score-negative"
        : "score-positive";

      return `
        <li class="ranking-row">
          <span class="ranking-number" aria-hidden="true">${index + 1}</span>
          <span class="ranking-name">${escapeHtml(entry.name)}</span>
          ${entry.rawScore ? `<strong class="ranking-score ${scoreClass}">${escapeHtml(formatScore(entry.rawScore))}</strong>` : ""}
        </li>`;
    }).join("");
  }

  function updateScoreGroupButtons() {
    document.querySelectorAll("[data-score-group]").forEach((button) => {
      const selected = button.dataset.scoreGroup === selectedScoreGroup;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function showReadyState() {
    setHidden("dashboard-loading", true);
    setHidden("dashboard-error", true);
    setHidden("dashboard-ready", false);
    setHidden("tru-count-card", countData.size === 0);
    setHidden("ranking-controls", false);
    setHidden("ranking-card", false);
  }

  function showErrorState() {
    setHidden("dashboard-loading", true);
    setHidden("dashboard-ready", true);
    setHidden("dashboard-error", false);
    setHidden("tru-count-card", true);
    setHidden("ranking-controls", true);
    setHidden("ranking-card", true);
  }

  async function loadDashboard() {
    setHidden("dashboard-loading", false);
    setHidden("dashboard-ready", true);
    setHidden("dashboard-error", true);

    try {
      const values = await fetchDashboardData();
      parseDashboard(values);
      renderCounts();
      renderRanking();
      showReadyState();
    } catch (error) {
      console.warn("T.R.U. dashboard failed to load:", error);
      showErrorState();
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("public-role-select")?.addEventListener("change", (event) => {
      selectedRole = event.target.value;
      renderRanking();
    });

    document.querySelectorAll("[data-score-group]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedScoreGroup = button.dataset.scoreGroup === "lowest" ? "lowest" : "highest";
        updateScoreGroupButtons();
        renderRanking();
      });
    });

    document.getElementById("dashboard-retry")?.addEventListener("click", loadDashboard);
    loadDashboard();
  });
})();
