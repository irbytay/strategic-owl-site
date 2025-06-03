const TRU_MULTIPLIERS = {
    5: { truth: 4.0, reliability: 4.0, understanding: 5.0 },
    4: { truth: 3.5, reliability: 3.5, understanding: 4.5 },
    3: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    2: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    1: { truth: 1.3, reliability: 1.3, understanding: 2.0 },
    0: { truth: 1.0, reliability: 1.0, understanding: 2.0 },
  };

  let rowMap = {};
  let roleMap = {};

  async function fetchTRUData() {
    const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
    const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
    const RANGE = "TRU!A2:K1000"; // Includes columns A–K
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
      const json = await res.json();
      return json.values || [];
    } catch (err) {
      console.error("Failed to fetch sheet data", err);
      return [];
    }
  }

  function populateDropdowns(data) {
    rowMap = {};
    roleMap = {};

    data.forEach(row => {
      const name = row[0];
      const role = row[1] || "Uncategorized";
      if (!roleMap[role]) roleMap[role] = [];
      roleMap[role].push(name);
      if (name) rowMap[name] = row;
    });

    const roleSelect = document.getElementById("role-filter");
    roleSelect.innerHTML = '<option value="All">All</option>';
    Object.keys(roleMap).sort().forEach(role => {
      const opt = document.createElement("option");
      opt.value = role;
      opt.textContent = role;
      roleSelect.appendChild(opt);
    });

    updatePersonDropdown("All");
  }

  function updatePersonDropdown(role) {
    const personSelect = document.getElementById("person-select");
    personSelect.innerHTML = '<option value="">-- Choose a name --</option>';

    let names = [];

    if (role === "All") {
      names = Object.keys(rowMap);
    } else if (roleMap[role]) {
      names = roleMap[role];
    }

    names.sort().forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      personSelect.appendChild(opt);
    });

    personSelect.disabled = names.length === 0;
  }

  function showScores() {
    const select = document.getElementById("person-select");
    const table = document.getElementById("score-table");
    const tbody = document.getElementById("score-body");
    const totalBox = document.getElementById("total-score-box");
    const totalCommentEl = document.getElementById("total-score-comment");

    const selected = select.value;
    if (!selected || !rowMap[selected]) {
      table.style.display = "none";
      if (totalBox) totalBox.style.display = "none";
      return;
    }

    const row = rowMap[selected];
    tbody.innerHTML = "";

    const truthRaw = parseFloat(row[2]) || 0;
    const reliabilityRaw = parseFloat(row[3]) || 0;
    const understandingRaw = parseFloat(row[4]) || 0;

    const commentTruth = row[5] || "";
    const commentReliability = row[6] || "";
    const commentUnderstanding = row[7] || "";
    const summaryBelowTable = row[8] || ""; // ⬅️ Column I (summary under table)
    const totalScoreComment = row[9] || "Summary not available"; // ⬅️ Column J (yellow row)
    const roleFlag = parseInt(row[10]) || 0;

    const multiplier = TRU_MULTIPLIERS[roleFlag] || TRU_MULTIPLIERS[0];

    const truthFinal = truthRaw * multiplier.truth;
    const reliabilityFinal = reliabilityRaw * multiplier.reliability;
    const understandingFinal = understandingRaw * multiplier.understanding;

    const scores = [
      { label: "Truth", value: truthFinal, raw: truthRaw, mult: multiplier.truth, comment: commentTruth, className: "text-truth" },
      { label: "Reliability", value: reliabilityFinal, raw: reliabilityRaw, mult: multiplier.reliability, comment: commentReliability, className: "text-reliability" },
      { label: "Understanding", value: understandingFinal, raw: understandingRaw, mult: multiplier.understanding, comment: commentUnderstanding, className: "text-understanding" },
    ];

    let total = 0;
    scores.forEach(({ label, value, raw, mult, comment, className }) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="${className}">${label}</td>
        <td class="${className}">${value >= 0 ? "+" : ""}${value.toFixed(0)}</td>
        <td>${comment}</td>`;
      tbody.appendChild(tr);
      total += value;
    });

    const totalRow = document.createElement("tr");
    totalRow.innerHTML = `
      <td class="total-score"><strong>Total Score</strong></td>
      <td class="total-score"><strong>${total >= 0 ? "+" : ""}${total.toFixed(0)}</strong></td>
      <td class="total-score"><strong>${totalScoreComment}</strong></td>`;
    tbody.appendChild(totalRow);

    table.style.display = "table";
    if (totalBox && totalCommentEl) {
      totalCommentEl.textContent = summaryBelowTable;
      totalBox.style.display = "block";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const data = await fetchTRUData();
    populateDropdowns(data);

    const roleSelect = document.getElementById("role-filter");
    const personSelect = document.getElementById("person-select");

    roleSelect.addEventListener("change", () => {
      updatePersonDropdown(roleSelect.value);
    });

    personSelect.addEventListener("change", showScores);
  });
