(function () {
  "use strict";

  const DATA = Object.freeze({
    constitution: "assets/data/constitution-content.json",
    civicDocuments: "assets/data/civic-documents.json",
    courtCases: "assets/data/supreme-court-cases.json"
  });
  const AUDIO_BASE = "https://ocymwifndxkzzqyiavuf.supabase.co/storage/v1/object/public/civic-owl-audio";
  const AUDIO_PROGRESS_KEY = "strategicOwlLibraryAudioProgress";
  const AUDIO_AVAILABLE_KEY = "strategicOwlPublishedLibraryAudio";
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII"];

  let catalogPromise = null;
  let catalog = [];
  let entries = [];
  let currentCollection = null;
  let currentDocument = null;
  let currentEntry = null;
  let initializedMain = null;
  let audio = null;
  let audioFilename = "";
  let audioSaveSecond = -1;
  const availability = new Map();

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function normalize(value) {
    return String(value || "").toLowerCase().normalize("NFKD")
      .replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function identifier(entry) {
    return `${entry.documentPart}|${entry.section}`;
  }

  function amendmentNumber(entry) {
    return Number.parseInt(String(entry.documentPart).match(/^\d+/)?.[0] || "0", 10);
  }

  function resolvedAudioFilename(entry) {
    if (entry.audioFilename) return entry.audioFilename;
    if (/^Article (I|II|III|IV|V|VI|VII)$/.test(entry.documentPart)) {
      return `CivicOwl-Article${entry.documentPart.replace("Article ", "")}Conversation-Aoede-Charon-v1.mp3`;
    }
    const amendment = amendmentNumber(entry);
    if (amendment > 0 && amendment < ROMAN.length) {
      return `CivicOwl-Amendment${ROMAN[amendment]}Conversation-Aoede-Charon-v1.mp3`;
    }
    return "";
  }

  function audioCandidates(entry, directOnly = false) {
    const federalist = entry.documentPart === "The Federalist Papers"
      ? Number.parseInt(entry.section.replace("Federalist No. ", ""), 10)
      : 0;
    if (federalist) {
      return [
        { title: "Full reading", subtitle: "The complete original text", filename: `CivicOwl-Federalist${federalist}-Charon-v1.mp3` },
        { title: "Civic Owl conversation", subtitle: "Context, history, and why it matters", filename: `CivicOwl-Federalist${federalist}Conversation-Aoede-Charon-v1.mp3` }
      ];
    }
    const filename = directOnly ? (entry.audioFilename || "") : resolvedAudioFilename(entry);
    return filename ? [{
      title: filename.includes("Aoede-Charon") ? "Civic Owl conversation" : "Full reading",
      subtitle: filename.includes("Aoede-Charon") ? "Context, history, and why it matters" : "The complete original text",
      filename
    }] : [];
  }

  function isFreeAudio(entry) {
    return entry.section === "Overview" || entry.documentPart === "Declaration of Independence";
  }

  async function loadCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = Promise.all([
      fetch(DATA.constitution).then(checkResponse).then((response) => response.json()),
      fetch(DATA.civicDocuments).then(checkResponse).then((response) => response.json()),
      fetch(DATA.courtCases).then(checkResponse).then((response) => response.json())
    ]).then(([constitution, civicDocuments, courtCases]) => {
      const constitutionEntries = constitution.entries.map((entry) => ({ ...entry }));
      const civicEntries = civicDocuments.documents.map((document) => ({
        documentPart: "American Civic Documents",
        section: document.title,
        fullText: document.fullText,
        summary: document.whyItMatters,
        prompt: document.historicalContext,
        author: document.author,
        publication: document.documentType,
        historicalDate: document.date,
        sourceURL: document.sourceURL,
        audioFilename: document.audioFilename || `CivicOwl-CivicDocument-${document.id}-Charon-v1.mp3`,
        group: document.collections?.[0] || "Civic record",
        pulse: document.pulse
      }));
      const courtEntries = courtCases.cases.map((courtCase) => ({
        documentPart: "Supreme Court",
        section: `${courtCase.name} (${courtCase.year})`,
        fullText: [
          courtCase.facts ? `Background\n\n${courtCase.facts}` : "",
          `Constitutional question\n\n${courtCase.legalQuestion}`,
          `The Court's holding\n\n${courtCase.holding}`,
          `Why it matters\n\n${courtCase.significance}`
        ].filter(Boolean).join("\n\n"),
        summary: courtCase.significance,
        prompt: `${courtCase.area} · ${courtCase.status}\n\nConstitutional connection: ${courtCase.constitution}`,
        author: "Supreme Court of the United States",
        publication: courtCase.citation,
        historicalDate: String(courtCase.year),
        sourceURL: courtCase.sourceURL,
        audioFilename: `CivicOwl-SupremeCourt-${courtCase.id}-Charon-v1.mp3`,
        group: courtCase.area,
        status: courtCase.status,
        pulse: courtCase.pulse
      }));

      entries = [...constitutionEntries, ...civicEntries, ...courtEntries];
      const amendments = entries.filter((entry) => / Amendment$/.test(entry.documentPart));
      const declaration = entries.filter((entry) => entry.documentPart === "Declaration of Independence");
      catalog = [
        collection("constitution", "The Constitution", "Preamble and Articles I through VII", "We the People of the United States...", entries.filter((entry) => entry.documentPart === "Preamble" || entry.documentPart.startsWith("Article ")), "CivicOwl-ConstitutionConversation-Aoede-Charon-v1.mp3", "▥"),
        collection("rights", "The Bill of Rights", "The first ten amendments", "Explore your fundamental protections", amendments.filter((entry) => amendmentNumber(entry) >= 1 && amendmentNumber(entry) <= 10), "CivicOwl-BillOfRightsConversation-Aoede-Charon-v1.mp3", "✓"),
        collection("later", "Later Amendments", "Amendments XI through XXVII", "Citizenship, voting, government, and presidential rules", amendments.filter((entry) => amendmentNumber(entry) >= 11), "CivicOwl-LaterAmendmentsConversation-Aoede-Charon-v1.mp3", "§", [
          featured("The Early Republic", "Amendments XI-XII", "CivicOwl-LaterAmendments-EarlyRepublicConversation-Aoede-Charon-v1.mp3"),
          featured("Reconstruction", "Amendments XIII-XV", "CivicOwl-LaterAmendments-ReconstructionConversation-Aoede-Charon-v1.mp3"),
          featured("A Changing Nation", "Amendments XVI-XIX and XXI", "CivicOwl-LaterAmendments-ChangingNationConversation-Aoede-Charon-v1.mp3"),
          featured("Modern Government", "Amendments XX, XXII, XXV, and XXVII", "CivicOwl-LaterAmendments-ModernGovernmentConversation-Aoede-Charon-v1.mp3"),
          featured("Voting", "Amendments XXIII, XXIV, and XXVI", "CivicOwl-LaterAmendments-VotingConversation-Aoede-Charon-v1.mp3")
        ]),
        collection("declaration", "Declaration of Independence", "A founding document", "The argument for independence that preceded the Constitution", declaration, declaration[0]?.audioFilename || "CivicOwl-DeclarationConversation-Aoede-Charon-v1.mp3", "✦"),
        collection("federalist", "The Federalist Papers", "85 essays by Hamilton, Madison, and Jay", "The arguments made for ratification", entries.filter((entry) => entry.documentPart === "The Federalist Papers"), "CivicOwl-FederalistPapersConversation-Aoede-Charon-v1.mp3", "¶"),
        collection("court", "Supreme Court", "100 landmark decisions", "Cases, precedent, and constitutional meaning", courtEntries, "CivicOwl-SupremeCourtConversation-Aoede-Charon-v1.mp3", "⚖"),
        collection("documents", "American Civic Documents", "24 speeches, laws, and public arguments", "The broader American civic record", civicEntries, "CivicOwl-AmericanCivicDocumentsConversation-Aoede-Charon-v1.mp3", "◇")
      ];
      return catalog;
    });
    return catalogPromise;
  }

  function checkResponse(response) {
    if (!response.ok) throw new Error(`Library data returned ${response.status}.`);
    return response;
  }

  function collection(id, title, subtitle, excerpt, collectionEntries, overviewAudio, symbol, featuredAudio = []) {
    return {
      id, title, subtitle, excerpt, entries: collectionEntries, symbol, featuredAudio,
      overview: { documentPart: title, section: "Overview", fullText: "", summary: `A broad Civic Owl conversation about ${title}.`, prompt: "", audioFilename: overviewAudio }
    };
  }

  function featured(documentPart, section, audioFilename) {
    return { documentPart, section, fullText: "", summary: `A Civic Owl conversation about ${section}.`, prompt: "", audioFilename };
  }

  function groupedEntries(collectionValue) {
    const groups = new Map();
    collectionValue.entries.forEach((entry) => {
      const key = collectionValue.id === "court" || collectionValue.id === "documents"
        ? (entry.group || "More") : entry.documentPart;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return [...groups.entries()];
  }

  function pageElements() {
    return {
      main: document.querySelector(".library-page"),
      shell: document.querySelector(".library-shell"),
      content: document.getElementById("library-content"),
      breadcrumbs: document.getElementById("library-breadcrumbs"),
      search: document.getElementById("library-search-input")
    };
  }

  async function initialize() {
    const elements = pageElements();
    if (!elements.main || initializedMain === elements.main) return;
    initializedMain = elements.main;
    currentCollection = null;
    currentDocument = null;
    currentEntry = null;
    installPlayer();
    elements.search?.addEventListener("input", () => renderSearch(elements.search.value));
    elements.content?.addEventListener("click", handleContentClick);
    elements.breadcrumbs?.addEventListener("click", handleContentClick);
    try {
      await loadCatalog();
      elements.shell?.setAttribute("aria-busy", "false");
      openFromURL();
    } catch (error) {
      console.error(error);
      if (elements.content) elements.content.innerHTML = errorCard("The Library could not open", "The document catalog is temporarily unavailable. Please try again.");
      elements.shell?.setAttribute("aria-busy", "false");
    }
  }

  function renderLibrary() {
    currentCollection = null;
    currentDocument = null;
    currentEntry = null;
    setBreadcrumbs([]);
    const { content, search } = pageElements();
    if (search) search.value = "";
    content.innerHTML = `
      <div class="library-section-heading"><span>FOUNDING DOCUMENTS</span><h2>Read, listen, and explore</h2></div>
      <div class="library-collection-grid">
        ${catalog.map((item) => `
          <button class="library-gateway" type="button" data-open-collection="${escapeHTML(item.id)}">
            <span class="library-gateway__symbol" aria-hidden="true">${item.symbol}</span>
            <span class="library-gateway__copy">
              <strong>${escapeHTML(item.title)}</strong>
              <span>${escapeHTML(item.subtitle)}</span>
              <em>${escapeHTML(item.excerpt)}</em>
            </span>
            <span class="library-audio-indicator" data-audio-check="${escapeHTML(item.overview.audioFilename)}" aria-label="Audio available"></span>
            <span class="library-gateway__arrow" aria-hidden="true">›</span>
          </button>`).join("")}
      </div>`;
    hydrateAudioIndicators();
    updateURL({});
  }

  function renderCollection(collectionValue) {
    currentCollection = collectionValue;
    currentDocument = null;
    currentEntry = null;
    setBreadcrumbs([{ label: "Library", action: "library" }, { label: collectionValue.title }]);
    const groups = groupedEntries(collectionValue);
    pageElements().content.innerHTML = `
      <div class="library-collection-header">
        <span>${escapeHTML(collectionValue.subtitle)}</span>
        <h2>${escapeHTML(collectionValue.title)}</h2>
        <p>${escapeHTML(collectionValue.excerpt)}</p>
      </div>
      ${audioCard(collectionValue.overview, true)}
      ${collectionValue.featuredAudio.length ? `
        <section class="library-featured-audio">
          <div class="library-section-heading"><span>LISTEN BY ERA</span><h3>Conversations in this collection</h3></div>
          <div class="library-featured-audio__grid">${collectionValue.featuredAudio.map((entry) => audioCard(entry, false)).join("")}</div>
        </section>` : ""}
      <div class="library-section-heading library-section-heading--documents"><span>ORIGINAL TEXT</span><h3>${collectionValue.id === "court" ? "Explore the cases" : "Choose a document"}</h3></div>
      <div class="library-document-list">
        ${groups.map(([name, groupEntries]) => documentRow(collectionValue, name, groupEntries)).join("")}
      </div>`;
    hydrateAudioIndicators();
    updateURL({ collection: collectionValue.id });
  }

  function documentRow(collectionValue, name, groupEntries) {
    const first = groupEntries[0];
    const single = groupEntries.length === 1;
    const label = single && ["federalist", "court", "documents"].includes(collectionValue.id) ? first.section : name;
    const summary = first.summary || first.pulse?.fact || "Open the original text.";
    const parentAudio = single ? audioCandidates(first, true)[0]?.filename : audioCandidates(first)[0]?.filename;
    return `
      <button class="library-document-row" type="button" data-open-document="${escapeHTML(name)}" data-single-entry="${single ? escapeHTML(identifier(first)) : ""}">
        <span>
          <strong>${escapeHTML(label)}</strong>
          <small>${escapeHTML(summary)}</small>
        </span>
        ${parentAudio ? `<span class="library-audio-indicator" data-audio-check="${escapeHTML(parentAudio)}" aria-label="Audio available"></span>` : ""}
        <b aria-hidden="true">›</b>
      </button>`;
  }

  function renderDocument(documentPart) {
    if (!currentCollection) return;
    const documentEntries = currentCollection.entries.filter((entry) => {
      if (currentCollection.id === "court" || currentCollection.id === "documents") return (entry.group || "More") === documentPart;
      return entry.documentPart === documentPart;
    });
    if (!documentEntries.length) return;
    currentDocument = documentPart;
    currentEntry = null;
    setBreadcrumbs([
      { label: "Library", action: "library" },
      { label: currentCollection.title, action: "collection" },
      { label: documentPart }
    ]);
    const first = documentEntries[0];
    const parentAudio = !["court", "documents"].includes(currentCollection.id) ? audioCandidates(first)[0] : null;
    pageElements().content.innerHTML = `
      <div class="library-document-header">
        <span>${escapeHTML(currentCollection.title)}</span>
        <h2>${escapeHTML(documentPart)}</h2>
        <p>${escapeHTML(first.summary || first.pulse?.fact || "Read the original text and its civic context.")}</p>
      </div>
      ${parentAudio ? audioCard({ ...first, section: documentPart, audioFilename: parentAudio.filename }, false) : ""}
      <div class="library-entry-list">
        ${documentEntries.map((entry) => entryRow(entry)).join("")}
      </div>`;
    hydrateAudioIndicators();
    updateURL({ collection: currentCollection.id, document: documentPart });
  }

  function entryRow(entry) {
    const directAudio = audioCandidates(entry, true)[0]?.filename;
    return `
      <button class="library-entry-row" type="button" data-open-entry="${escapeHTML(identifier(entry))}">
        <span>
          <strong>${escapeHTML(entry.section === "Provision" ? entry.documentPart : entry.section)}</strong>
          <small>${escapeHTML(entry.summary || entry.pulse?.fact || "Open the original text.")}</small>
        </span>
        ${directAudio ? `<span class="library-audio-indicator" data-audio-check="${escapeHTML(directAudio)}" aria-label="Audio available"></span>` : ""}
        <b aria-hidden="true">›</b>
      </button>`;
  }

  function renderEntry(entry) {
    currentEntry = entry;
    if (!currentCollection) currentCollection = catalog.find((item) => item.entries.includes(entry));
    const documentLabel = currentCollection.id === "court" || currentCollection.id === "documents" ? (entry.group || currentCollection.title) : entry.documentPart;
    currentDocument = documentLabel;
    setBreadcrumbs([
      { label: "Library", action: "library" },
      { label: currentCollection.title, action: "collection" },
      { label: documentLabel, action: "document" },
      { label: entry.section }
    ]);
    const editions = audioCandidates(entry);
    const meta = [entry.author, entry.publication, entry.historicalDate].filter(Boolean);
    pageElements().content.innerHTML = `
      <article class="library-reader">
        <header class="library-reader__header">
          <span>${escapeHTML(entry.documentPart)}</span>
          <h2>${escapeHTML(entry.section === "Provision" ? entry.documentPart : entry.section)}</h2>
          ${meta.length ? `<p>${meta.map(escapeHTML).join(" · ")}</p>` : ""}
        </header>
        ${editions.length ? `<div class="library-reader__audio">${editions.map((edition) => audioEditionButton(entry, edition)).join("")}</div>` : ""}
        <section class="library-paper">
          <div class="library-paper__lines" aria-hidden="true"></div>
          <div class="library-paper__text">${escapeHTML(entry.fullText).replace(/\n/g, "<br>")}</div>
          ${entry.historicalDate ? `<footer>${escapeHTML(entry.historicalDate)}</footer>` : ""}
        </section>
        ${entry.summary ? `<section class="library-explainer"><span>IN PLAIN LANGUAGE</span><p>${escapeHTML(entry.summary)}</p></section>` : ""}
        ${entry.prompt ? researchCard(entry) : ""}
        ${entry.sourceURL ? `<a class="library-source-link" href="${escapeHTML(entry.sourceURL)}" target="_blank" rel="noopener noreferrer">Open the official source <span aria-hidden="true">↗</span></a>` : ""}
      </article>`;
    hydrateAudioIndicators();
    updateURL({ collection: currentCollection.id, entry: identifier(entry) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function audioCard(entry, free) {
    const edition = audioCandidates(entry)[0];
    if (!edition) return "";
    return `
      <section class="library-conversation-card audio-pending" data-audio-container="${escapeHTML(edition.filename)}">
        <button class="library-audio-play" type="button" data-play-audio="${escapeHTML(edition.filename)}" data-audio-title="${escapeHTML(entry.documentPart)}" data-audio-subtitle="${escapeHTML(edition.subtitle)}" data-audio-free="${free || isFreeAudio(entry) ? "true" : "false"}" aria-label="Play ${escapeHTML(entry.documentPart)} audio">▶</button>
        <span><small>${free || isFreeAudio(entry) ? "FREE AUDIO" : "OWL MEMBERSHIP AUDIO"}</small><strong>${escapeHTML(entry.documentPart)}</strong><em>${escapeHTML(edition.subtitle)}</em></span>
        <i aria-hidden="true">▥</i>
      </section>`;
  }

  function audioEditionButton(entry, edition) {
    return `
      <button class="library-audio-edition audio-pending" type="button" data-audio-container="${escapeHTML(edition.filename)}" data-play-audio="${escapeHTML(edition.filename)}" data-audio-title="${escapeHTML(entry.section)}" data-audio-subtitle="${escapeHTML(edition.subtitle)}" data-audio-free="${isFreeAudio(entry) ? "true" : "false"}">
        <span aria-hidden="true">▶</span><b>${escapeHTML(edition.title)}</b><small>${escapeHTML(edition.subtitle)}</small>
      </button>`;
  }

  function researchCard(entry) {
    const hasAccess = window.StrategicOwlAccess?.can?.("researchPrompt") === true;
    if (!hasAccess) return `
      <section class="library-research-card library-research-card--locked">
        <span>RESEARCH THE SOURCE</span>
        <h3>Ask a better question</h3>
        <p>Ready-to-copy research prompts are included with Owl Membership.</p>
        <button type="button" data-open-membership>Explore Owl Membership</button>
      </section>`;
    return `
      <section class="library-research-card">
        <span>RESEARCH THE SOURCE</span>
        <h3>Ask a better question</h3>
        <p>${escapeHTML(entry.prompt)}</p>
        <button type="button" data-copy-prompt="${escapeHTML(entry.prompt)}">Copy research prompt</button>
      </section>`;
  }

  function renderSearch(query) {
    const term = normalize(query);
    if (!term) {
      if (currentEntry) renderEntry(currentEntry);
      else if (currentDocument) renderDocument(currentDocument);
      else if (currentCollection) renderCollection(currentCollection);
      else renderLibrary();
      return;
    }
    const results = entries.filter((entry) => normalize([
      entry.documentPart, entry.section, entry.summary, entry.author, entry.group, entry.pulse?.fact
    ].join(" ")).includes(term)).slice(0, 80);
    setBreadcrumbs([{ label: "Library", action: "library" }, { label: "Search results" }]);
    pageElements().content.innerHTML = `
      <div class="library-section-heading"><span>SEARCH RESULTS</span><h2>${results.length ? `${results.length} matches` : "No matches yet"}</h2></div>
      <div class="library-search-results">
        ${results.length ? results.map((entry) => `
          <button class="library-search-result" type="button" data-open-entry="${escapeHTML(identifier(entry))}">
            <small>${escapeHTML(entry.documentPart)}</small>
            <strong>${escapeHTML(entry.section)}</strong>
            <span>${escapeHTML(entry.summary || entry.pulse?.fact || "Open the original text.")}</span>
          </button>`).join("") : `<p class="library-empty">Try a document, amendment, case, author, or civic topic.</p>`}
      </div>`;
  }

  function setBreadcrumbs(items) {
    const element = pageElements().breadcrumbs;
    if (!element) return;
    const returnsToChallenge = new URLSearchParams(window.location.search).get("return") === "civic-owl";
    const visibleItems = returnsToChallenge
      ? [{ label: "Back to Civic Owl", action: "challenge" }, ...items]
      : items;
    element.hidden = !visibleItems.length;
    element.innerHTML = visibleItems.map((item, index) => `${index ? '<span aria-hidden="true">›</span>' : ""}${item.action ? `<button type="button" data-breadcrumb="${item.action}">${escapeHTML(item.label)}</button>` : `<strong>${escapeHTML(item.label)}</strong>`}`).join("");
  }

  function handleContentClick(event) {
    const collectionButton = event.target.closest("[data-open-collection]");
    if (collectionButton) return renderCollection(catalog.find((item) => item.id === collectionButton.dataset.openCollection));

    const documentButton = event.target.closest("[data-open-document]");
    if (documentButton) {
      const single = documentButton.dataset.singleEntry;
      if (single) return openEntryByID(single);
      return renderDocument(documentButton.dataset.openDocument);
    }
    const entryButton = event.target.closest("[data-open-entry]");
    if (entryButton) return openEntryByID(entryButton.dataset.openEntry);

    const breadcrumb = event.target.closest("[data-breadcrumb]");
    if (breadcrumb?.dataset.breadcrumb === "challenge") return window.location.assign("civic-owl.html");
    if (breadcrumb?.dataset.breadcrumb === "library") return renderLibrary();
    if (breadcrumb?.dataset.breadcrumb === "collection") return renderCollection(currentCollection);
    if (breadcrumb?.dataset.breadcrumb === "document") return renderDocument(currentDocument);

    const membership = event.target.closest("[data-open-membership]");
    if (membership) return window.StrategicOwlAccess?.open?.();

    const copyButton = event.target.closest("[data-copy-prompt]");
    if (copyButton) {
      navigator.clipboard.writeText(copyButton.dataset.copyPrompt).then(() => {
        copyButton.textContent = "Prompt copied";
        window.setTimeout(() => { copyButton.textContent = "Copy research prompt"; }, 1800);
      });
      return;
    }

    const audioButton = event.target.closest("[data-play-audio]");
    if (audioButton) playAudioFromButton(audioButton);
  }

  function openEntryByID(id) {
    const entry = entries.find((candidate) => identifier(candidate) === id);
    if (!entry) return;
    currentCollection = catalog.find((item) => item.entries.includes(entry));
    renderEntry(entry);
  }

  function openFromURL() {
    const parameters = new URLSearchParams(window.location.search);
    const requestedEntry = parameters.get("entry");
    if (requestedEntry) {
      const exact = entries.find((entry) => identifier(entry) === requestedEntry);
      const sought = normalize(requestedEntry);
      const fuzzy = entries.find((entry) => {
        const id = normalize(identifier(entry));
        return id === sought || id.includes(sought) || sought.includes(id);
      });
      const match = exact || fuzzy;
      if (match) {
        currentCollection = catalog.find((item) => item.entries.includes(match));
        renderEntry(match);
        return;
      }
    }
    const requestedCollection = catalog.find((item) => item.id === parameters.get("collection"));
    if (requestedCollection) {
      currentCollection = requestedCollection;
      const documentPart = parameters.get("document");
      if (documentPart) renderDocument(documentPart);
      else renderCollection(requestedCollection);
      return;
    }
    renderLibrary();
  }

  function updateURL(values) {
    const url = new URL(window.location.href);
    ["collection", "document", "entry"].forEach((key) => url.searchParams.delete(key));
    Object.entries(values).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); });
    window.history.replaceState(window.history.state, "", url);
  }

  function readPublishedAudio() {
    try { return new Set(JSON.parse(sessionStorage.getItem(AUDIO_AVAILABLE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function rememberPublishedAudio(filename) {
    const values = readPublishedAudio();
    values.add(filename);
    sessionStorage.setItem(AUDIO_AVAILABLE_KEY, JSON.stringify([...values]));
  }

  async function audioExists(filename) {
    if (!filename) return false;
    if (availability.has(filename)) return availability.get(filename);
    if (readPublishedAudio().has(filename)) {
      availability.set(filename, true);
      return true;
    }
    const url = `${AUDIO_BASE}/${encodeURIComponent(filename)}`;
    try {
      const response = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
      const exists = response.ok;
      availability.set(filename, exists);
      if (exists) rememberPublishedAudio(filename);
      return exists;
    } catch {
      availability.set(filename, false);
      return false;
    }
  }

  function hydrateAudioIndicators() {
    document.querySelectorAll("[data-audio-check]").forEach(async (element) => {
      if (await audioExists(element.dataset.audioCheck)) element.classList.add("is-available");
      else element.remove();
    });
    document.querySelectorAll("[data-audio-container]").forEach(async (element) => {
      if (await audioExists(element.dataset.audioContainer)) element.classList.remove("audio-pending");
      else element.remove();
    });
  }

  function installPlayer() {
    const player = document.getElementById("library-player");
    if (!player || player.dataset.ready === "true") return;
    player.dataset.ready = "true";
    audio = new Audio();
    audio.preload = "metadata";
    const play = document.getElementById("library-player-play");
    const progress = document.getElementById("library-player-progress");
    const controls = document.getElementById("library-player-controls");
    const toggle = document.getElementById("library-player-toggle");
    const collapse = document.getElementById("library-player-collapse");

    play?.addEventListener("click", () => audio.paused ? audio.play() : audio.pause());
    document.getElementById("library-player-back")?.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
    document.getElementById("library-player-forward")?.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15); });
    document.getElementById("library-player-close")?.addEventListener("click", closePlayer);
    progress?.addEventListener("input", () => { if (Number.isFinite(audio.duration)) audio.currentTime = (Number(progress.value) / 100) * audio.duration; });

    function setExpanded(expanded) {
      controls.hidden = !expanded;
      toggle?.setAttribute("aria-expanded", String(expanded));
      if (collapse) collapse.textContent = expanded ? "⌃" : "⌄";
      player.classList.toggle("is-collapsed", !expanded);
    }
    toggle?.addEventListener("click", () => setExpanded(toggle.getAttribute("aria-expanded") !== "true"));
    collapse?.addEventListener("click", () => setExpanded(toggle?.getAttribute("aria-expanded") !== "true"));

    audio.addEventListener("loadedmetadata", () => {
      document.getElementById("library-player-duration").textContent = formatTime(audio.duration);
      const saved = readAudioProgress()[audioFilename];
      if (Number.isFinite(saved) && saved > 0 && saved < audio.duration - 10) audio.currentTime = saved;
    });
    audio.addEventListener("timeupdate", () => {
      document.getElementById("library-player-current").textContent = formatTime(audio.currentTime);
      if (progress) progress.value = Number.isFinite(audio.duration) && audio.duration > 0 ? String((audio.currentTime / audio.duration) * 100) : "0";
      const second = Math.floor(audio.currentTime);
      if (second !== audioSaveSecond && second % 4 === 0) {
        audioSaveSecond = second;
        saveAudioProgress(audioFilename, audio.currentTime);
      }
    });
    audio.addEventListener("play", () => { if (play) { play.textContent = "Ⅱ"; play.setAttribute("aria-label", "Pause"); } });
    audio.addEventListener("pause", () => { if (play) { play.textContent = "▶"; play.setAttribute("aria-label", "Play"); } });
    audio.addEventListener("ended", () => {
      audio.pause();
      audio.currentTime = 0;
      if (progress) progress.value = "0";
      saveAudioProgress(audioFilename, 0);
    });
  }

  async function playAudioFromButton(button) {
    const filename = button.dataset.playAudio;
    const free = button.dataset.audioFree === "true";
    if (!free && window.StrategicOwlAccess?.isActive?.() !== true) {
      window.StrategicOwlAccess?.open?.();
      return;
    }
    if (!(await audioExists(filename))) return;
    const player = document.getElementById("library-player");
    if (!audio) installPlayer();
    if (audioFilename !== filename) {
      audio.pause();
      audioFilename = filename;
      audio.src = `${AUDIO_BASE}/${encodeURIComponent(filename)}`;
      document.getElementById("library-player-title").textContent = button.dataset.audioTitle || "Library audio";
      document.getElementById("library-player-subtitle").textContent = button.dataset.audioSubtitle || "Civic Owl conversation";
    }
    player.hidden = false;
    document.body.classList.add("library-audio-active");
    try { await audio.play(); } catch (error) { console.warn("Audio playback was not started.", error); }
  }

  function closePlayer() {
    if (audio) audio.pause();
    const player = document.getElementById("library-player");
    if (player) player.hidden = true;
    document.body.classList.remove("library-audio-active");
  }

  function readAudioProgress() {
    try { return JSON.parse(localStorage.getItem(AUDIO_PROGRESS_KEY) || "{}"); }
    catch { return {}; }
  }

  function saveAudioProgress(filename, value) {
    if (!filename) return;
    const progress = readAudioProgress();
    if (value > 0) progress[filename] = value;
    else delete progress[filename];
    localStorage.setItem(AUDIO_PROGRESS_KEY, JSON.stringify(progress));
  }

  function formatTime(value) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const minutes = Math.floor(value / 60);
    return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  }

  function errorCard(title, message) {
    return `<div class="library-error"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p><button type="button" onclick="window.location.reload()">Try again</button></div>`;
  }

  document.addEventListener("DOMContentLoaded", initialize);
  window.addEventListener("strategic-owl-view-change", (event) => {
    if (event.detail?.page === "constitution") initialize();
    else if (audio && !audio.paused) audio.pause();
  });
  window.addEventListener("popstate", () => {
    if (document.body.dataset.page === "constitution" && catalog.length) openFromURL();
  });
})();
