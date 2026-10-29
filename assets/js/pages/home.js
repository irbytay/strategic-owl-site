(function () {
  "use strict";

  const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const LAST_PATH_KEY = "strategicOwlLastPrimaryPath";
  const STATUS_URL = "https://status.thestrategicowl.com/api/status";

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  async function fetchHomeData() {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet`);
    url.searchParams.set("key", API_KEY);
    ["Homepage!C3", "Homepage!C4:C6", "Homepage!C9:C19"].forEach((range) => url.searchParams.append("ranges", range));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Homepage data returned ${response.status}.`);
    const data = await response.json();
    const ranges = data.valueRanges || [];
    const valuesFor = (needle) => ranges.find((entry) => String(entry.range || "").includes(needle))?.values || [];
    const notes = valuesFor("Homepage!C4").map((row) => String(row?.[0] || "").trim()).filter(Boolean);
    const story = valuesFor("Homepage!C9").map((row) => String(row?.[0] || "").trim()).filter(Boolean);
    return {
      timestamp: String(valuesFor("Homepage!C3")?.[0]?.[0] || ""),
      notes,
      civicHeading: story[0] || "A civic thought for today",
      civicCopy: story[1] || story[2] || "Strong civic judgment begins with the original record and more than one reliable source."
    };
  }

  async function loadHomeData() {
    try {
      const data = await fetchHomeData();
      document.getElementById("mission-update-timestamp").textContent = data.timestamp;
      document.getElementById("mission-update-list").innerHTML = data.notes.length
        ? data.notes.map((note) => `<div class="home-update-item"><span aria-hidden="true"></span><p>${escapeHtml(note)}</p></div>`).join("")
        : '<p class="home-muted">New updates will appear here.</p>';
      document.getElementById("civic-title").textContent = data.civicHeading;
      document.getElementById("civic-knowledge-copy").innerHTML = `<p>${escapeHtml(data.civicCopy)}</p>`;
    } catch {
      document.getElementById("mission-update-list").innerHTML = '<p class="home-muted">Coverage is ready whenever you are.</p>';
      document.getElementById("civic-knowledge-copy").innerHTML = '<p>Strong civic judgment begins with the original record and more than one reliable source.</p>';
    }
  }

  function restoreContinueCard() {
    const destinations = {
      "coverage.html": ["Owl Radar", "Return to Radar and compare developing stories.", "Open Radar"],
      "coverage.html?view=feed": ["News Feed", "Return to the newest reporting across every source.", "Open Feed"],
      "civic-owl.html": ["Civic Owl", "Continue building your civic knowledge and mastery.", "Open Challenge"],
      "voter-resources.html": ["Civic Resources", "Return to official voter and vital-record links.", "Open Resources"],
      "constitution.html": ["Library", "Continue exploring the founding documents.", "Open Library"]
    };
    const saved = localStorage.getItem(LAST_PATH_KEY);
    if (!saved || !destinations[saved]) return;
    const [title, copy, action] = destinations[saved];
    document.getElementById("begin-eyebrow").textContent = "Pick Up Where You Left Off";
    document.getElementById("begin-title").textContent = title;
    document.getElementById("begin-copy").textContent = copy;
    const link = document.getElementById("continue-action");
    link.href = saved;
    link.innerHTML = `${action} <span aria-hidden="true">→</span>`;
  }

  async function loadSystemStatus() {
    const card = document.getElementById("home-system-status");
    const copy = document.getElementById("home-system-status-copy");
    if (!card || !copy) return;
    try {
      const response = await fetch(STATUS_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Status unavailable");
      const status = await response.json();
      const state = status.overall === "operational" ? "operational" : status.overall === "outage" ? "outage" : "degraded";
      card.dataset.state = state;
      copy.textContent = state === "operational"
        ? "All systems operational"
        : String(status.headline || "A service needs attention");
    } catch {
      card.dataset.state = "unknown";
      copy.textContent = "Status could not be confirmed";
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="coverage.html"], a[href="civic-owl.html"], a[href="voter-resources.html"], a[href="constitution.html"]');
    if (link) localStorage.setItem(LAST_PATH_KEY, link.getAttribute("href"));
  });

  restoreContinueCard();
  loadHomeData();
  loadSystemStatus();
})();
