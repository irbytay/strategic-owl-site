(function () {
  "use strict";

  const ENDPOINT = ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? "/api/owl-radar"
    : "https://gopyzkcmvkbusdnwjlbb.supabase.co/functions/v1/owl-radar";
  const state = {
    view: new URLSearchParams(window.location.search).get("view") === "feed" ? "feed" : "radar",
    radar: { items: [], nextOffset: 0, hasMore: false, loading: false, selectedId: "" },
    feed: {
      items: [], nextBefore: "", hasMore: false, loading: false, selectedId: "",
      member: false, sources: [], sourceId: "", viewpoint: "all"
    }
  };

  const byId = (id) => document.getElementById(id);

  function cleanText(value, fallback = "") {
    const text = typeof value === "string"
      ? value
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, " ")
        .trim()
      : "";
    return text || fallback;
  }

  function countLabel(value, singular, plural = `${singular}s`) {
    const count = Number(value) || 0;
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York", timeZoneName: "short"
    }).format(date);
  }

  function perspectiveColor(label) {
    const value = cleanText(label).toLowerCase();
    if (value.includes("left")) return "#437cff";
    if (value.includes("right")) return "#e15b64";
    if (value.includes("center") || value.includes("middle") || value.includes("nonpartisan")) return "#d4af37";
    return "#7c8a9b";
  }

  async function request(action, values = {}) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...values })
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || data.ok !== true) throw new Error(data.error || "Coverage could not be loaded.");
    return data;
  }

  async function memberRequest(action, values = {}) {
    const access = window.StrategicOwlAccess;
    const owlSession = await access?.requireMembership();
    if (!owlSession) throw new Error("Owl Membership is required.");
    const client = access.getSupabaseClient();
    let { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      const anonymous = await client.auth.signInAnonymously();
      if (anonymous.error) throw anonymous.error;
      sessionData = anonymous.data;
    }
    const { data, error } = await client.functions.invoke("news-reader", {
      body: { action, email: owlSession.email || "", ...values }
    });
    if (error) {
      let message = error.message || "The member request failed.";
      try {
        const details = await error.context?.clone?.().json();
        message = details?.error || details?.message || message;
      } catch { /* Keep the supplied error. */ }
      throw new Error(message);
    }
    if (data?.ok === false || data?.valid === false) throw new Error(data?.error || "Owl Membership could not be confirmed.");
    return data || {};
  }

  function imageMarkup(url, alt) {
    const image = safeUrl(url);
    return image
      ? `<img class="coverage-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy" />`
      : `<span class="coverage-card-image coverage-card-image--placeholder"><img src="assets/images/3X.png" alt="" /></span>`;
  }

  function balanceMarkup(rawCoverage) {
    const coverage = Array.isArray(rawCoverage) ? rawCoverage.filter((item) => Number(item?.count) > 0) : [];
    if (!coverage.length) return '<p class="coverage-card-meta">Perspective mix not assessed</p>';
    const total = coverage.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
    return `
      <div class="coverage-balance" aria-label="Perspective mix">
        ${coverage.map((item) => `<span style="width:${(Number(item.count) / total) * 100}%;background:${perspectiveColor(item.label)}"></span>`).join("")}
      </div>
      <div class="coverage-balance-legend">
        ${coverage.map((item) => `<span style="--perspective-color:${perspectiveColor(item.label)}">${escapeHtml(cleanText(item.label, "Not assessed"))} ${Number(item.count) || 0}</span>`).join("")}
      </div>`;
  }

  function radarCard(story) {
    const stats = story?.stats || {};
    const selected = state.radar.selectedId === story.id;
    return `
      <button class="coverage-card" type="button" data-radar-id="${escapeHtml(story.id)}" aria-current="${selected}">
        ${imageMarkup(story.storyImageUrl, "")}
        <span class="coverage-card-body">
          <span class="coverage-card-meta"><strong>${countLabel(stats.sourceCount, "source")}</strong><span>·</span><span>${countLabel(stats.articleCount, "article")}</span></span>
          <h3>${escapeHtml(cleanText(story.title, "Untitled coverage"))}</h3>
          ${cleanText(story.summary) ? `<span class="coverage-card-summary">${escapeHtml(cleanText(story.summary))}</span>` : ""}
          ${balanceMarkup(story.alignmentCoverage)}
          <span class="coverage-card-meta"><strong>Open coverage</strong><span>→</span></span>
        </span>
      </button>`;
  }

  function feedCard(article) {
    const source = article?.source || {};
    const selected = state.feed.selectedId === article.id;
    const image = article.thumbnailUrl || article.primaryMediaUrl;
    return `
      <button class="coverage-card" type="button" data-feed-id="${escapeHtml(article.id)}" aria-current="${selected}">
        ${imageMarkup(image, "")}
        <span class="coverage-card-body">
          <span class="coverage-card-meta"><strong>${escapeHtml(cleanText(source.name, "News source"))}</strong>${cleanText(source.alignmentLabel) ? `<span>·</span><span>${escapeHtml(source.alignmentLabel)}</span>` : ""}<span>·</span><span>${escapeHtml(formatDate(article.publishedAt))}</span></span>
          <h3>${escapeHtml(cleanText(article.headline, "Untitled article"))}</h3>
          ${cleanText(article.summary) ? `<span class="coverage-card-summary">${escapeHtml(cleanText(article.summary))}</span>` : ""}
          <span class="coverage-card-meta"><strong>Article details</strong><span>→</span></span>
        </span>
      </button>`;
  }

  function renderRadar() {
    const host = byId("radar-list");
    host.innerHTML = state.radar.items.length
      ? state.radar.items.map(radarCard).join("")
      : '<div class="coverage-empty-card">No confirmed story groups are available right now.</div>';
    byId("radar-load-more").hidden = !state.radar.hasMore;
  }

  function renderFeed() {
    const host = byId("feed-list");
    if (state.feed.items.length) {
      host.innerHTML = state.feed.items.map((article, index) => {
        const invitation = !state.feed.member && (index + 1) % 10 === 0
          ? '<div class="coverage-membership-invite"><strong>Choose what fills your Feed.</strong><p>Owl Membership adds source follows, filters, Owl Reader, and research prompts.</p><button class="coverage-detail-action" type="button" data-open-membership>View Owl Membership</button></div>'
          : "";
        return `${feedCard(article)}${invitation}`;
      }).join("");
    } else {
      host.innerHTML = state.feed.member
        ? '<div class="coverage-empty-card"><h3>Your personal Feed is ready.</h3><p>Follow at least one publisher in Manage Sources to begin.</p><button class="coverage-detail-action" type="button" data-manage-sources>Manage Sources</button></div>'
        : '<div class="coverage-empty-card">No recent reporting is available right now.</div>';
    }
    byId("feed-load-more").hidden = !state.feed.hasMore;
  }

  function renderMemberChrome() {
    byId("feed-free-membership-bar").hidden = state.feed.member;
    byId("feed-member-tools").hidden = !state.feed.member;
    byId("feed-eyebrow").textContent = state.feed.member ? "Owl Membership" : "Free for everyone";
    byId("feed-title").textContent = state.feed.member ? "Your Feed" : "All Sources";
    byId("feed-description").textContent = state.feed.member
      ? "The newest reporting from the sources you follow."
      : "All reporting in one chronological stream. No source filtering in free access.";
    const sourceFilter = byId("feed-source-filter");
    if (sourceFilter) {
      sourceFilter.innerHTML = '<option value="">All followed sources</option>' + state.feed.sources
        .filter((source) => source.following)
        .map((source) => `<option value="${escapeHtml(source.id)}"${source.id === state.feed.sourceId ? " selected" : ""}>${escapeHtml(cleanText(source.name, "News source"))}</option>`)
        .join("");
    }
  }

  async function loadRadar({ append = false } = {}) {
    if (state.radar.loading) return;
    state.radar.loading = true;
    const button = byId("radar-load-more");
    button.disabled = true;
    byId("radar-status").textContent = append ? "Loading more coverage…" : "Gathering today’s coverage…";
    try {
      const data = await request("listRadarStories", { limit: 25, offset: append ? state.radar.nextOffset : 0 });
      const incoming = Array.isArray(data.coverageGroups) ? data.coverageGroups : [];
      state.radar.items = append ? [...state.radar.items, ...incoming.filter((item) => !state.radar.items.some((existing) => existing.id === item.id))] : incoming;
      state.radar.hasMore = data.hasMore === true;
      state.radar.nextOffset = Number.isFinite(Number(data.nextOffset)) ? Number(data.nextOffset) : state.radar.items.length;
      byId("radar-status").textContent = state.radar.items.length ? `${state.radar.items.length} confirmed stories` : "";
      renderRadar();
      if (!append && window.innerWidth >= 921 && state.radar.items[0]) openRadar(state.radar.items[0].id);
    } catch (error) {
      byId("radar-status").textContent = error.message || "Radar could not be loaded.";
      if (!state.radar.items.length) byId("radar-list").innerHTML = '<div class="coverage-empty-card">Radar is temporarily unavailable. Use Refresh to try again.</div>';
    } finally {
      state.radar.loading = false;
      button.disabled = false;
    }
  }

  async function loadFeed({ append = false } = {}) {
    if (state.feed.loading) return;
    state.feed.loading = true;
    const button = byId("feed-load-more");
    button.disabled = true;
    byId("feed-status").textContent = append ? "Loading more reporting…" : "Gathering the latest reporting…";
    try {
      const values = { limit: 30 };
      if (append && state.feed.nextBefore) values.before = state.feed.nextBefore;
      if (state.feed.member) {
        if (state.feed.sourceId) values.sourceId = state.feed.sourceId;
        if (state.feed.viewpoint !== "all") values.viewpoint = state.feed.viewpoint;
      }
      const data = state.feed.member
        ? await memberRequest("listNewsFeed", values)
        : await request("listNewsFeed", values);
      const incoming = Array.isArray(data.items) ? data.items : [];
      state.feed.items = append ? [...state.feed.items, ...incoming.filter((item) => !state.feed.items.some((existing) => existing.id === item.id))] : incoming;
      state.feed.hasMore = data.hasMore === true;
      state.feed.nextBefore = cleanText(data.nextBefore);
      byId("feed-status").textContent = state.feed.items.length
        ? `${state.feed.items.length} latest articles · ${state.feed.member ? "from followed sources" : "newest first"}`
        : state.feed.member && data.hasFollows === false ? "Follow a source to build your Feed." : "";
      renderFeed();
      if (!append && window.innerWidth >= 921 && state.feed.items[0]) openFeed(state.feed.items[0].id);
    } catch (error) {
      byId("feed-status").textContent = error.message || "The News Feed could not be loaded.";
      if (!state.feed.items.length) byId("feed-list").innerHTML = '<div class="coverage-empty-card">The News Feed is temporarily unavailable. Use Refresh to try again.</div>';
    } finally {
      state.feed.loading = false;
      button.disabled = false;
    }
  }

  async function loadMemberSources() {
    const data = await memberRequest("listNewsSources");
    state.feed.sources = Array.isArray(data.sources) ? data.sources : [];
    renderMemberChrome();
    renderSourceManager();
  }

  function renderSourceManager() {
    const host = byId("coverage-source-list");
    if (!host) return;
    host.innerHTML = state.feed.sources.map((source) => `
      <div class="coverage-source-row">
        <div><strong>${escapeHtml(cleanText(source.name, "News source"))}</strong><small>${escapeHtml([source.alignmentLabel, source.sourceCategory].filter(Boolean).join(" · "))}</small></div>
        <button class="coverage-source-action" type="button" data-source-follow="${escapeHtml(source.id)}" data-following="${source.following === true}">${source.following === true ? "Following" : "Follow"}</button>
      </div>`).join("") || '<p>No sources are available right now.</p>';
  }

  function storyDetailMarkup(story) {
    const articles = Array.isArray(story.recentArticles) ? story.recentArticles : [];
    return `
      <article class="coverage-detail">
        ${safeUrl(story.storyImageUrl) ? `<img class="coverage-detail-hero" src="${escapeHtml(safeUrl(story.storyImageUrl))}" alt="" />` : ""}
        <p class="owl-eyebrow">Radar · ${countLabel(story?.stats?.sourceCount, "source")}</p>
        <h2 id="coverage-dialog-title">${escapeHtml(cleanText(story.title, "Coverage"))}</h2>
        ${cleanText(story.summary) ? `<p>${escapeHtml(cleanText(story.summary))}</p>` : ""}
        ${balanceMarkup(story.alignmentCoverage)}
        <div class="coverage-articles" aria-label="Confirmed reporting">
          ${articles.map((article) => {
            const url = safeUrl(article.url);
            return `<a class="coverage-article-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="coverage-article-meta"><strong>${escapeHtml(cleanText(article?.source?.name, "News source"))}</strong>${cleanText(article?.source?.alignmentLabel) ? `<span>· ${escapeHtml(article.source.alignmentLabel)}</span>` : ""}<span>· ${escapeHtml(formatDate(article.publishedAt))}</span></span><strong>${escapeHtml(cleanText(article.headline, "Untitled article"))}</strong></a>`;
          }).join("") || '<p class="coverage-status">No confirmed articles are available.</p>'}
        </div>
      </article>`;
  }

  function articleDetailMarkup(article) {
    const source = article?.source || {};
    const url = safeUrl(article.url);
    const image = safeUrl(article.thumbnailUrl || article.primaryMediaUrl);
    const readerAvailable = state.feed.member && article?.reader?.available === true && cleanText(article.content);
    const readerNotice = cleanText(article?.reader?.notice, "Owl Reader is available only when publisher rights and supplied article text permit it.");
    return `
      <article class="coverage-detail">
        ${image ? `<img class="coverage-detail-hero" src="${escapeHtml(image)}" alt="" />` : ""}
        <p class="owl-eyebrow">${escapeHtml(cleanText(source.name, "News source"))}</p>
        <h2 id="coverage-dialog-title">${escapeHtml(cleanText(article.headline, "Article"))}</h2>
        <div class="coverage-article-meta">${cleanText(source.alignmentLabel) ? `<span>${escapeHtml(source.alignmentLabel)}</span><span>·</span>` : ""}<span>${escapeHtml(formatDate(article.publishedAt))}</span></div>
        ${cleanText(article.summary) ? `<p>${escapeHtml(cleanText(article.summary))}</p>` : '<p>Open the original source to read this report.</p>'}
        ${url ? `<a class="coverage-original-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Read at ${escapeHtml(cleanText(source.name, "the source"))} ↗</a>` : ""}
        <div class="coverage-detail-actions">
          ${state.feed.member
            ? `<button class="coverage-detail-action" type="button" data-reader-toggle="${escapeHtml(article.id)}"${readerAvailable ? "" : " disabled"}>Owl Reader</button><button class="coverage-detail-action" type="button" data-copy-research="${escapeHtml(article.id)}">Copy Research Prompt</button>`
            : '<button class="coverage-detail-action" type="button" data-open-membership>Unlock member tools</button>'}
        </div>
        ${state.feed.member && !readerAvailable ? `<p class="coverage-status">${escapeHtml(readerNotice)}</p>` : ""}
        ${readerAvailable ? `<div class="coverage-reader-copy" id="coverage-reader-${escapeHtml(article.id)}" hidden>${escapeHtml(cleanText(article.content))}</div>` : ""}
      </article>`;
  }

  function researchPrompt(article) {
    const source = cleanText(article?.source?.name, "the original publisher");
    return `Research “${cleanText(article?.headline, "this news report")}” using primary sources. Start with the report from ${source}, identify the central factual claims, verify each claim independently, compare materially different perspectives, distinguish confirmed facts from analysis, and cite every source with its publication date and link.`;
  }

  function showDetail(markup, paneId) {
    if (window.innerWidth >= 921) {
      byId(paneId).innerHTML = markup;
      return;
    }
    byId("coverage-dialog-content").innerHTML = markup;
    byId("coverage-detail-dialog").showModal();
    document.body.classList.add("owl-dialog-open");
  }

  async function openRadar(id) {
    const item = state.radar.items.find((story) => story.id === id);
    if (!item) return;
    state.radar.selectedId = id;
    renderRadar();
    showDetail('<div class="coverage-detail-empty"><p>Loading full coverage…</p></div>', "radar-detail-pane");
    try {
      const data = await request("getRadarStory", { coverageGroupId: id });
      showDetail(storyDetailMarkup(data.coverageGroup || item), "radar-detail-pane");
    } catch (error) {
      showDetail(`<div class="coverage-detail-empty"><p>${escapeHtml(error.message || "This story could not be loaded.")}</p></div>`, "radar-detail-pane");
    }
  }

  function openFeed(id) {
    const item = state.feed.items.find((article) => article.id === id);
    if (!item) return;
    state.feed.selectedId = id;
    renderFeed();
    showDetail(articleDetailMarkup(item), "feed-detail-pane");
  }

  function switchView(view, { updateHistory = true } = {}) {
    state.view = view === "feed" ? "feed" : "radar";
    document.querySelectorAll("[data-coverage-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.coverageView === state.view));
    });
    document.querySelectorAll("[data-coverage-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.coveragePanel !== state.view;
    });
    if (updateHistory) {
      const url = new URL(window.location.href);
      if (state.view === "feed") url.searchParams.set("view", "feed");
      else url.searchParams.delete("view");
      window.history.replaceState({}, "", url);
    }
    if (state.view === "radar" && !state.radar.items.length) loadRadar();
    if (state.view === "feed" && !state.feed.items.length) loadFeed();
  }

  document.querySelectorAll("[data-coverage-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.coverageView));
  });
  document.querySelectorAll("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => button.dataset.refresh === "radar" ? loadRadar() : loadFeed());
  });
  byId("radar-load-more")?.addEventListener("click", () => loadRadar({ append: true }));
  byId("feed-load-more")?.addEventListener("click", () => loadFeed({ append: true }));
  byId("radar-list")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-radar-id]");
    if (card) openRadar(card.dataset.radarId);
  });
  byId("feed-list")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-feed-id]");
    if (card) openFeed(card.dataset.feedId);
  });

  document.addEventListener("click", async (event) => {
    const membershipButton = event.target.closest("[data-open-membership]");
    if (membershipButton) {
      window.StrategicOwlAccess?.open();
      return;
    }
    if (event.target.closest("[data-manage-sources]")) {
      byId("manage-sources-button")?.click();
      return;
    }
    const readerButton = event.target.closest("[data-reader-toggle]");
    if (readerButton) {
      const copy = byId(`coverage-reader-${readerButton.dataset.readerToggle}`);
      if (copy) {
        copy.hidden = !copy.hidden;
        readerButton.textContent = copy.hidden ? "Owl Reader" : "Close Owl Reader";
      }
      return;
    }
    const promptButton = event.target.closest("[data-copy-research]");
    if (promptButton) {
      const article = state.feed.items.find((item) => item.id === promptButton.dataset.copyResearch);
      if (!article) return;
      try {
        await window.StrategicOwlAccess.requireMembership();
        await navigator.clipboard.writeText(researchPrompt(article));
        promptButton.textContent = "Prompt Copied";
        window.setTimeout(() => { promptButton.textContent = "Copy Research Prompt"; }, 1800);
      } catch {
        window.StrategicOwlAccess?.open();
      }
    }
  });

  byId("feed-source-filter")?.addEventListener("change", (event) => {
    state.feed.sourceId = event.target.value;
    state.feed.items = [];
    loadFeed();
  });
  byId("feed-viewpoint-filter")?.addEventListener("change", (event) => {
    state.feed.viewpoint = event.target.value;
    state.feed.items = [];
    loadFeed();
  });

  const sourcesDialog = byId("coverage-sources-dialog");
  byId("manage-sources-button")?.addEventListener("click", async () => {
    byId("coverage-sources-status").textContent = "Loading your source choices…";
    sourcesDialog.showModal();
    document.body.classList.add("owl-dialog-open");
    try {
      await loadMemberSources();
      byId("coverage-sources-status").textContent = `${state.feed.sources.filter((source) => source.following).length} followed sources`;
    } catch (error) {
      byId("coverage-sources-status").textContent = error.message || "Sources could not be loaded.";
    }
  });
  sourcesDialog.querySelector(".coverage-dialog-close")?.addEventListener("click", () => sourcesDialog.close());
  sourcesDialog.addEventListener("close", () => document.body.classList.remove("owl-dialog-open"));
  sourcesDialog.addEventListener("click", async (event) => {
    if (event.target === sourcesDialog) { sourcesDialog.close(); return; }
    const button = event.target.closest("[data-source-follow]");
    if (!button) return;
    const source = state.feed.sources.find((item) => item.id === button.dataset.sourceFollow);
    if (!source) return;
    button.disabled = true;
    byId("coverage-sources-status").textContent = source.following ? `Removing ${source.name}…` : `Following ${source.name}…`;
    try {
      await memberRequest(source.following ? "unfollowNewsSource" : "followNewsSource", { sourceId: source.id });
      source.following = !source.following;
      if (!source.following && state.feed.sourceId === source.id) state.feed.sourceId = "";
      renderSourceManager();
      renderMemberChrome();
      byId("coverage-sources-status").textContent = `${state.feed.sources.filter((item) => item.following).length} followed sources`;
      state.feed.items = [];
      await loadFeed();
    } catch (error) {
      byId("coverage-sources-status").textContent = error.message || "That source choice could not be saved.";
      button.disabled = false;
    }
  });

  const dialog = byId("coverage-detail-dialog");
  function closeDialog() {
    dialog.close();
    document.body.classList.remove("owl-dialog-open");
  }
  dialog.querySelector(".coverage-dialog-close")?.addEventListener("click", closeDialog);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });

  async function syncMembership() {
    const member = window.StrategicOwlAccess?.can?.("savedSources") === true;
    if (member === state.feed.member && (!member || state.feed.sources.length)) {
      renderMemberChrome();
      return;
    }
    state.feed.member = member;
    state.feed.items = [];
    state.feed.nextBefore = "";
    state.feed.sourceId = "";
    if (member) {
      try { await loadMemberSources(); } catch { state.feed.sources = []; }
    } else {
      state.feed.sources = [];
    }
    renderMemberChrome();
    if (state.view === "feed") loadFeed();
  }

  window.addEventListener("strategic-owl-access-change", syncMembership);
  renderMemberChrome();

  switchView(state.view, { updateHistory: false });
  if (new URLSearchParams(window.location.search).get("panel") === "sources") {
    window.setTimeout(() => {
      if (window.StrategicOwlAccess?.can?.("savedSources")) byId("manage-sources-button")?.click();
      else window.StrategicOwlAccess?.open();
    }, 0);
  }
})();
