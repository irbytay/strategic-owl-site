// ✅ FUNCTION: Load HTML content into the SPA container
function loadPageContent(path) {
  fetch(path)
    .then(res => res.text())
    .then(html => {
      // 🟦 Inject HTML into the main content area
      document.getElementById('spa-content').innerHTML = html;
      window.scrollTo(0, 0);

      if (path.includes("TRUOWL")) {
        initTRUPage();
      }

      // ✅ LOAD CORRESPONDING JS FILE (if exists)
      // 🟨 Build path to JS file: assumes matching name in scripts/ folder
      const scriptPath = "scripts/" + path.replace('.html', '.js');

      // 🟥 Remove old script tag if it exists (prevents duplicates)
      const oldScript = document.getElementById('dynamic-script');
      if (oldScript) oldScript.remove();

      // 🟩 Create new script element and append to body
      const newScript = document.createElement('script');
      newScript.src = scriptPath;
      newScript.id = 'dynamic-script';
      document.body.appendChild(newScript);
    })
    .catch(err => {
      // 🔴 Error fallback
      document.getElementById('spa-content').innerHTML = "<p>Sorry, something went wrong loading this page.</p>";
      console.error("SPA Load Error:", err);
    });
}

// ✅ ON PAGE LOAD: Set up navigation and legal popup logic
document.addEventListener('DOMContentLoaded', () => {
  // 🟦 Load default homepage content
  loadPageContent('TRUOWL2_v3.html');

  // ✅ HANDLE NAVIGATION LINKS (SPA-style)
  // 🟨 Attach click handlers to all links with data-path
  document.querySelectorAll('a[data-path]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const path = link.getAttribute('data-path');
      if (path) loadPageContent(path);
    });
  });

  // ✅ LEGAL POPUP LOGIC
  // 🟦 Set up legal modal to appear every 30 days if not accepted
  const legalPopup = document.getElementById('legal-popup');
  const lastAccepted = localStorage.getItem('legalPopupAccepted');
  const now = Date.now();
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;

  if (legalPopup && (!lastAccepted || now - parseInt(lastAccepted) > thirtyDays)) {
    legalPopup.style.display = 'block';
  }

  // 🟩 Accept button closes the popup and sets localStorage
  const acceptBtn = document.getElementById('accept-link');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('legalPopupAccepted', Date.now().toString());
      if (legalPopup) legalPopup.style.display = 'none';
    });
  }
});
const TRU_MULTIPLIERS = {
    5: { truth: 4.0, reliability: 4.0, understanding: 5.0 },
    4: { truth: 3.5, reliability: 3.5, understanding: 4.5 },
    3: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    2: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    1: { truth: 1.3, reliability: 1.3, understanding: 2.0 },
    0: { truth: 1.0, reliability: 1.0, understanding: 2.0 },
  };

  let rowMap = {}, roleMap = {};

  async function fetchTRUData() {
    const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
    const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
    const RANGE = "TRU!A2:K1000";
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
    let names = (role === "All") ? Object.keys(rowMap) : roleMap[role] || [];
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
    const indicatorBar = document.getElementById("indicator-bar");

    const selected = select.value;
    if (!selected || !rowMap[selected]) {
      table.style.display = "none";
      totalBox.style.display = "none";
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
    const summaryBelowTable = row[8] || "";
    const totalScoreComment = row[9] || "Summary not available";
    const roleFlag = parseInt(row[10]) || 0;

    const multiplier = TRU_MULTIPLIERS[roleFlag] || TRU_MULTIPLIERS[0];
    const truthFinal = truthRaw * multiplier.truth;
    const reliabilityFinal = reliabilityRaw * multiplier.reliability;
    const understandingFinal = understandingRaw * multiplier.understanding;

    const scores = [
      { label: "Truth", value: truthFinal, comment: commentTruth, className: "text-truth" },
      { label: "Reliability", value: reliabilityFinal, comment: commentReliability, className: "text-reliability" },
      { label: "Understanding", value: understandingFinal, comment: commentUnderstanding, className: "text-understanding" },
    ];

    let total = 0;
    scores.forEach(({ label, value, comment, className }) => {
      const tr = document.createElement("tr");

      const tdScore = document.createElement("td");
     tdScore.className = "";
tdScore.setAttribute("data-label", "Score");
tdScore.innerHTML = `
  <div style="display: flex; flex-direction: column; align-items: center;">
    <span class="${className}">${label}</span>
    <span class="num-font" style="color: var(--text); font-weight: bold; font-size: 1.035rem;">
  ${value >= 0 ? "+" : ""}${value.toFixed(0)}
</span>
  </div>
`;

      const tdComment = document.createElement("td");
tdComment.setAttribute("data-label", "Explanation");
tdComment.setAttribute("style", `
  font-family: 'Playfair Display', serif;
  font-size: 1.035rem;
  color: var(--text);
  text-align: left;
  line-height: 1.5;
  padding: 8px 12px;
`);
tdComment.textContent = comment;

      tr.appendChild(tdScore);
      tr.appendChild(tdComment);
      tbody.appendChild(tr);

      total += value;
    });

    const totalRow = document.createElement("tr");

    const tdTotalScore = document.createElement("td");
    tdTotalScore.className = "total-score";
    tdTotalScore.setAttribute("data-label", "Score");
   tdTotalScore.innerHTML = `
  <div style="display: flex; flex-direction: column; align-items: center;">
    <strong>Total Score</strong>
    <span class="num-font" style="color: ${total >= 0 ? 'var(--bar-green)' : 'var(--bar-red)'}; font-weight: bold;">
      ${total >= 0 ? "+" : ""}${total.toFixed(0)}
    </span>
  </div>
`;

    const tdTotalComment = document.createElement("td");
    tdTotalComment.className = "total-score";
    tdTotalComment.setAttribute("data-label", "Explanation");
    tdTotalComment.innerHTML = `<strong style="font-family: 'Playfair Display', serif;">${totalScoreComment}</strong>`;

    totalRow.appendChild(tdTotalScore);
    totalRow.appendChild(tdTotalComment);
    tbody.appendChild(totalRow);

    indicatorBar.className = "bar-indicator " + (total >= 0 ? "bar-green" : "bar-red");
    totalCommentEl.innerHTML = summaryBelowTable;

    table.style.display = "table";
    totalBox.style.display = "block";
  }

function initTRUPage() {
  fetchTRUData().then(data => {
    populateDropdowns(data);
    document.getElementById("role-filter").addEventListener("change", e => updatePersonDropdown(e.target.value));
    document.getElementById("person-select").addEventListener("change", showScores);
  });
}

  function toggleMenu() {
    document.getElementById("navMenu").classList.toggle("show");
  }
