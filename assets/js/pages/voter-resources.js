/* Behavior migrated from voterdash.html. */
  // --- CONFIG (yours, unchanged) ---
  const API_KEY  = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  // Tab: "State Elections", Range: A2:D51  (A = URL, B = State, C = Upcoming Election Date, D = Registration Deadline)
  const RAW_RANGE = "'State Elections'!A2:D51";
  const RANGE = encodeURIComponent(RAW_RANGE);
  const BIRTH_RANGE = encodeURIComponent("'Birth_Cert'!A1:C51");
let birthStateMap = {};

  // State -> { url, date } map
  let stateMetaMap = {};

  async function fetchStateLinks() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?ranges=${RANGE}&ranges=${BIRTH_RANGE}&key=${API_KEY}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const ranges = json.valueRanges || [];

      const voterRows = (ranges[0] && ranges[0].values) || [];
      const birthRows = (ranges[1] && ranges[1].values) || [];

      // --- voter registration map ---
      stateMetaMap = {};
      for (const row of voterRows) {
        const url = (row[0] || "").trim();
        const state = (row[1] || "").trim();
        const dateRaw = (row[2] || "").trim();
        const regRaw  = (row[3] || "").trim();
        if (state && url) stateMetaMap[state] = { url, date: dateRaw, regDeadline: regRaw };
      }

      // --- birth certificate map ---
      birthStateMap = {};
      for (const row of birthRows) {
        const state = (row[0] || "").trim();
        const url = (row[1] || "").trim();
        const enabled = (row[2] || "").toLowerCase();

        if (state && url && enabled === "true") {
          birthStateMap[state] = url;
        }
      }

      populateStateDropdown();
      populateBirthStateDropdown();
    } catch (e) {
      console.error("Failed to fetch State Elections data:", e);
    }
  }

  function populateStateDropdown() {
    const sel = document.getElementById("state-select");
    // Clear but keep placeholder
    sel.innerHTML = '<option value="">Select Your State:</option>';
    const states = Object.keys(stateMetaMap).sort((a, b) => a.localeCompare(b));
    for (const state of states) {
      const opt = document.createElement("option");
      opt.value = state;
      opt.textContent = state;
      sel.appendChild(opt);
    }
    sel.disabled = states.length === 0;
  }

  function populateBirthStateDropdown() {
    const sel = document.getElementById("birth-state-select");
    if (!sel) return;

    const states = Object.keys(birthStateMap).sort();

    for (const state of states) {
      const opt = document.createElement("option");
      opt.value = state;
      opt.textContent = state;
      sel.appendChild(opt);
    }
  }

  function handleStateChange(e) {
    const state = e.target.value;
    const meta = stateMetaMap[state];
    const link = meta && meta.url;
    const dateStr = meta && meta.date;
    const regStr  = meta && meta.regDeadline;

    const outWrap = document.getElementById("state-output");
    const urlInput = document.getElementById("state-url");
    const openA = document.getElementById("state-open");
    const dateEl = document.getElementById("state-date");
    const regEl  = document.getElementById("state-deadline");

    if (!state || !link) {
      outWrap.style.display = "none";
      urlInput.value = "";
      openA.href = "#";
      if (dateEl) { dateEl.innerHTML = ""; }
      if (regEl) { regEl.innerHTML = ""; }
      return;
    }

    // Show + update
    urlInput.value = link;
    openA.href = link;

    // Render date if available
    if (dateEl) {
      if (dateStr) {
        dateEl.innerHTML = `<span class="date-label">Primary Election:</span> <strong class="date-value">${formatDate(dateStr)}</strong>`;
      } else {
        dateEl.innerHTML = "";
      }
    }

    // Render registration deadline if available
    if (regEl) {
      regEl.innerHTML = regStr
        ? `<span class="date-label">Registration Deadline:</span> <strong class="date-value">${formatDate(regStr)}</strong>`
        : "";
    }

    outWrap.style.display = "block";

    // OPTIONAL: auto-open in a new tab on selection
    // window.open(link, "_blank", "noopener");
  }

  function handleBirthStateChange(e) {

    const state = e.target.value;
    const link = birthStateMap[state];

    const wrap = document.getElementById("birth-state-output");
    const url = document.getElementById("birth-state-url");
    const btn = document.getElementById("birth-state-open");

    if (!link) {
      wrap.style.display = "none";
      return;
    }

    url.value = link;
    btn.href = link;
    wrap.style.display = "block";
  }

  function formatDate(input) {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
      });
    }
    return input; // fallback if sheet already has human-readable text
  }

  // ============================================================
  // ========== NEW: ZIP → DISTRICT + CANDIDATES ================
  // ============================================================

  // Match the Flutter Voter Dashboard ranges exactly.
  // AO:AY contain the 11 researched candidate positions.
  const RANGE_ROSTER   = encodeURIComponent("'State Elections'!AH1:AY100000");
  const RANGE_ZIPMAP   = encodeURIComponent("'District2Zipcode'!A1:F46654");

  // State -> [{ position, name, district }]
  let stateRosterMap = {};
  let allCandidateRows = [];
  const candidateByKey = new Map();
  let rosterReady = false;
  let rosterLoadError = false;
  // ZIP -> [{ stateAbbr, districtNum }]
  let zipToSD = {};

  const POSITION_DEFINITIONS = [
    {
      topic: "Reproductive Rights",
      explicit: {
        "broad access": "Supports broad legal abortion access.",
        "access with limits": "Supports legal abortion access with limits.",
        "restrictions with exceptions": "Favors abortion restrictions with limited exceptions.",
        "broad restrictions": "Favors broad abortion restrictions."
      },
      support: "Supports abortion access.",
      limited: "Supports abortion access with limits.",
      mixed: "Has a mixed abortion record.",
      exceptions: "Favors abortion restrictions with limited exceptions.",
      oppose: "Favors broad abortion restrictions."
    },
    {
      topic: "Cannabis Reform",
      explicit: {
        "broad reform": "Supports broad cannabis reform.",
        "limited reform": "Supports limited cannabis reform.",
        "generally opposes reform": "Generally opposes cannabis reform.",
        "opposes reform": "Opposes cannabis reform."
      },
      support: "Supports cannabis reform.",
      limited: "Supports limited cannabis reform.",
      mixed: "Has a mixed cannabis record.",
      exceptions: "Opposes cannabis reform with limited exceptions.",
      oppose: "Opposes cannabis reform."
    },
    {
      topic: "Democracy & Elections",
      explicit: {
        "upholds safeguards": "Upholds certified results and democratic safeguards.",
        "upholds with concerns": "Generally upholds certified results while raising concerns about some election rules.",
        "challenges some safeguards": "Challenges some certified results or democratic safeguards.",
        "rejects or undermines safeguards": "Rejects certified results or undermines democratic safeguards."
      },
      support: "Supports certified results and voting access.",
      limited: "Accepts results with tighter voting rules.",
      mixed: "Has a mixed election record.",
      exceptions: "Challenges some results or safeguards.",
      oppose: "Rejects certified results or democratic safeguards."
    },
    {
      topic: "Gun Policy",
      explicit: {
        "stronger regulations": "Favors stronger firearm regulations.",
        "targeted regulations": "Favors targeted firearm regulations.",
        "generally fewer regulations": "Generally favors fewer firearm regulations with limited safeguards.",
        "fewer regulations": "Favors fewer firearm regulations and broader gun rights."
      },
      support: "Favors stronger gun safety laws.",
      limited: "Supports targeted gun restrictions.",
      mixed: "Balances gun rights with added safeguards.",
      exceptions: "Favors fewer restrictions with limited safeguards.",
      oppose: "Favors fewer gun restrictions."
    },
    {
      topic: "Climate & Environment",
      explicit: {
        "broad action": "Supports broad government climate action.",
        "limited action": "Supports limited government climate action.",
        "generally opposes action": "Generally opposes major government climate policies.",
        "opposes major action": "Opposes major government climate policies."
      },
      support: "Supports broad climate action.",
      limited: "Supports limited climate action.",
      mixed: "Has a mixed climate record.",
      exceptions: "Opposes major climate policies with limited exceptions.",
      oppose: "Opposes major climate policies."
    },
    {
      topic: "Education & Curriculum",
      explicit: {
        "opposes restrictions": "Generally opposes book and curriculum restrictions.",
        "supports limited restrictions": "Supports limited book or curriculum restrictions.",
        "supports targeted restrictions": "Supports targeted book or curriculum restrictions.",
        "supports broad restrictions": "Supports broad book or curriculum restrictions."
      },
      support: "Supports inclusive public education.",
      limited: "Supports it with some restrictions.",
      mixed: "Has a mixed education record.",
      exceptions: "Favors some book or curriculum restrictions.",
      oppose: "Favors broad book or curriculum restrictions."
    },
    {
      topic: "Healthcare Access",
      explicit: {
        "broad expansion": "Supports broad expansion of public healthcare access.",
        "limited expansion": "Supports limited expansion of public healthcare access.",
        "generally opposes expansion": "Generally opposes public healthcare expansion.",
        "opposes expansion": "Opposes public healthcare expansion."
      },
      support: "Supports expanding healthcare access.",
      limited: "Supports limited healthcare expansion.",
      mixed: "Has a mixed healthcare record.",
      exceptions: "Opposes expansion with limited exceptions.",
      oppose: "Opposes expanding public healthcare programs."
    },
    {
      topic: "Immigration & Border",
      explicit: {
        "pathways first": "Prioritizes legal pathways and immigration reform.",
        "pathways with enforcement": "Favors legal pathways alongside stronger enforcement.",
        "balanced or mixed": "Balances legal pathways with stronger enforcement.",
        "enforcement with limited pathways": "Prioritizes enforcement while allowing limited legal pathways.",
        "enforcement first": "Prioritizes immigration restrictions and enforcement."
      },
      support: "Supports legal pathways and immigration reform.",
      limited: "Supports legal pathways with tighter enforcement.",
      mixed: "Balances legal pathways with stricter enforcement.",
      exceptions: "Prioritizes enforcement with limited legal pathways.",
      oppose: "Prioritizes restrictions and enforcement."
    },
    {
      topic: "Civil & LGBTQ+ Rights",
      explicit: {
        "broad protections": "Supports broad civil and LGBTQ+ protections.",
        "protections with limits": "Supports civil and LGBTQ+ protections with limits.",
        "opposes some protections": "Opposes some civil or LGBTQ+ protections.",
        "opposes broad protections": "Opposes broad civil or LGBTQ+ protections."
      },
      support: "Supports broad civil and LGBTQ+ protections.",
      limited: "Supports civil protections with limits.",
      mixed: "Has a mixed civil-rights record.",
      exceptions: "Opposes some protections with limited exceptions.",
      oppose: "Opposes civil or LGBTQ+ protections."
    },
    {
      topic: "Economic Policy & Labor",
      explicit: {
        "stronger protections": "Supports stronger union and worker protections.",
        "limited additional protections": "Supports limited additional worker protections.",
        "generally fewer protections": "Generally favors fewer labor and worker protections.",
        "fewer protections": "Favors fewer labor and worker protections."
      },
      support: "Supports unions and worker protections.",
      limited: "Supports limited worker protections.",
      mixed: "Has a mixed labor record.",
      exceptions: "Favors fewer labor protections with exceptions.",
      oppose: "Favors fewer labor protections."
    },
    {
      topic: "Religion & Governance",
      explicit: {
        "strong separation": "Supports strong church-state separation.",
        "separation with accommodations": "Supports church-state separation with religious accommodations.",
        "larger religious role with limits": "Favors a larger religious role in government with limits.",
        "larger religious role": "Favors a larger religious role in government."
      },
      support: "Supports church-state separation.",
      limited: "Supports separation with limited religious exceptions.",
      mixed: "Has a mixed record on religion in government.",
      exceptions: "Favors a larger religious role with limits.",
      oppose: "Favors a larger religious role in government."
    }
  ];

  let pendingCandidateKey = null;

  function hasOwlAccess() {
    return Boolean(
      window.StrategicOwlAccess && window.StrategicOwlAccess.isActive()
    );
  }

  // Two-letter → full state name (to align C=abbr with AH=full)
  const STATE_ABBR_TO_NAME = {
    AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado",
    CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho",
    IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana",
    ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota",
    MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada",
    NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
    NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon",
    PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota",
    TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia",
    WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia",
  };

  // --- ZIP normalizer: strip non-digits, keep first 5, and left-pad with zeros ---
  function normalizeZipKey(z) {
    let s = String(z == null ? "" : z);
    s = s.replace(/\D/g, "");        // digits only
    if (s.length >= 5) s = s.slice(0, 5);
    return s.padStart(5, "0");       // e.g., "7040" -> "07040"
  }

  // Fetch roster + zip map (kept separate so your original fetch stays intact)
  async function fetchZipAndRoster() {
    rosterLoadError = false;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet` +
                `?ranges=${RANGE_ROSTER}&ranges=${RANGE_ZIPMAP}&key=${API_KEY}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const v = json.valueRanges || [];

      // 1) Roster (AH:AY)
      const rosterRows = (v[0] && v[0].values) || [];
      stateRosterMap = {};
      allCandidateRows = [];
      candidateByKey.clear();
      for (let i = 0; i < rosterRows.length; i++) {
        const r = rosterRows[i];
        const stFull   = (r[0] || "").trim(); // AH = full state name
        const position = (r[1] || "").trim(); // AI
        const name     = (r[2] || "").trim(); // AJ
        const district = (r[3] || "").trim(); // AK (e.g., "AZ-2", "AK-AtLarge")
        const aligned  = (r[4] || "").trim(); // AL = Trump Aligned (Yes/No)
        const impeach  = (r[5] || "").trim(); // AM = Willing to hold Trump accountable (Yes/No)
        const website  = (r[6] || "").trim(); // AN = Candidate website URL
        if (!stFull || /^state$/i.test(stFull)) continue; // skip header
        const candidate = {
          key: `${stFull}|${position}|${name}|${district}|${i}`,
          stateFullName: stFull,
          position,
          name,
          district,
          aligned,
          impeach,
          website,
          positionValues: Array.from({ length: 11 }, (_, positionIndex) =>
            String(r[positionIndex + 7] || "").trim()
          )
        };
        (stateRosterMap[stFull] ||= []).push(candidate);
        allCandidateRows.push(candidate);
        candidateByKey.set(candidate.key, candidate);
      }

      // 2) ZIP map (A:F) using C (abbr) + F (district number)
      const zipRows = (v[1] && v[1].values) || [];
      zipToSD = {};
      for (let i = 0; i < zipRows.length; i++) {
        const r = zipRows[i];
        const rawZip     = (r[0] ?? "").toString().trim(); // A (may be "7040" without leading zero)
        const stateAbbr  = (r[2] || "").trim();            // C = state abbr (AZ)
        const districtNo = (r[5] || "").trim();            // F = number (1..)
        const key        = normalizeZipKey(rawZip);        // "7040" -> "07040"
        if (!key || /^zip$/i.test(rawZip)) continue;       // skip header
        if (stateAbbr && districtNo) {
          (zipToSD[key] ||= []).push({ stateAbbr, districtNum: districtNo });
        }
      }
      rosterReady = true;
    } catch (err) {
      console.error("Failed to fetch roster/zip data:", err);
      rosterReady = false;
      rosterLoadError = true;
    }
  }

  // Simple, brand-friendly results
  function handleZipLookup() {
    const input = document.getElementById("zip-input");
    const out   = document.getElementById("zip-output");
    if (!input || !out) return;

    const raw = input.value;
    const key = normalizeZipKey(raw);   // handles "07040" vs "7040"
    if (!key.replace(/^0+/, "")) {      // effectively empty
      out.style.display = "none"; 
      out.innerHTML = ""; 
      return; 
    }

    const hits = zipToSD[key] || [];
    if (hits.length === 0) {
      const normalizedZip = normalizeZipKey(raw);
      const houseUrl = `https://ziplook.house.gov/htbin/findrep_house?ZIP=${encodeURIComponent(normalizedZip)}`;
      out.style.display = "";
      out.innerHTML = `<div class="ballot-empty">
        <strong>No ballot match found</strong>
        <span>We could not match ZIP ${escapeHtml(normalizedZip)}. Some ZIP codes cross district lines.</span>
        <a class="ballot-secondary-link" href="${houseUrl}" target="_blank" rel="noopener">Confirm My District on House.gov</a>
      </div>`;
      return;
    }

    // dedupe (stateAbbr|districtNum)
    const seen = new Set();
    const uniq = hits.filter(h => {
      const k = `${h.stateAbbr}|${h.districtNum}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    out.style.display = "";
    out.innerHTML = renderCombinedCard(key, uniq);
  }

  function renderList(title, rows, fmt) {
    if (!rows || rows.length === 0) {
      return `<section class="race-group">
        <h3>${escapeHtml(title)}</h3>
        <p class="race-empty">No race listed.</p>
      </section>`;
    }
    return `<section class="race-group">
      <h3>${escapeHtml(title)}</h3>
      <ul class="candidate-list">${rows.map(fmt).join("")}</ul>
    </section>`;
  }

  function isTrumpAligned(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  }

  function isImpeachFlag(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  }

  function usableWebsite(value) {
    const raw = String(value || "").trim();
    if (!raw || /^(n\/?a|none|null|not available)$/i.test(raw)) return "";
    try {
      const url = new URL(raw);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function normalizePositionValue(rawValue) {
    const raw = String(rawValue || "");
    const separatorIndex = raw.indexOf("||");
    const label = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw;
    return label.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }

  function positionExplanation(rawValue) {
    const raw = String(rawValue || "");
    const separatorIndex = raw.indexOf("||");
    return separatorIndex < 0
      ? ""
      : raw.slice(separatorIndex + 2).trim().replace(/\s+/g, " ");
  }

  function positionLanguage(rawValue, definition) {
    const value = normalizePositionValue(rawValue);
    if (!value || value === "unclear" || value.startsWith("#")) return "";

    let overview = definition.explicit[value] || "";
    if (!overview && ["support", "yes", "y", "true", "1"].includes(value)) {
      overview = definition.support;
    } else if (!overview && ["support with limits", "limited support", "conditional support"].includes(value)) {
      overview = definition.limited;
    } else if (!overview && value === "mixed") {
      overview = definition.mixed;
    } else if (!overview && ["oppose with exceptions", "opposition with exceptions", "conditional opposition"].includes(value)) {
      overview = definition.exceptions;
    } else if (!overview && ["oppose", "no", "n", "false", "0"].includes(value)) {
      overview = definition.oppose;
    }

    if (!overview) return "";
    const explanation = positionExplanation(rawValue);
    return explanation ? `${overview} ${explanation}` : overview;
  }

  function buildPositionSummaries(candidate) {
    const values = Array.isArray(candidate.positionValues) ? candidate.positionValues : [];
    return POSITION_DEFINITIONS.map((definition, index) => ({
      topic: definition.topic,
      summary: positionLanguage(values[index], definition)
    })).filter(position => position.summary);
  }

  function hasPositionResearch(candidate) {
    return buildPositionSummaries(candidate).length > 0;
  }

  function liCandidate(c) {
    const candidateMeta = [c.position, c.district].filter(Boolean).map(escapeHtml).join(" · ");
    const websiteUrl = usableWebsite(c.website);

    const trumpBadge = isTrumpAligned(c.aligned)
      ? `<span class="candidate-badge trump" title="Trump-backed">TRUMP-BACKED</span>`
      : "";

    const impeachBadge = isImpeachFlag(c.impeach)
      ? `<span class="candidate-badge impeach" title="Pro-impeachment">PRO-IMPEACH</span>`
      : "";

    const site = websiteUrl
      ? `<a class="candidate-site" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">Website <span aria-hidden="true">↗</span></a>`
      : "";

    const positions = c.key && hasPositionResearch(c)
      ? `<button class="owl-position-button" type="button" data-candidate-key="${escapeHtml(c.key)}" data-unlocked="${hasOwlAccess()}">
          <span class="position-button-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="10" width="14" height="10" rx="3"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg></span>
          <span>Positions</span>
        </button>`
      : "";

    return `<li class="candidate-row">
      <div class="candidate-details">
        <div class="candidate-name-line"><strong>${escapeHtml(c.name)}</strong><span class="candidate-badges">${trumpBadge}${impeachBadge}</span></div>
        ${candidateMeta ? `<span class="candidate-office">${candidateMeta}</span>` : ""}
      </div>
      <div class="candidate-row-actions">${site}${positions}</div>
    </li>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function candidateBadges(candidate) {
    return [
      isTrumpAligned(candidate.aligned)
        ? '<span class="candidate-badge trump" title="Trump-backed">TRUMP-BACKED</span>'
        : '',
      isImpeachFlag(candidate.impeach)
        ? '<span class="candidate-badge impeach" title="Pro-impeachment">PRO-IMPEACH</span>'
        : ''
    ].join('');
  }

  function renderCandidateCard(candidate) {
    const location = [candidate.stateFullName, candidate.district].filter(Boolean).join(' • ');
    const websiteUrl = usableWebsite(candidate.website);
    const website = websiteUrl
      ? `<a class="candidate-site-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">Website <span aria-hidden="true">↗</span></a>`
      : '<span class="candidate-site-unavailable">Website not listed</span>';

    return `
      <article class="candidate-card">
        <h3>${escapeHtml(candidate.name || 'Unnamed candidate')}</h3>
        <div class="candidate-card-meta">${escapeHtml(candidate.position || 'Office not listed')}${location ? ` • ${escapeHtml(location)}` : ''}</div>
        <div>${candidateBadges(candidate)}</div>
        <div class="candidate-card-actions">
          ${website}
          ${hasPositionResearch(candidate) ? `<button class="owl-position-button" type="button" data-candidate-key="${escapeHtml(candidate.key)}" data-unlocked="${hasOwlAccess()}">
            <span class="position-button-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="10" width="14" height="10" rx="3"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg></span>
            <span>Positions</span>
          </button>` : ""}
        </div>
      </article>`;
  }

  function handleCandidateSearch() {
    const input = document.getElementById('candidate-name-input');
    const status = document.getElementById('candidate-search-status');
    const results = document.getElementById('candidate-name-results');
    if (!input || !status || !results) return;

    const query = input.value.trim().toLocaleLowerCase();
    results.innerHTML = '';

    if (query.length < 2) {
      status.textContent = 'Enter at least two letters of a candidate’s name.';
      return;
    }
    if (!rosterReady) {
      status.textContent = rosterLoadError
        ? 'Candidate data could not be loaded. Please refresh the page and try again.'
        : 'Candidate data is still loading. Please try again in a moment.';
      return;
    }

    const matches = allCandidateRows
      .filter(candidate => String(candidate.name || '').toLocaleLowerCase().includes(query))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    if (!matches.length) {
      status.textContent = `No candidates found for “${input.value.trim()}.”`;
      return;
    }

    const visibleMatches = matches.slice(0, 40);
    status.textContent = matches.length > visibleMatches.length
      ? `${matches.length} candidates found. Showing the first ${visibleMatches.length}.`
      : `${matches.length} candidate${matches.length === 1 ? '' : 's'} found.`;
    results.innerHTML = visibleMatches.map(renderCandidateCard).join('');
  }

  function openOwlModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('owl-modal-open');
    const focusTarget = modal.querySelector('input, button, a');
    if (focusTarget) focusTarget.focus();
  }

  function closeOwlModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (!document.querySelector('.owl-modal:not([hidden])')) {
      document.body.classList.remove('owl-modal-open');
    }
  }

  function updateOwlAccessState() {
    const accessButton = document.getElementById('owl-access-open');
    const accessActive = hasOwlAccess();

    if (accessButton) {
      accessButton.dataset.access = accessActive ? 'active' : 'locked';
    }
    document.querySelectorAll('.owl-position-button').forEach(button => {
      button.dataset.unlocked = String(accessActive);
    });
  }

  function openCandidatePositions(candidateKey) {
    const candidate = candidateByKey.get(candidateKey);
    if (!candidate) return;

    const positions = buildPositionSummaries(candidate);
    if (!positions.length) return;

    if (!hasOwlAccess()) {
      pendingCandidateKey = candidateKey;
      if (window.StrategicOwlAccess) window.StrategicOwlAccess.open();
      return;
    }

    const heading = document.getElementById('owl-positions-title');
    const title = document.getElementById('owl-positions-candidate');
    const grid = document.getElementById('owl-topic-grid');
    const candidateName = String(candidate.name || '')
      .replace(/^\([^)]+\)\s*/, '')
      .trim();
    if (heading) heading.textContent = `${candidateName} on the Issues`;
    if (title) {
      title.textContent = [candidate.position, candidate.stateFullName, candidate.district]
        .filter(Boolean)
        .join(' • ');
    }
    if (grid) {
      grid.innerHTML = positions.map(position => `
        <section class="owl-topic-row">
          <h3>${escapeHtml(position.topic)}</h3>
          <p>${escapeHtml(position.summary)}</p>
        </section>`).join('');
    }
    openOwlModal('owl-positions-modal');
  }

  // ---------- NEW HELPERS FOR CONSOLIDATED CARD ----------
  function sortByFirstName(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  }

  function candidateIsInAnyDistrict(candidateDistrict, hits) {
    if (!candidateDistrict) return false;
    const cd = String(candidateDistrict).trim().toUpperCase();
    for (const h of hits) {
      const ab = String(h.stateAbbr || "").toUpperCase();
      const dn = String(h.districtNum || "").trim();
      if (!ab || !dn) continue;
      const target = `${ab}-${dn}`;
      if (cd === target || cd.endsWith(`-${dn}`)) return true;
      if (dn === "1" && cd === `${ab}-ATLARGE`) return true; // handle AtLarge mapped to "1"
    }
    return false;
  }

  function renderCombinedCard(zip, hits) {
    // assume all hits are same state; take first for state lookup
    const first = hits[0] || {};
    const abbr = (first.stateAbbr || "").toUpperCase();
    const full = STATE_ABBR_TO_NAME[abbr] || abbr;

    const roster = stateRosterMap[full] || [];
    const meta   = stateMetaMap[full] || {};
    const registrationUrl = usableWebsite(meta.url);
    const houseUrl = `https://ziplook.house.gov/htbin/findrep_house?ZIP=${encodeURIComponent(zip)}`;
    const primaryText = meta.date
  ? `Primary: <span class="primary-date">${formatDate(meta.date)}</span>`
  : "";

const deadlineText = meta.regDeadline
  ? `Registration Deadline: <span class="deadline-badge">${formatDate(meta.regDeadline)}</span>`
  : "";
  
const statusLine = [primaryText, deadlineText].filter(Boolean).join(" • ");

    // district string like "3, 4, 6"
    const districtNums = [...new Set(hits.map(h => String(h.districtNum).trim()))].filter(Boolean);
    const districtsStr = districtNums.join(", ");

    // collect candidates
    const house = roster
      .filter(r => /U\.?S\.?\s*House/i.test(r.position) && candidateIsInAnyDistrict(r.district, hits))
      .sort(sortByFirstName);
    const senate = roster
      .filter(r => /U\.?S\.?\s*Senate/i.test(r.position))
      .sort(sortByFirstName);
    const governor = roster
      .filter(r => /Governor/i.test(r.position))
      .sort(sortByFirstName);

    return `
      <article class="ballot-result-card">
        <header class="ballot-result-header">
          <p class="ballot-result-eyebrow">Ballot area</p>
          <h3>ZIP ${escapeHtml(zip)}</h3>
          <p>${escapeHtml(full)} · District${districtNums.length > 1 ? "s" : ""} ${escapeHtml(districtsStr)}</p>
          ${statusLine ? `<div class="ballot-status-line">${statusLine}</div>` : ""}
        </header>
        ${renderList("U.S. House Race", house, (c)=> liCandidate(c))}
        ${renderList("U.S. Senate Race",  senate,  (c)=> liCandidate(c))}
        ${renderList("Governor's Race",     governor,(c)=> liCandidate(c))}
        <div class="ballot-register-row">
          ${registrationUrl ? `<a class="ballot-register-link" href="${escapeHtml(registrationUrl)}" target="_blank" rel="noopener">Register to Vote in ${escapeHtml(full)}</a>` : ""}
          <a class="ballot-secondary-link" href="${houseUrl}" target="_blank" rel="noopener">Confirm My District on House.gov</a>
        </div>
      </article>
    `;
  }

  // --- INIT (kept your calls; added our fetch + listeners) ---
document.addEventListener("DOMContentLoaded", () => {
  // Yours:
  fetchStateLinks();
  const stateSel = document.getElementById("state-select");
  if (stateSel) stateSel.addEventListener("change", handleStateChange);

  const birthSel = document.getElementById("birth-state-select");
  if (birthSel) birthSel.addEventListener("change", handleBirthStateChange);

  // New:
  fetchZipAndRoster();

  const zipBtn = document.getElementById("zip-go");
  const zipInput = document.getElementById("zip-input");

  if (zipBtn) zipBtn.addEventListener("click", handleZipLookup);
  if (zipInput) {
    zipInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleZipLookup();
    });
  }
  const candidateSearchButton = document.getElementById('candidate-name-go');
  const candidateSearchInput = document.getElementById('candidate-name-input');
  if (candidateSearchButton) candidateSearchButton.addEventListener('click', handleCandidateSearch);
  if (candidateSearchInput) {
    candidateSearchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') handleCandidateSearch();
    });
  }

  document.addEventListener('click', event => {
    const positionButton = event.target.closest('.owl-position-button');
    if (positionButton) {
      openCandidatePositions(positionButton.dataset.candidateKey || '');
      return;
    }

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      closeOwlModal(closeButton.closest('.owl-modal'));
      return;
    }

    if (event.target.classList && event.target.classList.contains('owl-modal')) {
      closeOwlModal(event.target);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.owl-modal:not([hidden])').forEach(closeOwlModal);
  });

  window.addEventListener('strategic-owl-access-change', event => {
    updateOwlAccessState();

    if (event.detail && event.detail.active && pendingCandidateKey) {
      const candidateKey = pendingCandidateKey;
      pendingCandidateKey = null;
      openCandidatePositions(candidateKey);
    }
  });

  updateOwlAccessState();
});
