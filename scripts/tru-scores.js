// Multiplier values based on roleFlag
const TRU_MULTIPLIERS = {
  5: { truth: 4.0, reliability: 4.0, understanding: 5.0 },
  4: { truth: 3.5, reliability: 3.5, understanding: 4.5 },
  3: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
  2: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
  1: { truth: 1.3, reliability: 1.3, understanding: 2.0 },
  0: { truth: 1.0, reliability: 1.0, understanding: 2.0 },
};

// Fetch data from Google Sheets
async function fetchTRUData() {
  const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const RANGE = "TRU!A2:AG1000";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    const json = await res.json();
    return json.values || [];
  } catch (err) {
    console.error("Failed to fetch sheet data", err);
    const select = document.getElementById("person-select");
    if (select) {
      select.innerHTML = '<option value="">Failed to load data.</option>';
    }
    return [];
  }
}

// Triggered when a person is selected from dropdown
window.showScores = function () {
  const select = document.getElementById("person-select");
  const table = document.getElementById("score-table");
  const tbody = document.getElementById("score-body");
  const totalBox = document.getElementById("total-score-box");
  const totalCommentEl = document.getElementById("total-score-comment");

  const selected = select.value;
  if (!selected || !window.rowMap || !window.rowMap[selected]) {
    table.style.display = "none";
    if (totalBox) totalBox.style.display = "none";
    return;
  }

  const row = window.rowMap[selected];
  tbody.innerHTML = "";

  const truthRaw = parseFloat(row[25]) || 0;
  const reliabilityRaw = parseFloat(row[26]) || 0;
  const understandingRaw = parseFloat(row[27]) || 0;

  const commentTruth = row[28] || "";
  const commentReliability = row[29] || "";
  const commentUnderstanding = row[30] || "";
  const totalScoreComment = row[31] || "Summary not available";

  const roleFlag = parseInt(row[32]) || 0;
  const multiplier = TRU_MULTIPLIERS[roleFlag] || TRU_MULTIPLIERS[0];

  const truthFinal = truthRaw * multiplier.truth;
  const reliabilityFinal = reliabilityRaw * multiplier.reliability;
  const understandingFinal = understandingRaw * multiplier.understanding;

  const scores = [
    { label: "Truth", value: truthFinal, raw: truthRaw, mult: multiplier.truth, comment: commentTruth },
    { label: "Reliability", value: reliabilityFinal, raw: reliabilityRaw, mult: multiplier.reliability, comment: commentReliability },
    { label: "Understanding", value: understandingFinal, raw: understandingRaw, mult: multiplier.understanding, comment: commentUnderstanding },
  ];

  let total = 0;

  scores.forEach(({ label, value, raw, mult, comment }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${label}</td>
      <td>${value >= 0 ? "+" : ""}${value.toFixed(0)} <small>(${raw.toFixed(1)} × ${mult.toFixed(1)})</small></td>
      <td>${comment}</td>`;
    tbody.appendChild(tr);
    total += value;
  });

  const totalRow = document.createElement("tr");
  totalRow.innerHTML = `
    <td><strong>Total Score</strong></td>
    <td><strong>${total >= 0 ? "+" : ""}${total.toFixed(0)}</strong></td>
    <td><strong>${totalScoreComment}</strong></td>`;
  tbody.appendChild(totalRow);

  table.style.display = "table";
  if (totalBox && totalCommentEl) {
    totalCommentEl.textContent = totalScoreComment;
    totalBox.style.display = "block";
  }
};

// Initialization for SPA or standalone
window.initElectionPage = async function () {
  window.rowMap = {};
  const data = await fetchTRUData();
  data.forEach(row => {
    const key = row[0];
    if (key) window.rowMap[key] = row;
  });

  const select = document.getElementById("person-select");
  if (!select) {
    console.warn("Dropdown not found.");
    return;
  }

  select.innerHTML = '<option value="">-- Choose a name --</option>';
  Object.keys(window.rowMap).sort().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
    select.appendChild(opt);
  });

  select.removeEventListener("change", window.showScores);
  select.addEventListener("change", window.showScores);
};

// Auto-init if not SPA (standalone fallback)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.initElectionPage === "function") {
      window.initElectionPage();
    }
  });
} else {
  if (typeof window.initElectionPage === "function") {
    window.initElectionPage();
  }
}
