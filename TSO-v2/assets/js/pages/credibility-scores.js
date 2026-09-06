/* Behavior migrated from TRU.html. */
const TRU_MULTIPLIERS = {
    5: { truth: 4.0, reliability: 4.0, understanding: 5.0 },
    4: { truth: 3.5, reliability: 3.5, understanding: 4.5 },
    3: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    2: { truth: 3.0, reliability: 3.0, understanding: 4.0 },
    1: { truth: 1.3, reliability: 1.3, understanding: 2.0 },
    0: { truth: 1.0, reliability: 1.0, understanding: 2.0 },
  };

let rowMap = {}, roleMap = {};
let isTRUSubscriberValidated = false;
let currentTRULanguageMode = "point";
const TRU_SUBMISSION_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzHMaa4zsuRPRfH3R0E9lnMehSssulxuUjTdLfXxp_iLuWg4yeMfluAIfEuzXNbzblq/exec";
const TRU_OUT_OF_SCOPE_MESSAGE = "T.R.U. Scores are built for people who shape political or civic understanding. This submission appears outside that lane, or there is not enough public data to review fairly.";
const TRU_SUBSCRIBER_CACHE_KEY = "truSubscriberValidationCache";
const TRU_SUBSCRIBER_CACHE_DAYS = 7;

function syncTRUOwlAccessState() {
  const accessButton = document.getElementById("owl-access-open");
  const messageEl = document.getElementById("truOwlAccessMessage");
  if (accessButton) {
    accessButton.dataset.access = isTRUSubscriberValidated ? "active" : "locked";
    accessButton.setAttribute(
      "aria-label",
      isTRUSubscriberValidated ? "Owl Access is active" : "Open Owl Access"
    );
    accessButton.title = isTRUSubscriberValidated ? "Owl Access active" : "Owl Access";
  }
  if (messageEl && isTRUSubscriberValidated) {
    messageEl.textContent = "Owl Access is active on this device.";
  }
}

function openTRUOwlAccessModal() {
  const modal = document.getElementById("truOwlAccessModal");
  const modalEmail = document.getElementById("truOwlAccessEmail");
  const existingEmail = document.getElementById("truSubscriberEmail");
  if (!modal) return;
  if (modalEmail && existingEmail && !modalEmail.value) {
    modalEmail.value = existingEmail.value;
  }
  modal.hidden = false;
  document.body.classList.add("tru-owl-modal-open");
  if (modalEmail) modalEmail.focus();
}

function closeTRUOwlAccessModal() {
  const modal = document.getElementById("truOwlAccessModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("tru-owl-modal-open");
}

function validateTRUOwlAccessFromModal() {
  const modalEmail = document.getElementById("truOwlAccessEmail");
  const existingEmail = document.getElementById("truSubscriberEmail");
  const messageEl = document.getElementById("truOwlAccessMessage");
  const email = modalEmail ? modalEmail.value.trim().toLowerCase() : "";

  if (!email || !email.includes("@") || !email.includes(".")) {
    if (messageEl) messageEl.textContent = "Enter a valid paid Substack email.";
    return;
  }
  if (!existingEmail) return;

  existingEmail.value = email;
  closeTRUOwlAccessModal();

  const subscriberCard = document.querySelector(".tru-name-submit-card");
  if (subscriberCard) subscriberCard.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(validateTRUSubscriberEmail, 250);
}

function getTRUSubscriberCacheExpiration() {
  return Date.now() + TRU_SUBSCRIBER_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

function saveTRUSubscriberValidationCache(email) {
  if (!email) return;

  const expiresAt = getTRUSubscriberCacheExpiration();

  try {
    localStorage.setItem(
      TRU_SUBSCRIBER_CACHE_KEY,
      JSON.stringify({
        email,
        expiresAt
      })
    );

    if (window.StrategicOwlAccess) {
      window.StrategicOwlAccess.activate(email, expiresAt);
    }
  } catch (error) {
    console.warn("Unable to save TRU subscriber validation cache", error);
  }
}

function getTRUSubscriberValidationCache() {
  try {
    const rawCache = localStorage.getItem(TRU_SUBSCRIBER_CACHE_KEY);
    if (!rawCache) {
      return window.StrategicOwlAccess
        ? window.StrategicOwlAccess.getSession()
        : null;
    }

    const cache = JSON.parse(rawCache);

    if (!cache || !cache.email || !cache.expiresAt || Date.now() > Number(cache.expiresAt)) {
      localStorage.removeItem(TRU_SUBSCRIBER_CACHE_KEY);
      return null;
    }

    return cache;
  } catch (error) {
    localStorage.removeItem(TRU_SUBSCRIBER_CACHE_KEY);
    return null;
  }
}

function unlockTRUProfileSuggestionForm(message) {
  const statusEl = document.getElementById("truSubscriberValidationStatus");
  const fieldsEl = document.getElementById("truProfileSubmissionFields");
  const validationRowEl = document.getElementById("truSubscriberValidationRow");
  const submitTitleEl = document.getElementById("tru-name-submit-title");
  const submitDescriptionEl = document.getElementById("tru-name-submit-description");

  isTRUSubscriberValidated = true;

  if (submitTitleEl) {
    submitTitleEl.textContent = "Suggest a Profile";
  }

  if (submitDescriptionEl) {
    submitDescriptionEl.textContent =
      "Enter the name of an influencer, media company, politician, journalist, or public voice you think should be reviewed.";
  }

  if (statusEl) {
    statusEl.textContent = message || "Subscription verified. You can now suggest a profile.";
  }

  if (validationRowEl) {
    validationRowEl.style.display = "none";
  }

  if (fieldsEl) {
    fieldsEl.style.display = "block";
  }

  syncTRUOwlAccessState();
}

function restoreTRUSubscriberValidationCache() {
  const cache = getTRUSubscriberValidationCache();
  if (!cache) return;

  if (window.StrategicOwlAccess) {
    window.StrategicOwlAccess.activate(cache.email, cache.expiresAt);
  }

  const emailInput = document.getElementById("truSubscriberEmail");

  if (emailInput) {
    emailInput.value = cache.email;
  }

  unlockTRUProfileSuggestionForm("Access validated.");
}

function showTRUSubscriberValidationMessage(message, showSubscribeLink = false) {
  const statusEl = document.getElementById("truSubscriberValidationStatus");
  if (!statusEl) return;

  statusEl.textContent = message;

  if (!showSubscribeLink) return;

  const subscribeLink = document.createElement("a");
  subscribeLink.href = "https://strategicowl.substack.com/";
  subscribeLink.target = "_blank";
  subscribeLink.rel = "noopener noreferrer";
  subscribeLink.className = "tru-substack-subscribe-link";
  subscribeLink.textContent = "Subscribe on Substack";

  statusEl.appendChild(document.createElement("br"));
  statusEl.appendChild(subscribeLink);
}

  function createTRUSubmissionId() {
    const timestampPart = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "");

    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      const uuidPart = window.crypto.randomUUID().split("-")[0].toUpperCase();
      return `TRU-${timestampPart}-${uuidPart}`;
    }

    const fallbackPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `TRU-${timestampPart}-${fallbackPart}`;
  }

  function createTRUSubmissionTimestamp() {
    const now = new Date();
    const easternTimeZone = "America/New_York";

    const datePart = new Intl.DateTimeFormat("en-US", {
      timeZone: easternTimeZone,
      month: "2-digit",
      day: "2-digit",
      year: "numeric"
    }).format(now);

    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone: easternTimeZone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short"
    }).format(now);

    return `${datePart} ${timePart}`;
  }

  async function fetchTRUData() {
    const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
    const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
    const RANGE = "'TRU_3.0'!A2:N";
    const encodedRange = encodeURIComponent(RANGE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedRange}?key=${API_KEY}`;
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
    roleSelect.innerHTML = '<option value="All">All Profiles</option>';
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
    personSelect.innerHTML = '<option value="">Select Name:</option>';
    let names = (role === "All") ? Object.keys(rowMap) : roleMap[role] || [];
    names.sort().forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      personSelect.appendChild(opt);
    });
    personSelect.disabled = names.length === 0;
  }

  function updateTRUProfileSearch(query) {
    const resultsEl = document.getElementById("truProfileSearchResults");
    if (!resultsEl) return;

    const normalizedQuery = (query || "").trim().toLowerCase();
    resultsEl.innerHTML = "";

    if (normalizedQuery.length < 2) {
      return;
    }

    const results = Object.entries(rowMap)
      .map(([name, row]) => {
        const role = row && row[1] ? row[1] : "Uncategorized";
        return { name, role };
      })
      .filter(({ name, role }) => {
        const searchableText = `${name} ${role}`.toLowerCase();
        return searchableText.includes(normalizedQuery);
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);

    if (results.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "tru-profile-search-empty";
      emptyEl.textContent = "No current match found.";
      resultsEl.appendChild(emptyEl);
      return;
    }

    results.forEach(({ name, role }) => {
      const resultEl = document.createElement("button");
      resultEl.type = "button";
      resultEl.className = "tru-profile-search-result-item";
      resultEl.setAttribute("data-name", name);
      resultEl.setAttribute("data-role", role);

      const nameEl = document.createElement("span");
      nameEl.className = "tru-profile-search-result-name";
      nameEl.textContent = name;

      const roleEl = document.createElement("span");
      roleEl.className = "tru-profile-search-result-role";
      roleEl.textContent = role;

      resultEl.appendChild(nameEl);
      resultEl.appendChild(roleEl);
      resultsEl.appendChild(resultEl);
    });
  }

  function loadTRUProfileSearchResult(name, role) {
    const roleSelect = document.getElementById("role-filter");
    const personSelect = document.getElementById("person-select");
    const searchInput = document.getElementById("truProfileSearchInput");
    const resultsEl = document.getElementById("truProfileSearchResults");
    const outputContainer = document.getElementById("output-container");

    if (!name || !role || !roleSelect || !personSelect || !rowMap[name]) return;

    roleSelect.value = role;
    updatePersonDropdown(role);

    personSelect.value = name;
    showScores();

    if (searchInput) {
      searchInput.value = "";
    }

    if (resultsEl) {
      resultsEl.innerHTML = "";
    }

    if (outputContainer) {
      outputContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

function getTRUCredibilityRating(score) {
  if (score >= 80) return "Grounded in Reality";
  if (score >= 40) return "Mostly Grounded";
  if (score >= 1) return "Leaning Credible";
  if (score === 0) return "Not Enough to Judge";
  if (score <= -80) return "Snake in the Grass";
  if (score <= -40) return "Flat-Earth Logic";
  return "Drifting from Reality";
}

function setTRULanguageMode(mode) {
  currentTRULanguageMode = mode === "scoreLogic" ? "scoreLogic" : "point";

  const pointButton = document.getElementById("tru-point-button");
  const scoreLogicButton = document.getElementById("tru-score-logic-button");

  if (pointButton) {
    pointButton.classList.toggle("active", currentTRULanguageMode === "point");
  }

  if (scoreLogicButton) {
    scoreLogicButton.classList.toggle("active", currentTRULanguageMode === "scoreLogic");
  }

  showScores();
}

function getTRULanguageComments(row) {
  const scoreLogicTruth = row[6] || "";
  const scoreLogicReliability = row[7] || "";
  const scoreLogicUnderstanding = row[8] || "";
  const scoreLogicStrategicInsight = row[9] || "Strategic insight not available.";

  if (currentTRULanguageMode === "scoreLogic") {
    return {
      truth: scoreLogicTruth,
      reliability: scoreLogicReliability,
      understanding: scoreLogicUnderstanding,
      strategicInsight: scoreLogicStrategicInsight
    };
  }

  return {
    truth: row[10] || scoreLogicTruth,
    reliability: row[11] || scoreLogicReliability,
    understanding: row[12] || scoreLogicUnderstanding,
    strategicInsight: row[13] || scoreLogicStrategicInsight
  };
}

  function showScores() {
    const select = document.getElementById("person-select");
    const outputContainer = document.getElementById("output-container");
    const table = document.getElementById("score-table");
    const tbody = document.getElementById("score-body");
    const totalBox = document.getElementById("total-score-box");
    const totalCommentEl = document.getElementById("total-score-comment");
    const indicatorBar = document.getElementById("indicator-bar");

    const selected = select.value;
    if (!selected || !rowMap[selected]) {
      outputContainer.style.display = "none";
      return;
    }

    const pointButton = document.getElementById("tru-point-button");
    const scoreLogicButton = document.getElementById("tru-score-logic-button");

    if (pointButton) {
      pointButton.classList.toggle("active", currentTRULanguageMode === "point");
    }

    if (scoreLogicButton) {
      scoreLogicButton.classList.toggle("active", currentTRULanguageMode === "scoreLogic");
    }

    const row = rowMap[selected];

    // Insert prominent heading above the score table
    const existingHeader = document.getElementById("total-score-heading");
    if (existingHeader) existingHeader.remove();
    const scoreHeader = document.createElement("h2");
    scoreHeader.id = "total-score-heading";
    // The score logic must come after total is calculated
    scoreHeader.style.cssText = `
      font-family: 'Playfair Display', serif;
      font-size: 1.5rem;
      text-align: center;
      color: var(--understanding);
      margin-bottom: 16px;
    `;

    tbody.innerHTML = "";

    const truthScore = parseFloat(row[2]) || 0;
    const reliabilityScore = parseFloat(row[3]) || 0;
    const understandingScore = parseFloat(row[4]) || 0;
    const finalTRUScore = parseFloat(row[5]) || 0;
    const languageComments = getTRULanguageComments(row);
    const commentTruth = languageComments.truth;
    const commentReliability = languageComments.reliability;
    const commentUnderstanding = languageComments.understanding;
    const strategicInsight = languageComments.strategicInsight;

    const scores = [
      { label: "Truth", value: truthScore, comment: commentTruth, className: "text-truth" },
      { label: "Reliability", value: reliabilityScore, comment: commentReliability, className: "text-reliability" },
      { label: "Understanding", value: understandingScore, comment: commentUnderstanding, className: "text-understanding" },
    ];

    let total = finalTRUScore;
    const credibilityRating = getTRUCredibilityRating(total);
    scores.forEach(({ label, value, comment, className }) => {
      const tr = document.createElement("tr");

      const tdScore = document.createElement("td");
      tdScore.className = "";
      tdScore.setAttribute("data-label", "Score");
      tdScore.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <span class="${className}">${label}</span>
          <span class="num-font" style="color: var(--text); font-weight: bold; font-size: 1.035rem;">
        ${value >= 0 ? "+" : ""}${value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
      </span>
        </div>
      `;

      const tdComment = document.createElement("td");
      tdComment.setAttribute("data-label", "Explanation");
      tdComment.setAttribute("style", `
        font-family: 'Montserrat', sans-serif;
        font-size: 1.035rem;
        color: var(--text-muted);
        text-align: left;
        line-height: 1.5;
        padding: 8px 12px;
      `);
      tdComment.textContent = comment;

      tr.appendChild(tdScore);
      tr.appendChild(tdComment);
      tbody.appendChild(tr);
    });
    // Set the header after total is calculated
    // scoreHeader.textContent = `${selected} T.R.U. Owl Credibility Score: ${total >= 0 ? "+" : ""}${total.toFixed(0)}`;
    scoreHeader.innerHTML = `
      <div style="font-family: 'Playfair Display', serif; text-align: center;">
        <span style="font-size: 1.6rem; color: var(--heading); font-weight: bold;">${selected}</span>
        <br />
        <span style="font-size: 1.3rem; color: var(--understanding);">Credibility Rating:</span>
        <br />
        <strong style="color: ${total >= 0 ? 'var(--bar-green)' : 'var(--bar-red)'}; font-family: 'Playfair Display', serif; font-size: 1.6rem;">
          ${credibilityRating}
        </strong>
      </div>
    `;
    outputContainer.insertBefore(scoreHeader, table);

    const totalRow = document.createElement("tr");

    const tdTotalScore = document.createElement("td");
    tdTotalScore.className = "total-score";
    tdTotalScore.setAttribute("data-label", "Score");
    tdTotalScore.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center;">
        <strong style="color: #DDE3EA; font-family: 'Montserrat', sans-serif;">Total Score</strong>
        <span class="num-font" style="color: ${total >= 0 ? 'var(--bar-green)' : 'var(--bar-red)'}; font-weight: bold;">
          ${total >= 0 ? "+" : ""}${total.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
        </span>
      </div>
    `;

    const tdTotalComment = document.createElement("td");
    tdTotalComment.className = "total-score";
    tdTotalComment.setAttribute("data-label", "Explanation");
    tdTotalComment.innerHTML = `<span style="font-family: 'Montserrat', sans-serif; font-size: 1.035rem; color: var(--text-muted); line-height: 1.5;">${strategicInsight}</span>`;

    totalRow.appendChild(tdTotalScore);
    totalRow.appendChild(tdTotalComment);
    tbody.appendChild(totalRow);

    indicatorBar.className = "bar-indicator";
    indicatorBar.style.display = "none";
    totalCommentEl.innerHTML = "";

    outputContainer.style.display = "block";
  }
  async function validateTRUSubscriberEmail() {
  const emailInput = document.getElementById("truSubscriberEmail");
  const statusEl = document.getElementById("truSubscriberValidationStatus");
  const fieldsEl = document.getElementById("truProfileSubmissionFields");

  if (!emailInput || !statusEl || !fieldsEl) return;

  const subscriberEmail = emailInput.value.trim().toLowerCase();

  isTRUSubscriberValidated = false;
  syncTRUOwlAccessState();
  fieldsEl.style.display = "none";

  if (!subscriberEmail) {
    statusEl.textContent = "Enter the email used for your Stripe or paid Substack subscription.";
    return;
  }

  if (!subscriberEmail.includes("@") || !subscriberEmail.includes(".")) {
    statusEl.textContent = "Please enter a valid email address.";
    return;
  }

  if (!window.StrategicOwlAccess) {
    statusEl.textContent = "Owl Access could not load. Please refresh and try again.";
    return;
  }

  const accessButton = document.getElementById("owl-access-open");
  statusEl.textContent = "Checking Owl Access...";
  if (accessButton) accessButton.dataset.access = "loading";

  try {
    const response = await window.StrategicOwlAccess.validateEmail(subscriberEmail);

    if (response.valid !== true) {
      isTRUSubscriberValidated = false;
      syncTRUOwlAccessState();
      fieldsEl.style.display = "none";

      showTRUSubscriberValidationMessage(
        response.message ||
        response.error ||
        "No active Stripe or paid Substack subscription was found for that email.",
        true
      );
      return;
    }

    saveTRUSubscriberValidationCache(subscriberEmail);

    unlockTRUProfileSuggestionForm(
      response.message || "Owl Access confirmed. You can now suggest a profile."
    );
  } catch (error) {
    console.error("TRU subscriber validation request failed", error);
    statusEl.textContent = "Owl Access could not be checked. Please try again.";
  } finally {
    if (!isTRUSubscriberValidated && accessButton) {
      accessButton.dataset.access = "locked";
    }
  }
}

  function submitTRUProfileSuggestion() {
    const emailInput = document.getElementById("truSubscriberEmail");
const nameInput = document.getElementById("truSuggestedName");
const statusEl = document.getElementById("truSubmitStatus");

const subscriberEmail = emailInput.value.trim().toLowerCase();
const suggestedName = nameInput.value.trim();

if (!isTRUSubscriberValidated) {
  statusEl.textContent = "Please validate your paid subscriber email first.";
  return;
}

    if (!suggestedName) {
      statusEl.textContent = "Please enter a name or organization first.";
      return;
    }

    if (!TRU_SUBMISSION_WEB_APP_URL || TRU_SUBMISSION_WEB_APP_URL.includes("PASTE_YOUR")) {
      statusEl.textContent = "Submission URL has not been configured yet.";
      return;
    }

    const timestamp = createTRUSubmissionTimestamp();
    const submissionId = createTRUSubmissionId();
    const callbackName = `handleTRUSubmission_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const scriptEl = document.createElement("script");
    const params = new URLSearchParams({
  action: "submitProfile",
  timestamp,
  name: suggestedName,
  submissionId,
  subscriberEmail,
  callback: callbackName
});

    let didFinish = false;

    function cleanup() {
      didFinish = true;
      delete window[callbackName];
      if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    }

    window[callbackName] = function(response) {
      cleanup();

      if (!response || response.ok !== true) {
        console.error("TRU submission was not confirmed", response);
        statusEl.textContent = "Submission failed. Please try again.";
        return;
      }

      console.log("TRU submission confirmed", response);
      const confirmedSubmissionId = response.submissionId || submissionId;
      nameInput.value = "";
      statusEl.innerHTML = `
        <span class="tru-copy-id-wrap">
  <span>Submission received. TRU-ID:</span>
  <span class="tru-copy-id-code">${confirmedSubmissionId}</span>
  <button class="tru-copy-id-button" type="button" onclick="copyTRUSubmissionId('${confirmedSubmissionId}')">Copy ID</button>
  <span class="tru-review-note">Manual review required. Results usually appear within 1–24 hours.</span>
</span>
      `;
    };

    scriptEl.onerror = function(error) {
      cleanup();
      console.error("TRU submission request failed", error);
      statusEl.textContent = "Submission failed. Please try again.";
    };

    setTimeout(function() {
      if (!didFinish) {
        cleanup();
        statusEl.textContent = "Submission could not be confirmed. Please try again.";
      }
    }, 12000);

    console.log("TRU submission attempt", {
  url: `${TRU_SUBMISSION_WEB_APP_URL}?${params.toString()}`,
  action: "submitProfile",
  timestamp,
  name: suggestedName,
  submissionId,
  subscriberEmail
});

    statusEl.textContent = "Submitting...";
    scriptEl.src = `${TRU_SUBMISSION_WEB_APP_URL}?${params.toString()}`;
    document.body.appendChild(scriptEl);
  }

  function checkTRUSubmissionStatus() {
    const lookupInput = document.getElementById("truStatusLookupValue");
    const resultEl = document.getElementById("truStatusLookupResult");
    const lookupValue = lookupInput.value.trim();

    if (!lookupValue) {
      resultEl.textContent = "Please enter a name or TRU-ID first.";
      return;
    }

    if (!TRU_SUBMISSION_WEB_APP_URL || TRU_SUBMISSION_WEB_APP_URL.includes("PASTE_YOUR")) {
      resultEl.textContent = "Submission URL has not been configured yet.";
      return;
    }

    const callbackName = `handleTRUStatusLookup_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const scriptEl = document.createElement("script");
    const params = new URLSearchParams({
      action: "lookupStatus",
      query: lookupValue,
      callback: callbackName
    });

    let didFinish = false;

    function cleanup() {
      didFinish = true;
      delete window[callbackName];
      if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    }

    window[callbackName] = function(response) {
      cleanup();

      if (!response || response.ok !== true) {
        console.error("TRU status lookup was not confirmed", response);
        resultEl.textContent = response && response.error ? response.error : "Status lookup failed. Please try again.";
        return;
      }

      if (!response.found) {
        resultEl.textContent = "No submission found for that name or TRU-ID.";
        return;
      }

      const normalizedStatus = String(response.status || "").trim().toLowerCase();
      const statusNote = normalizedStatus === "out of scope"
        ? `<br /><span>${TRU_OUT_OF_SCOPE_MESSAGE}</span>`
        : "";

      resultEl.innerHTML = `
        <span>
          Status for <strong>${response.name || lookupValue}</strong>: <strong>${response.status}</strong>${statusNote}
        </span>
      `;
    };

    scriptEl.onerror = function(error) {
      cleanup();
      console.error("TRU status lookup request failed", error);
      resultEl.textContent = "Status lookup failed. Please try again.";
    };

    setTimeout(function() {
      if (!didFinish) {
        cleanup();
        resultEl.textContent = "Status lookup could not be confirmed. Please try again.";
      }
    }, 12000);

    console.log("TRU status lookup attempt", {
      url: `${TRU_SUBMISSION_WEB_APP_URL}?${params.toString()}`,
      query: lookupValue
    });

    resultEl.textContent = "Checking status...";
    scriptEl.src = `${TRU_SUBMISSION_WEB_APP_URL}?${params.toString()}`;
    document.body.appendChild(scriptEl);
  }

  async function copyTRUSubmissionId(submissionId) {
    const statusEl = document.getElementById("truSubmitStatus");

    try {
      await navigator.clipboard.writeText(submissionId);
      statusEl.querySelector(".tru-copy-id-button").textContent = "Copied";
    } catch (error) {
      console.error("TRU ID copy failed:", error);
      statusEl.querySelector(".tru-copy-id-button").textContent = "Copy failed";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    restoreTRUSubscriberValidationCache();
    syncTRUOwlAccessState();

    const accessOpenButton = document.getElementById("owl-access-open");
    const accessContinueButton = document.getElementById("truOwlAccessContinue");
    const modal = document.getElementById("truOwlAccessModal");

    if (accessOpenButton) accessOpenButton.addEventListener("click", openTRUOwlAccessModal);
    if (accessContinueButton) accessContinueButton.addEventListener("click", validateTRUOwlAccessFromModal);

    document.querySelectorAll("[data-tru-owl-close]").forEach(button => {
      button.addEventListener("click", closeTRUOwlAccessModal);
    });

    if (modal) {
      modal.addEventListener("click", event => {
        if (event.target === modal) closeTRUOwlAccessModal();
      });
    }

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && modal && !modal.hidden) closeTRUOwlAccessModal();
    });

    const data = await fetchTRUData();
    populateDropdowns(data);
    document.getElementById("role-filter").addEventListener("change", e => {
      updatePersonDropdown(e.target.value || "All");
      const outputContainer = document.getElementById("output-container");
      if (outputContainer) {
        outputContainer.style.display = "none";
      }
    });
    document.getElementById("person-select").addEventListener("change", showScores);

    const truProfileSearchInput = document.getElementById("truProfileSearchInput");
    const truProfileSearchResults = document.getElementById("truProfileSearchResults");

    if (truProfileSearchInput) {
      truProfileSearchInput.addEventListener("input", e => {
        updateTRUProfileSearch(e.target.value);
      });
    }

    if (truProfileSearchResults) {
      truProfileSearchResults.addEventListener("click", e => {
        const resultButton = e.target.closest(".tru-profile-search-result-item");
        if (!resultButton) return;

        const name = resultButton.getAttribute("data-name");
        const role = resultButton.getAttribute("data-role");
        loadTRUProfileSearchResult(name, role);
      });
    }
  });

  function toggleMenu() {
    document.getElementById("navMenu").classList.toggle("show");
  }

  // Close mobile nav menu when clicking outside
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

  // Modal popup logic for Scoring Logic
  function showPopup() {
    document.getElementById('role-box-wrapper').style.display = 'block';
    document.getElementById('modal-overlay').style.display = 'block';
  }

  function hidePopup() {
    document.getElementById('role-box-wrapper').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
  }

  document.getElementById('scoring-trigger').addEventListener('click', showPopup);

window.addEventListener("strategic-owl-access-change", (event) => {
  const active = Boolean(event.detail && event.detail.active);
  isTRUSubscriberValidated = active;
  syncTRUOwlAccessState();
  if (active) {
    const session = window.StrategicOwlAccess && window.StrategicOwlAccess.getSession();
    const emailInput = document.getElementById("truSubscriberEmail");
    if (emailInput && session && session.email) emailInput.value = session.email;
    unlockTRUProfileSuggestionForm("Owl Access is active.");
  } else {
    const fields = document.getElementById("truProfileSubmissionFields");
    const validationRow = document.getElementById("truSubscriberValidationRow");
    const title = document.getElementById("tru-name-submit-title");
    const description = document.getElementById("tru-name-submit-description");
    const status = document.getElementById("truSubscriberValidationStatus");
    if (fields) fields.style.display = "none";
    if (validationRow) validationRow.style.display = "flex";
    if (title) title.textContent = "Owl Access";
    if (description) description.textContent = "Validate the email used for Stripe or paid Substack to suggest a T.R.U. profile.";
    if (status) status.textContent = "Owl Access is signed out on this device.";
  }
});

