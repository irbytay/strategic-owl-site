// election-scores.js — loads election security scores from Google Sheets

const ELECTION_SHEET_CONFIG = {
  apiKey: "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78",
  sheetId: "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA",
  range: "TRU!A2:Y1000",
};

async function fetchTRUData() {
  const { apiKey, sheetId, range } = ELECTION_SHEET_CONFIG;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    return json.values || [];
  } catch (err) {
    console.error("Failed to fetch sheet data", err);
    const select = document.getElementById("person-select");
    if (select) {
      select.innerHTML = '<option value="">Failed to load data. Please try again later.</option>';
    }
    return [];
  }
}

function showScores() {
  const select = document.getElementById("person-select");
  const table = document.getElementById("score-table");
  const tbody = document.getElementById("score-body");
  const selected = select.value;

  if (!selected || !window.rowMap || !window.rowMap[selected]) {
    table.style.display = "none";
    return;
  }

  const row = window.rowMap[selected];
  tbody.innerHTML = "";
  let total = 0;

  const categories = [
    "Constitutional Knowledge", "Legal Framework", "Federalism",
    "Election Mechanics", "Electoral Count Process", "Disinformation Awareness",
    "Public Impact", "Judicial Oversight", "Election Worker Protections",
    "Psychological Manipulation"
  ];

  for (let i = 0; i < 10; i++) {
    const label = categories[i];
    const score = parseInt(row[3 + i]) || 0;
    const explanation = row[14 + i] || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${label}</td><td>${score >= 0 ? "+" : ""}${score}</td><td>${explanation}</td>`;
    tbody.appendChild(tr);
    total += score;
  }

  const flag = (row[24] || "").toLowerCase();
  let bonus = 0, label = "", desc = "";

  if (flag === "true") {
    bonus = -10;
    label = "2020 Election Denial Penalty";
    desc = "Denial of the 2020 election outcome signals rejection of verified democratic processes and aligns with disinformation or blind loyalty.";
  } else if (flag === "false") {
    bonus = 5;
    label = "2020 Election Affirmation Bonus";
    desc = "Publicly affirming the legitimacy of the 2020 election supports truth, counters disinformation, and helps protect democratic confidence.";
  } else if (flag === "gray") {
    bonus = -5;
    label = "Ambiguous Stance Penalty";
    desc = "Failure to clearly affirm the 2020 election results contributes to public doubt and enables misinformation to spread unchecked.";
  }

  if (label) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${label}</strong></td><td><strong>${bonus >= 0 ? "+" : ""}${bonus}</strong></td><td><strong>${desc}</strong></td>`;
    tbody.appendChild(tr);
    total += bonus;
  }

  const summary = row[13] || "No summary provided.";
  const totalRow = document.createElement("tr");
  totalRow.innerHTML = `<td><strong>Total Score</strong></td><td><strong>${total >= 0 ? "+" : ""}${total}</strong></td><td><strong>${summary}</strong></td>`;
  tbody.appendChild(totalRow);

  table.style.display = "table";
}

async function initElectionPage() {
  window.rowMap = {};
  const data = await fetchTRUData();
  data.forEach(row => {
    const key = row[0];
    if (key) window.rowMap[key] = row;
  });

  const select = document.getElementById("person-select");
  if (!select) return;

  select.innerHTML = '<option value="">-- Choose a name --</option>';
  Object.keys(window.rowMap).sort().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
    select.appendChild(opt);
  });

  select.removeEventListener("change", showScores);
  select.addEventListener("change", showScores);
}

// 👇 Only runs when page loads independently (standalone)
window.addEventListener("DOMContentLoaded", initElectionPage);
