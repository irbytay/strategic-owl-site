// state-fraud.js — loads voter fraud cases by U.S. state from Google Sheets

const STATE_FRAUD_CONFIG = {
  apiKey: "AIzaSyB3NmN4OpDutbaX6V2KkLy1p-vDLghrF5M",
  sheetId: "1p66gmWWjxJbrySxpR5T--fP8iEgUbW7RrXru61gagRA",
  range: "HeritageVoterfraudRawData!B6:D1589",
};

async function fetchSheetData() {
  const { apiKey, sheetId, range } = STATE_FRAUD_CONFIG;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.values || [];
  } catch (error) {
    console.error("Failed to fetch data:", error);
    return [];
  }
}

function populateDropdown(statesSet, stateSelect) {
  const sortedStates = Array.from(statesSet).sort();
  sortedStates.forEach(state => {
    const opt = document.createElement("option");
    opt.value = state;
    opt.textContent = state;
    stateSelect.appendChild(opt);
  });
}

async function initStateFraudPage() {
  const stateSelect = document.getElementById("state-select");
  const tableBody = document.getElementById("state-data-body");
  const resultsWrapper = document.getElementById("state-results");
  const summaryLine = document.getElementById("state-summary");

  if (!stateSelect || !tableBody || !resultsWrapper || !summaryLine) {
    console.warn("[statefraud] Required elements not found.");
    return;
  }

  const rows = await fetchSheetData();
  const statesSet = new Set(rows.map(row => row[1]));
  populateDropdown(statesSet, stateSelect);

  stateSelect.addEventListener("change", function () {
    const selected = this.value;
    tableBody.innerHTML = "";
    summaryLine.textContent = "";

    const filtered = rows.filter(row => row[1] === selected);

    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="3">No records found for ${selected}</td></tr>`;
      resultsWrapper.style.display = "flex";
      return;
    }

    const sorted = filtered.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    const years = sorted.map(row => parseInt(row[0])).filter(year => !isNaN(year));
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const caseCount = sorted.length;

    summaryLine.textContent = `${caseCount} case${caseCount === 1 ? '' : 's'} found from ${minYear} to ${maxYear}`;

    sorted.forEach(row => {
      const year = row[0];
      const state = row[1];
      const name = row[2];
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${year}</td><td>${state}</td><td>${name}</td>`;
      tableBody.appendChild(tr);
    });

    resultsWrapper.style.display = "flex";
  });
}

// ✅ Only runs when used standalone
window.addEventListener("DOMContentLoaded", initStateFraudPage);
