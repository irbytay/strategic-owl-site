(function () {
  "use strict";

  const HERITAGE_SHEET = "1p66gmWWjxJbrySxpR5T--fP8iEgUbW7RrXru61gagRA";
  const HERITAGE_RANGE = "HeritageVoterfraudRawData!B6:H";
  const HERITAGE_KEY = "AIzaSyB3NmN4OpDutbaX6V2KkLy1p-vDLghrF5M";
  const HISTORY_SHEET = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const HISTORY_RANGE = "History_Election_Data!B3:I";
  const SHARE_RANGE = "History_Election_Data!K3:P3";
  const HISTORY_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";

  const colors = {
    green: "#2fd47a",
    blue: "#4e7bff",
    gold: "#d4af37",
    muted: "#a7b3c1",
    navy: "#0d1b2a",
    red: "#df5252",
    gray: "#91a0b4",
  };

  const state = {
    heritage: [],
    history: [],
    share: null,
    startIndex: 0,
    endIndex: 0,
    selectedYear: null,
    fraudMode: "year",
  };

  const claims = [
    {
      claim: "A deceased person is still on the voter list.",
      documented: "A name on a voter list is not evidence that a ballot was cast.",
      proof: "HAVA requires one official statewide list, coordination with death records, and safeguards against removing eligible voters by mistake.",
      result: "An outdated registration means the list needs updating. Fraud requires evidence that someone used it to cast a ballot.",
    },
    {
      claim: "A noncitizen voted in the election.",
      documented: "Federal, state, and local elections do not all use the same eligibility rules.",
      proof: "Noncitizens cannot vote in federal elections. Some places extend a local vote to qualified noncitizen residents who live and pay taxes in that community.",
      result: "That is local representation where they live and pay taxes, not a vote for president. It does not create federal voting rights.",
    },
    {
      claim: "A voting machine changed votes.",
      documented: "Voting equipment, registration systems, and results websites are different systems.",
      proof: "HAVA created the federal standards process. VVSG 2.0 requires newly certified systems to be incapable of using wireless networks. HAVA requires an auditable permanent record.",
      result: "An election office being online does not prove its vote-counting system is online. Check the actual equipment, records, and audit.",
    },
    {
      claim: "The totals changed after election night.",
      documented: "Election-night totals are unofficial, not final results.",
      proof: "Eligible mail, provisional, military, overseas, and Election Day ballots continue through counting, reconciliation, and certification.",
      result: "The total is supposed to change as lawful ballots are added. Manipulation requires evidence that the final count is wrong.",
    },
    {
      claim: "A batch of ballots was counted twice.",
      documented: "Seeing the same stack move twice is not evidence that it entered the certified count twice.",
      proof: "Batch IDs, scanner records, voter totals, custody records, and the canvass must reconcile.",
      result: "The claim is proven by duplicate ballots in the count, not by a clip that merely looks suspicious.",
    },
    {
      claim: "Investigators confirmed unlawful votes.",
      documented: "A confirmed case proves that case. It does not automatically prove a statewide or national outcome.",
      proof: "The case record establishes what happened and how many votes were involved. Audits and certification establish the count.",
      result: "Do not dismiss confirmed fraud or multiply it beyond the evidence. Compare the proven votes with the certified margin.",
    },
  ];

  let claimIndex = -1;
  const byId = (id) => document.getElementById(id);
  const parseNumber = (value) => Number(String(value || "").replace(/[%,$,]/g, "").trim());
  const formatCount = (value) => new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value || 0)));
  const formatPercent = (value) => `${value.toFixed(2)}%`;

  function sheetUrl(id, range, key) {
    return `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?key=${key}`;
  }

  async function fetchValues(id, range, key) {
    const response = await fetch(sheetUrl(id, range, key));
    if (!response.ok) throw new Error("Election records could not be loaded.");
    const body = await response.json();
    return Array.isArray(body.values) ? body.values : [];
  }

  async function loadElectionData() {
    const status = byId("dashboard-status");
    status.hidden = false;
    status.className = "election-status";
    status.textContent = "Loading election records…";

    try {
      const [heritageRows, historyRows, shareRows] = await Promise.all([
        fetchValues(HERITAGE_SHEET, HERITAGE_RANGE, HERITAGE_KEY),
        fetchValues(HISTORY_SHEET, HISTORY_RANGE, HISTORY_KEY),
        fetchValues(HISTORY_SHEET, SHARE_RANGE, HISTORY_KEY),
      ]);

      state.heritage = heritageRows
        .filter((row) => row.length >= 3 && Number.isInteger(parseNumber(row[0])) && String(row[1] || "").trim() && String(row[2] || "").trim())
        .map((row) => ({
          year: parseNumber(row[0]),
          state: String(row[1]).trim().toUpperCase(),
          name: String(row[2]).trim(),
        }));

      state.history = historyRows
        .map((row) => ({
          year: parseNumber(row[0]),
          votingAgePopulation: parseNumber(row[1]),
          registeredVoters: parseNumber(row[2]),
          votesCast: parseNumber(row[3]),
          turnout: parseNumber(row[5]),
        }))
        .filter((row) => Number.isInteger(row.year) && row.votingAgePopulation > 0 && row.registeredVoters > 0 && row.votesCast > 0 && Number.isFinite(row.turnout))
        .sort((left, right) => left.year - right.year);

      const shareRow = shareRows[0];
      if (shareRow && shareRow.length >= 6) {
        state.share = {
          votingAgePopulation: parseNumber(shareRow[0]),
          totalVotesCast: parseNumber(shareRow[1]),
          trumpVotes: parseNumber(shareRow[2]),
          harrisVotes: parseNumber(shareRow[3]),
          otherVotes: parseNumber(shareRow[5]),
        };
        if (!(state.share.votingAgePopulation > 0)) state.share = null;
      }

      if (!state.history.length) throw new Error("No election history is available.");
      state.startIndex = 0;
      state.endIndex = state.history.length - 1;
      status.hidden = true;
      byId("election-dashboard").hidden = false;
      setupRangeControls();
      renderParticipationChart();
      renderNationalChart();
      renderFraudOverview();
      populateStates();
    } catch (error) {
      console.error("Election data failed to load", error);
      status.className = "election-status is-error";
      status.replaceChildren(document.createTextNode("Election records are temporarily unavailable."));
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try Again";
      retry.addEventListener("click", loadElectionData);
      status.appendChild(retry);
    }
  }

  function setupRangeControls() {
    const start = byId("range-start");
    const end = byId("range-end");
    [start, end].forEach((input) => {
      input.min = 0;
      input.max = state.history.length - 1;
      input.step = 1;
    });
    start.value = state.startIndex;
    end.value = state.endIndex;

    const update = (changed) => {
      let first = parseNumber(start.value);
      let last = parseNumber(end.value);
      if (first > last) {
        if (changed === start) last = first;
        else first = last;
      }
      state.startIndex = first;
      state.endIndex = last;
      start.value = first;
      end.value = last;
      byId("range-start-label").textContent = state.history[first].year;
      byId("range-end-label").textContent = state.history[last].year;
      if (state.selectedYear && !visibleHistory().some((row) => row.year === state.selectedYear)) state.selectedYear = null;
      renderParticipationChart();
    };

    start.addEventListener("input", () => update(start));
    end.addEventListener("input", () => update(end));
    update(start);
  }

  function visibleHistory() {
    return state.history.slice(state.startIndex, state.endIndex + 1);
  }

  function prepareCanvas(canvas) {
    const rectangle = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rectangle.width * ratio);
    canvas.height = Math.round(rectangle.height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rectangle.width, height: rectangle.height };
  }

  function renderParticipationChart() {
    const canvas = byId("participation-chart");
    if (!canvas || !state.history.length) return;
    const rows = visibleHistory();
    const { context, width, height } = prepareCanvas(canvas);
    const bounds = { left: 48, top: 14, right: width - 12, bottom: height - 30 };
    const plotWidth = bounds.right - bounds.left;
    const plotHeight = bounds.bottom - bounds.top;
    context.clearRect(0, 0, width, height);
    context.font = "12px Inter, sans-serif";
    context.textBaseline = "middle";

    [0, 50, 100].forEach((value) => {
      const y = bounds.bottom - (value / 100) * plotHeight;
      context.strokeStyle = "rgba(124,138,155,.28)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(bounds.left, y);
      context.lineTo(bounds.right, y);
      context.stroke();
      context.fillStyle = colors.muted;
      context.textAlign = "left";
      context.fillText(`${value}%`, 3, y);
    });

    const point = (index, value) => ({
      x: rows.length === 1 ? bounds.left + plotWidth / 2 : bounds.left + (index / (rows.length - 1)) * plotWidth,
      y: bounds.bottom - (value / 100) * plotHeight,
    });
    const series = [
      { color: colors.green, value: (row) => row.turnout },
      { color: colors.blue, value: (row) => 100 - row.turnout },
    ];

    series.forEach((item) => {
      context.beginPath();
      context.strokeStyle = item.color;
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      rows.forEach((row, index) => {
        const position = point(index, item.value(row));
        if (index === 0) context.moveTo(position.x, position.y);
        else context.lineTo(position.x, position.y);
      });
      context.stroke();

      rows.forEach((row, index) => {
        const position = point(index, item.value(row));
        if (row.year === state.selectedYear) {
          context.beginPath();
          context.fillStyle = colors.navy;
          context.arc(position.x, position.y, 8, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.strokeStyle = colors.gold;
          context.lineWidth = 3;
          context.arc(position.x, position.y, 7, 0, Math.PI * 2);
          context.stroke();
        }
        context.beginPath();
        context.fillStyle = item.color;
        context.arc(position.x, position.y, row.year === state.selectedYear ? 4 : 3, 0, Math.PI * 2);
        context.fill();
      });
    });

    context.fillStyle = colors.muted;
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    context.fillText(rows[0].year, bounds.left, height - 6);
    context.textAlign = "right";
    context.fillText(rows[rows.length - 1].year, bounds.right, height - 6);
    canvas.chartInfo = { rows, bounds, plotWidth };
    renderParticipationReadout();
  }

  function selectParticipationYear(event) {
    const canvas = event.currentTarget;
    const chart = canvas.chartInfo;
    if (!chart || !chart.rows.length) return;
    const rectangle = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(chart.plotWidth, event.clientX - rectangle.left - chart.bounds.left));
    const index = chart.rows.length === 1 ? 0 : Math.round((x / chart.plotWidth) * (chart.rows.length - 1));
    state.selectedYear = chart.rows[index].year;
    renderParticipationChart();
  }

  function renderParticipationReadout() {
    const row = state.history.find((item) => item.year === state.selectedYear);
    const hint = byId("participation-hint");
    const readout = byId("participation-readout");
    hint.hidden = Boolean(row);
    readout.hidden = !row;
    readout.replaceChildren();
    if (!row) return;

    [
      [row.year, "year"],
      [`Voted ${formatPercent(row.turnout)}`, "voted"],
      [`Did not ${formatPercent(100 - row.turnout)}`, "did-not-vote"],
    ].forEach(([text, className]) => {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      readout.appendChild(span);
    });
  }

  function renderNationalChart() {
    if (!state.share) return;
    const card = byId("national-card");
    card.hidden = false;
    const didNotVote = Math.max(0, state.share.votingAgePopulation - state.share.totalVotesCast);
    const entries = [
      { label: "Trump", value: state.share.trumpVotes, color: colors.red, noun: "votes" },
      { label: "Harris", value: state.share.harrisVotes, color: colors.blue, noun: "votes" },
      { label: "Other candidates", value: state.share.otherVotes, color: colors.green, noun: "votes" },
      { label: "Did not vote", value: didNotVote, color: colors.gray, noun: "people" },
    ];

    byId("population-total").textContent = formatCount(state.share.votingAgePopulation);
    const bar = byId("share-bar");
    const grid = byId("share-grid");
    bar.replaceChildren();
    grid.replaceChildren();

    entries.forEach((entry) => {
      const percentage = (entry.value / state.share.votingAgePopulation) * 100;
      const segment = document.createElement("div");
      segment.className = "share-segment";
      segment.style.background = entry.color;
      segment.style.width = `${percentage}%`;
      segment.title = `${entry.label}: ${formatPercent(percentage)}`;
      bar.appendChild(segment);

      const stat = document.createElement("div");
      stat.className = "share-stat";
      const percentageElement = document.createElement("span");
      percentageElement.className = "share-percent";
      percentageElement.style.color = entry.color;
      percentageElement.textContent = formatPercent(percentage);
      const label = document.createElement("span");
      label.className = "share-label";
      const dot = document.createElement("i");
      dot.className = "share-dot";
      dot.style.background = entry.color;
      label.append(dot, document.createTextNode(entry.label));
      const count = document.createElement("span");
      count.className = "share-count";
      count.textContent = `${formatCount(entry.value)} ${entry.noun}`;
      stat.append(percentageElement, label, count);
      grid.appendChild(stat);
    });
  }

  function renderFraudOverview() {
    byId("fraud-total").textContent = formatCount(state.heritage.length);
    const field = state.fraudMode === "year" ? "year" : "state";
    const counts = new Map();
    state.heritage.forEach((row) => counts.set(String(row[field]), (counts.get(String(row[field])) || 0) + 1));
    const rows = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))
      .slice(0, 6);
    const maximum = rows[0]?.[1] || 1;
    byId("fraud-bars-heading").textContent = `Most records by ${field}`;
    const bars = byId("fraud-bars");
    bars.replaceChildren();

    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "fraud-bar-row";
      const name = document.createElement("span");
      name.className = "fraud-bar-label";
      name.title = label;
      name.textContent = label;
      const track = document.createElement("span");
      track.className = "fraud-bar-track";
      const fill = document.createElement("span");
      fill.className = "fraud-bar-fill";
      fill.style.width = `${(value / maximum) * 100}%`;
      track.appendChild(fill);
      const amount = document.createElement("span");
      amount.className = "fraud-bar-value";
      amount.textContent = value;
      row.append(name, track, amount);
      bars.appendChild(row);
    });

    byId("fraud-by-year").classList.toggle("active", state.fraudMode === "year");
    byId("fraud-by-state").classList.toggle("active", state.fraudMode === "state");
  }

  function populateStates() {
    const select = byId("state-select");
    select.replaceChildren(new Option("Select a state", ""));
    [...new Set(state.heritage.map((row) => row.state))].sort().forEach((stateName) => {
      select.appendChild(new Option(stateName, stateName));
    });
  }

  function renderStateTable() {
    const selectedState = byId("state-select").value;
    const summary = byId("state-summary");
    const results = byId("state-results");
    const body = byId("state-data-body");
    body.replaceChildren();

    if (!selectedState) {
      summary.textContent = "";
      results.hidden = true;
      return;
    }

    const rows = state.heritage
      .filter((row) => row.state === selectedState)
      .sort((left, right) => left.year - right.year);
    if (!rows.length) {
      summary.textContent = `No documented records for ${selectedState}`;
      results.hidden = true;
      return;
    }

    summary.textContent = `${rows.length} case${rows.length === 1 ? "" : "s"} found from ${rows[0].year} to ${rows[rows.length - 1].year}`;
    rows.forEach((item) => {
      const row = document.createElement("tr");
      [item.year, item.state, item.name].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    results.hidden = false;
  }

  function showClaim(index) {
    claimIndex = index;
    byId("confidence-intro").hidden = true;
    byId("claim-panel").hidden = false;
    byId("claim-counter").textContent = `${index + 1} OF ${claims.length}`;
    byId("claim-title").textContent = claims[index].claim;
    byId("next-claim-label").textContent = index === claims.length - 1 ? "SEE THE LAW BEHIND THE CHECKS" : "NEXT CLAIM";

    const dots = byId("claim-dots");
    dots.replaceChildren();
    claims.forEach((_, dotIndex) => {
      const dot = document.createElement("i");
      dot.className = `claim-dot${dotIndex === index ? " active" : ""}`;
      dots.appendChild(dot);
    });

    const answers = byId("claim-answers");
    answers.replaceChildren();
    [
      ["What the claim leaves out", claims[index].documented],
      ["The rule", claims[index].proof],
      ["The bottom line", claims[index].result],
    ].forEach(([label, text]) => {
      const block = document.createElement("div");
      block.className = "claim-answer";
      const heading = document.createElement("strong");
      heading.textContent = label;
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      block.append(heading, paragraph);
      answers.appendChild(block);
    });
  }

  byId("participation-chart")?.addEventListener("pointerdown", selectParticipationYear);
  byId("fraud-by-year")?.addEventListener("click", () => {
    state.fraudMode = "year";
    renderFraudOverview();
  });
  byId("fraud-by-state")?.addEventListener("click", () => {
    state.fraudMode = "state";
    renderFraudOverview();
  });
  byId("state-select")?.addEventListener("change", renderStateTable);
  byId("start-claims")?.addEventListener("click", () => showClaim(0));
  byId("next-claim")?.addEventListener("click", () => {
    if (claimIndex < claims.length - 1) showClaim(claimIndex + 1);
    else byId("hava")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  window.addEventListener("resize", () => {
    if (state.history.length) renderParticipationChart();
  });

  loadElectionData();
})();
