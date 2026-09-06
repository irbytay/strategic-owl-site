/* Behavior migrated from realitycheck.html. */
const API_KEY = "AIzaSyB3NmN4OpDutbaX6V2KkLy1p-vDLghrF5M";
    const SHEET_ID = "1p66gmWWjxJbrySxpR5T--fP8iEgUbW7RrXru61gagRA";
    const RANGE = "HeritageVoterfraudRawData!B6:D1589";

    async function fetchSheetData() {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
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
   function toggleMenu() {
    const menu = document.getElementById("navMenu");
    menu.classList.toggle("show");
  }

  // Close mobile menu when clicking outside of it
  function closeMenuOnOutsideClick(event) {
    const navMenu = document.getElementById("navMenu");
    const menuToggle = document.querySelector(".menu-toggle");

    if (
      navMenu.classList.contains("show") &&
      !navMenu.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      navMenu.classList.remove("show");
    }
  }

  document.addEventListener("click", closeMenuOnOutsideClick);

    // ✅ Enable for standalone mode
    window.addEventListener("DOMContentLoaded", initStateFraudPage);
  function toggleMenu() {
    document.getElementById("navMenu").classList.toggle("show");
  }
  // --- Culture Subs JS ---
  async function fetchCultureData() {
    const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
    const RANGE = "CultureSubs!A2:D1000";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      return data.values || [];
    } catch (error) {
      console.error("Failed to fetch CultureSubs data:", error);
      return [];
    }
  }

  async function initCulturePage() {
    const dropdown = document.getElementById("culture-select");
    const cultureRows = await fetchCultureData();
    const subjectSet = new Set(cultureRows.map(row => row[0]));

    // Clear and repopulate dropdown only
    dropdown.innerHTML = '<option value="">Misconception</option>';
    subjectSet.forEach(subject => {
      const opt = document.createElement("option");
      opt.value = subject;
      opt.textContent = subject;
      dropdown.appendChild(opt);
    });

    window.cultureMap = {};
    cultureRows.forEach(row => {
      const subject = row[0];
      if (!window.cultureMap[subject]) {
        window.cultureMap[subject] = [];
      }
      window.cultureMap[subject].push({ subcategory: row[1], claim: row[2], extra: row[3] || "" });
    });
  }

  function showCultureSubs() {
    const selected = document.getElementById("culture-select").value;
    const wrapper = document.getElementById("culture-results");
    const body = document.getElementById("culture-body");
    body.innerHTML = "";

    if (!selected || !window.cultureMap[selected]) {
      wrapper.style.display = "none";
      return;
    }

    window.cultureMap[selected].forEach(({ claim, extra }) => {
      const claimRow = document.createElement("tr");
      claimRow.innerHTML = `<td colspan="3" style="padding-left: 12px; padding-top: 16px; color: #FF7F7F; font-weight: bold;"><em>Claim:</em> ${claim}</td>`;
      body.appendChild(claimRow);

      const factRow = document.createElement("tr");
      factRow.innerHTML = `<td colspan="3" style="padding-left: 20px; padding-bottom: 12px; color: var(--understanding);"><em>Fact:</em> ${extra}</td>`;
      body.appendChild(factRow);
    });

    wrapper.style.display = "block";
  }

  window.addEventListener("DOMContentLoaded", initCulturePage);
