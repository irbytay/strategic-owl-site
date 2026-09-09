(function () {
  "use strict";

  const NEWS_READER_FUNCTION = "news-reader";
  const NEWS_BETA_ADMINISTRATOR_ONLY = false;
  const NEWS_SHARE_BASE_URL = "https://thestrategicowl.com/news";
  const NEWS_CACHE_VERSION = 1;
  const NEWS_CACHE_PREFIX = "strategic-owl-news-feed";

  let currentAccess = null;
  let currentSources = [];
  let currentScope = "following";
  let requestsLoaded = false;
  let loading = false;
  let toastTimer = 0;
  let pullStartY = null;
  let pullDistance = 0;
  let pullRefreshing = false;

  const byId = (id) => document.getElementById(id);

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function firstValue(object, keys, fallback = "") {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") {
        return object[key];
      }
    }
    return fallback;
  }

  function extractArray(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
      if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    }
    return [];
  }

  function normalizeStringList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  function showToast(message) {
    const toast = byId("news-toast");
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.visible = "true";
    toastTimer = window.setTimeout(() => {
      toast.dataset.visible = "false";
    }, 2400);
  }

  function newsCacheKey() {
    const identity = String(
      currentAccess?.owlSession?.email ||
      currentAccess?.session?.user?.id ||
      "owl-access"
    ).trim().toLowerCase();
    return `${NEWS_CACHE_PREFIX}:${NEWS_CACHE_VERSION}:${encodeURIComponent(identity)}`;
  }

  function readNewsCache() {
    if (!currentAccess?.owlSession) return null;
    try {
      const stored = window.sessionStorage.getItem(newsCacheKey());
      if (!stored) return null;
      const cache = JSON.parse(stored);
      if (cache?.version !== NEWS_CACHE_VERSION || !cache.views) return null;
      return cache;
    } catch {
      return null;
    }
  }

  function writeNewsCache(cache) {
    if (!currentAccess?.owlSession) return;
    try {
      window.sessionStorage.setItem(newsCacheKey(), JSON.stringify(cache));
    } catch {
      // A full or restricted browser store should never prevent the live feed from working.
    }
  }

  function openNewsItemIds() {
    return Array.from(document.querySelectorAll(".news-item[open][data-item-id]"))
      .map((item) => item.dataset.itemId)
      .filter(Boolean);
  }

  function rememberNewsPosition() {
    const cache = readNewsCache();
    if (!cache) return;
    cache.ui = {
      scope: currentScope,
      scrollY: Math.max(0, window.scrollY || 0),
      openItemIds: openNewsItemIds()
    };
    writeNewsCache(cache);
  }

  function clearNewsCache() {
    if (!currentAccess?.owlSession) return;
    try {
      window.sessionStorage.removeItem(newsCacheKey());
    } catch {
      // The next live request remains the fallback when browser storage is unavailable.
    }
  }

  function saveNewsView(scope, rawSources, rawItems, hasFollows) {
    const cache = readNewsCache() || {
      version: NEWS_CACHE_VERSION,
      views: {}
    };
    cache.views[scope] = {
      scope,
      sources: rawSources,
      items: rawItems,
      hasFollows,
      savedAt: Date.now()
    };
    cache.ui = {
      scope,
      scrollY: Math.max(0, window.scrollY || 0),
      openItemIds: openNewsItemIds()
    };
    writeNewsCache(cache);
  }

  function restoreNewsPosition(ui) {
    const openIds = new Set(Array.isArray(ui?.openItemIds) ? ui.openItemIds : []);
    document.querySelectorAll(".news-item[data-item-id]").forEach((item) => {
      item.open = openIds.has(item.dataset.itemId);
    });

    const scrollY = Number(ui?.scrollY || 0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: Math.max(0, scrollY), left: 0, behavior: "auto" });
      });
    });
  }

  function restoreNewsView(requestedScope = "") {
    const cache = readNewsCache();
    if (!cache) return false;
    const scope = requestedScope || cache.ui?.scope || currentScope;
    const view = cache.views?.[scope];
    if (!view || !Array.isArray(view.sources) || !Array.isArray(view.items)) return false;

    const sources = renderSources(view.sources);
    renderItems(view.items, sources);
    currentScope = view.scope === "following" ? "following" : "all";
    updateScopeButtons(currentScope);

    const status = byId("news-status");
    if (status) {
      if (!view.hasFollows) {
        status.textContent = "Choose Sources to build your Following feed.";
      } else if (view.items.length) {
        status.textContent = `Updated ${formatDate(view.savedAt)}`;
      } else {
        status.textContent = "No stories in this view.";
      }
    }

    restoreNewsPosition(cache.ui);
    return true;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  function showGate(heading, message, buttonLabel = "") {
    const gate = byId("news-gate");
    const workspace = byId("news-workspace");
    if (workspace) workspace.hidden = true;
    if (!gate) return;

    gate.hidden = false;
    gate.innerHTML = `
      <h2>${escapeHtml(heading)}</h2>
      <p>${escapeHtml(message)}</p>
      ${buttonLabel ? `<button class="news-access-button" id="news-open-access" type="button">${escapeHtml(buttonLabel)}</button>` : ""}`;

    byId("news-open-access")?.addEventListener("click", () => {
      window.StrategicOwlAccess?.open();
    });
  }

  function showWorkspace() {
    const gate = byId("news-gate");
    const workspace = byId("news-workspace");
    if (gate) gate.hidden = true;
    if (workspace) workspace.hidden = false;
  }

  async function getAuthorizedAccess() {
    const accessApi = window.StrategicOwlAccess;
    const owlSession = accessApi?.getSession();

    if (!owlSession) return null;

    if (owlSession.source === "administrator") {
      const administrator = await accessApi.requireAdministrator();
      if (!administrator) return null;
      return {
        client: administrator.client,
        session: administrator.session,
        owlSession,
        administrator: true
      };
    }

    if (NEWS_BETA_ADMINISTRATOR_ONLY) {
      return {
        client: null,
        session: null,
        owlSession,
        administrator: false,
        previewLocked: true
      };
    }

    const client = accessApi.getSupabaseClient();
    let { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (!data.session) {
      const anonymousResult = await client.auth.signInAnonymously();
      if (anonymousResult.error) throw anonymousResult.error;
      data = anonymousResult.data;
    }

    return {
      client,
      session: data.session,
      owlSession,
      administrator: false
    };
  }

  async function invokeReader(action, values = {}) {
    if (!currentAccess?.client || !currentAccess?.owlSession) {
      throw new Error("Owl Access is required.");
    }

    const { data, error } = await currentAccess.client.functions.invoke(
      NEWS_READER_FUNCTION,
      {
        body: {
          action,
          email: currentAccess.owlSession.email,
          ...values
        }
      }
    );

    if (error) {
      let message = error.message || "The News Feed request failed.";
      try {
        const response = error.context;
        if (response && typeof response.clone === "function") {
          const details = await response.clone().json();
          message = details?.error || details?.message || message;
        }
      } catch {
        // Keep the original Supabase error when no JSON response is available.
      }
      throw new Error(message);
    }
    if (data?.ok === false) {
      throw new Error(data.error || "The News Feed could not be loaded.");
    }
    return data || {};
  }

  function normalizeSource(source) {
    return {
      id: String(firstValue(source, ["id", "sourceId", "source_id"])),
      name: String(firstValue(source, ["sourceName", "source_name", "name"], "News Source")),
      status: String(firstValue(source, ["status"], "active")).toLowerCase(),
      alignment: String(firstValue(source, ["alignmentLabel", "alignment_label", "alignment"])),
      category: String(firstValue(source, ["sourceCategory", "source_category", "category"])),
      contentType: String(firstValue(source, ["contentType", "content_type"])),
      websiteUrl: safeUrl(firstValue(source, ["websiteUrl", "website_url"])),
      following: Boolean(firstValue(source, ["following", "isFollowing", "is_following"], false))
    };
  }

  function normalizeItem(item, sourceMap) {
    const nestedSource = firstValue(item, ["source", "newsSource", "news_sources"], {});
    const sourceId = String(firstValue(item, ["sourceId", "source_id"], firstValue(nestedSource, ["id"])));
    const mappedSource = sourceMap.get(sourceId) || {};
    const media = Array.isArray(item?.media) ? item.media[0] || {} : {};
    const rawInsight = firstValue(item, ["owlInsight", "owl_insight"], null);
    const insightAnalysis = String(firstValue(rawInsight, ["owlAnalysis", "owl_analysis", "analysis"]));

    return {
      id: String(firstValue(item, ["id", "newsItemId", "news_item_id"])),
      headline: String(firstValue(item, ["headline", "title"], "Untitled story")),
      summary: String(firstValue(item, ["summaryText", "summary_text", "summary", "excerpt"], "Open the original source to read this story.")),
      publishedAt: firstValue(item, ["publishedAt", "published_at", "sourceUpdatedAt", "source_updated_at"]),
      originalUrl: safeUrl(firstValue(item, ["canonicalUrl", "canonical_url", "articleLink", "article_link", "url"])),
      imageUrl: safeUrl(firstValue(item, ["primaryMediaUrl", "primary_media_url", "thumbnailUrl", "thumbnail_url", "imageUrl", "image_url"], firstValue(media, ["url", "mediaUrl", "media_url"]))),
      authors: normalizeStringList(firstValue(item, ["authors", "author", "byline"], [])),
      categories: normalizeStringList(firstValue(item, ["categories", "category"], [])),
      sourceName: String(firstValue(nestedSource, ["sourceName", "source_name", "name"], mappedSource.name || firstValue(item, ["sourceName", "source_name"], "News Source"))),
      sourceStatus: String(firstValue(nestedSource, ["status"], mappedSource.status || firstValue(item, ["sourceStatus", "source_status"], "active"))).toLowerCase(),
      owlInsight: insightAnalysis ? {
        label: String(firstValue(rawInsight, ["owlLabel", "owl_label"], "Owl Insight")),
        labels: normalizeStringList(firstValue(rawInsight, ["labels"], [])),
        analysis: insightAnalysis,
        public: Boolean(firstValue(rawInsight, ["public", "isPublic", "is_public"], false))
      } : null
    };
  }

  function renderSources(rawSources) {
    const sources = rawSources.map(normalizeSource);
    currentSources = sources;
    const host = byId("news-source-list");
    const count = byId("news-source-count");
    if (count) count.textContent = String(sources.length);
    if (!host) return sources;

    if (!sources.length) {
      host.innerHTML = '<p class="news-empty">No news sources are available for this preview yet.</p>';
      return sources;
    }

    host.innerHTML = sources.map((source) => {
      const details = [source.alignment, source.category, source.contentType].filter(Boolean).join(" · ");
      return `
        <article class="news-source-card" data-following="${String(source.following)}">
          <div class="news-source-title-row">
            <h3>${escapeHtml(source.name)}</h3>
            <span class="news-source-status" data-status="${escapeHtml(source.status)}">${escapeHtml(source.status)}</span>
          </div>
          <div class="news-source-footer">
            ${details ? `<p>${escapeHtml(details)}</p>` : "<p>News source</p>"}
            <button
              class="news-follow-button"
              type="button"
              data-source-id="${escapeHtml(source.id)}"
              data-following="${String(source.following)}"
              aria-pressed="${String(source.following)}"
            >${source.following ? "Following" : "Follow"}</button>
          </div>
        </article>`;
    }).join("");

    return sources;
  }

  function updateScopeButtons(scope) {
    document.querySelectorAll("[data-news-scope]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.newsScope === scope));
    });

    const viewTitle = byId("news-view-title");
    if (viewTitle) {
      viewTitle.textContent = scope === "following"
        ? "Sources You Follow"
        : "All Sources";
    }
  }

  function installImageFallbacks(host) {
    host.querySelectorAll(".news-item-image").forEach((image) => {
      image.addEventListener("error", () => {
        const placeholder = document.createElement("span");
        placeholder.className = "news-item-image-placeholder";

        const logo = document.createElement("img");
        logo.src = "assets/images/3X.png";
        logo.alt = "";

        placeholder.appendChild(logo);
        image.replaceWith(placeholder);
      }, { once: true });
    });
  }

  function renderItems(rawItems, sources) {
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const items = rawItems.map((item) => normalizeItem(item, sourceMap));
    const host = byId("news-item-list");
    const count = byId("news-item-count");
    if (count) count.textContent = String(items.length);
    if (!host) return;

    if (!items.length) {
      host.innerHTML = '<p class="news-empty">No stories yet.</p>';
      return;
    }

    host.innerHTML = items.map((item) => {
      const image = item.imageUrl
        ? `<img class="news-item-image" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" />`
        : `<span class="news-item-image-placeholder"><img src="assets/images/3X.png" alt="" /></span>`;
      const published = formatDate(item.publishedAt);
      const originalLink = item.originalUrl
        ? `<a class="news-original-link" href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener noreferrer">Read Original</a>`
        : "";
      const metadata = [...item.authors, ...item.categories].slice(0, 6);
      const metadataMarkup = metadata.length
        ? `<div class="news-item-meta">${metadata.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`
        : "";
      const insightMarkup = item.owlInsight
        ? `<aside class="news-owl-insight">
            <div class="news-owl-insight-heading">
              <strong>${escapeHtml(item.owlInsight.label)}</strong>
              <span>${item.owlInsight.public ? "Public Owl Insight" : "Owl Access Insight"}</span>
            </div>
            <p>${escapeHtml(item.owlInsight.analysis)}</p>
            ${item.owlInsight.labels.length
              ? `<div class="news-insight-labels">${item.owlInsight.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>`
              : ""}
          </aside>`
        : "";
      const canShare = item.sourceStatus === "active" && Boolean(item.id);
      const shareButton = canShare
        ? `<button class="news-share-button" type="button" data-share-id="${escapeHtml(item.id)}">Share</button>`
        : `<button class="news-share-button" type="button" disabled title="Sharing becomes available after this source is approved">Share when Live</button>`;

      return `
        <details class="news-item" data-item-id="${escapeHtml(item.id)}">
          <summary class="news-item-summary">
            ${image}
            <div class="news-item-copy">
              <p class="news-item-source">${escapeHtml(item.sourceName)}${item.sourceStatus === "testing" ? " · Testing" : ""}</p>
              <h3>${escapeHtml(item.headline)}</h3>
              ${published ? `<p class="news-item-date">${escapeHtml(published)}</p>` : ""}
            </div>
            <span class="news-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>
            </span>
          </summary>
          <div class="news-item-details">
            ${metadataMarkup}
            <p>${escapeHtml(item.summary)}</p>
            ${insightMarkup}
            <div class="news-item-actions">
              ${originalLink}
              ${shareButton}
            </div>
          </div>
        </details>`;
    }).join("");

    installImageFallbacks(host);
  }

  async function copyShareUrl(shareUrl) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      return;
    }

    const field = document.createElement("textarea");
    field.value = shareUrl;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }

  async function shareStory(itemId) {
    const cleanId = String(itemId || "").trim();
    if (!cleanId) return;
    const shareUrl = `${NEWS_SHARE_BASE_URL}/${encodeURIComponent(cleanId)}`;

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url: shareUrl });
        return;
      }
      await copyShareUrl(shareUrl);
      showToast("Link copied");
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("Unable to share news story", error);
      showToast("The link could not be shared.");
    }
  }

  async function loadNews() {
    if (loading || !currentAccess?.client) return;
    loading = true;
    const refreshButton = byId("news-refresh");
    const status = byId("news-status");
    if (refreshButton) {
      refreshButton.disabled = true;
      const label = refreshButton.querySelector("span");
      if (label) label.textContent = "Refreshing…";
    }
    if (status) status.textContent = "Updating…";

    try {
      const [sourcePayload, feedPayload] = await Promise.all([
        invokeReader("listNewsSources", { includeTesting: true }),
        invokeReader("listNewsFeed", {
          includeTesting: true,
          scope: currentScope,
          limit: 50,
          pageSize: 50
        })
      ]);

      const rawSources = extractArray(sourcePayload, ["sources", "newsSources", "results"]);
      const rawItems = extractArray(feedPayload, ["items", "newsItems", "articles", "feed", "results"]);
      const sources = renderSources(rawSources);
      renderItems(rawItems, sources);
      const returnedScope = String(firstValue(feedPayload, ["feedMode", "feed_mode"], currentScope));
      const hasFollows = Boolean(firstValue(feedPayload, ["hasFollows", "has_follows"], sources.some((source) => source.following)));
      currentScope = returnedScope === "following" ? "following" : "all";
      updateScopeButtons(currentScope);
      if (status) {
        if (!hasFollows) {
          status.textContent = "Choose Sources to build your Following feed.";
        } else if (rawItems.length) {
          status.textContent = "Updated just now";
        } else {
          status.textContent = "No stories in this view.";
        }
      }
      saveNewsView(currentScope, rawSources, rawItems, hasFollows);
    } catch (error) {
      console.error("Unable to load News Feed preview", error);
      if (!byId("news-item-list")?.querySelector(".news-item")) {
        renderSources([]);
        renderItems([], []);
      }
      if (status) status.textContent = error?.message || "The News Feed could not be loaded.";
    } finally {
      loading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        const label = refreshButton.querySelector("span");
        if (label) label.textContent = "Refresh Feed";
      }
    }
  }

  function setPullIndicator(distance, state = "pulling") {
    const indicator = byId("news-pull-indicator");
    if (!indicator) return;
    const bounded = Math.max(0, Math.min(distance, 96));
    indicator.style.setProperty("--news-pull-distance", `${bounded}px`);
    indicator.dataset.state = state;
  }

  function resetPullIndicator() {
    pullStartY = null;
    pullDistance = 0;
    window.setTimeout(() => setPullIndicator(0, "idle"), 180);
  }

  function installPullToRefresh() {
    const surface = byId("main-content");
    if (!surface || !window.matchMedia("(max-width: 700px)").matches) return;

    surface.addEventListener("touchstart", (event) => {
      if (pullRefreshing || loading || window.scrollY > 0 || event.touches.length !== 1) return;
      pullStartY = event.touches[0].clientY;
      pullDistance = 0;
    }, { passive: true });

    surface.addEventListener("touchmove", (event) => {
      if (pullStartY === null || event.touches.length !== 1) return;
      const movement = event.touches[0].clientY - pullStartY;
      if (movement <= 0) {
        resetPullIndicator();
        return;
      }
      if (event.cancelable) event.preventDefault();
      pullDistance = Math.min(96, movement * 0.55);
      setPullIndicator(pullDistance, pullDistance >= 64 ? "ready" : "pulling");
    }, { passive: false });

    surface.addEventListener("touchend", async () => {
      if (pullStartY === null) return;
      const shouldRefresh = pullDistance >= 64;
      pullStartY = null;
      if (!shouldRefresh) {
        resetPullIndicator();
        return;
      }
      pullRefreshing = true;
      setPullIndicator(54, "refreshing");
      try {
        await loadNews();
      } finally {
        pullRefreshing = false;
        resetPullIndicator();
      }
    }, { passive: true });

    surface.addEventListener("touchcancel", resetPullIndicator, { passive: true });
  }

  async function changeFollow(button) {
    const sourceId = String(button?.dataset.sourceId || "");
    const following = button?.dataset.following === "true";
    if (!sourceId || !currentAccess?.client) return;

    button.disabled = true;
    button.textContent = following ? "Removing…" : "Following…";

    try {
      await invokeReader(
        following ? "unfollowNewsSource" : "followNewsSource",
        { sourceId }
      );
      clearNewsCache();
      if (!following) currentScope = "following";
      await loadNews();
    } catch (error) {
      console.error("Unable to change followed source", error);
      const status = byId("news-status");
      if (status) status.textContent = error?.message || "The source selection could not be changed.";
      button.disabled = false;
      button.textContent = following ? "Following" : "Follow";
    }
  }

  function normalizeRequest(request) {
    const resolved = firstValue(request, ["resolvedSource", "resolved_source"], {});
    return {
      id: String(firstValue(request, ["id"])),
      sourceName: String(firstValue(request, ["sourceName", "source_name", "requested_source_name"], "Requested source")),
      status: String(firstValue(request, ["status"], "pending")).toLowerCase(),
      adminNotes: String(firstValue(request, ["adminNotes", "admin_notes"])),
      createdAt: firstValue(request, ["createdAt", "created_at"]),
      resolvedName: String(firstValue(resolved, ["name", "sourceName", "source_name"]))
    };
  }

  function renderRequests(rawRequests) {
    const host = byId("news-request-history");
    if (!host) return;
    const requests = rawRequests.map(normalizeRequest);

    if (!requests.length) {
      host.innerHTML = '<p class="news-empty">You haven’t requested a source yet.</p>';
      return;
    }

    host.innerHTML = requests.map((request) => {
      const date = formatDate(request.createdAt);
      const note = request.adminNotes || (request.resolvedName
        ? `Connected to ${request.resolvedName}.`
        : "Your request is being tracked.");
      return `
        <article class="news-request-card">
          <h3>${escapeHtml(request.sourceName)}</h3>
          <span class="news-request-status" data-status="${escapeHtml(request.status)}">${escapeHtml(request.status)}</span>
          <p>${date ? `${escapeHtml(date)} · ` : ""}${escapeHtml(note)}</p>
        </article>`;
    }).join("");
  }

  async function loadRequests(force = false) {
    const host = byId("news-request-history");
    if (!host || (!force && requestsLoaded)) return;
    host.innerHTML = '<p class="news-empty">Loading your requests…</p>';

    try {
      const payload = await invokeReader("listMyNewsSourceRequests");
      const requests = extractArray(payload, ["requests", "sourceRequests", "results"]);
      renderRequests(requests);
      requestsLoaded = true;
    } catch (error) {
      console.error("Unable to load source requests", error);
      host.innerHTML = `<p class="news-empty">${escapeHtml(error?.message || "Your requests could not be loaded.")}</p>`;
    }
  }

  function openRequestDialog() {
    const dialog = byId("news-request-dialog");
    if (!dialog?.open) dialog?.showModal();
    document.body.classList.add("owl-dialog-open");
    window.setTimeout(() => byId("news-request-name")?.focus(), 0);
  }

  function closeRequestDialog() {
    const dialog = byId("news-request-dialog");
    if (dialog?.open) dialog.close();
    document.body.classList.remove("owl-dialog-open");
  }

  async function submitSourceRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = byId("news-request-message");
    const submit = byId("news-request-submit");
    const values = Object.fromEntries(new FormData(form).entries());

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Sending…";
    }
    if (message) message.textContent = "";

    try {
      const result = await invokeReader("submitNewsSourceRequest", {
        sourceName: String(values.sourceName || "").trim(),
        reason: String(values.reason || "").trim()
      });
      if (message) message.textContent = result.message || "Your source request was sent.";
      form.reset();
      requestsLoaded = false;
      await loadRequests(true);
      window.setTimeout(closeRequestDialog, 900);
    } catch (error) {
      console.error("Unable to submit source request", error);
      if (message) message.textContent = error?.message || "The source request could not be sent.";
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Send Request";
      }
    }
  }

  async function initializeNewsFeed() {
    try {
      currentAccess = await getAuthorizedAccess();

      if (!currentAccess) {
        showGate(
          NEWS_BETA_ADMINISTRATOR_ONLY ? "Administrator preview" : "Owl Access required",
          NEWS_BETA_ADMINISTRATOR_ONLY
            ? "Sign in through Owl Access to test the News Feed."
            : "Confirm your Owl Access to choose sources and open your News Feed.",
          "Open Owl Access"
        );
        return;
      }

      if (currentAccess.previewLocked) {
        showGate(
          "News Feed testing",
          "This preview is currently available only to the administrator."
        );
        return;
      }

      showWorkspace();
      if (!restoreNewsView()) {
        await loadNews();
      }
    } catch (error) {
      console.error("News Feed access check failed", error);
      showGate(
        "Owl Access required",
        "Your access could not be confirmed. Please sign in again.",
        "Open Owl Access"
      );
    }
  }

  byId("news-refresh")?.addEventListener("click", () => loadNews());
  byId("news-source-list")?.addEventListener("click", (event) => {
    const button = event.target.closest(".news-follow-button");
    if (button) changeFollow(button);
  });
  byId("news-item-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-share-id]");
    if (button) shareStory(button.dataset.shareId);
  });
  document.querySelectorAll("[data-news-scope]").forEach((button) => {
    button.addEventListener("click", async () => {
      const requestedScope = button.dataset.newsScope;
      if (requestedScope !== "following" && requestedScope !== "all") return;
      if (requestedScope === currentScope) return;
      rememberNewsPosition();
      currentScope = requestedScope;
      updateScopeButtons(currentScope);
      if (!restoreNewsView(requestedScope)) {
        await loadNews();
      }
    });
  });
  byId("news-request-open")?.addEventListener("click", openRequestDialog);
  byId("news-request-form")?.addEventListener("submit", submitSourceRequest);
  byId("news-request-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeRequestDialog();
  });
  document.querySelectorAll("[data-close-news-dialog]").forEach((button) => {
    button.addEventListener("click", closeRequestDialog);
  });
  byId("news-requests-toggle")?.addEventListener("click", async (event) => {
    const host = byId("news-request-history");
    if (!host) return;
    const open = host.hidden;
    host.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
    event.currentTarget.textContent = open ? "Hide Requests" : "My Requests";
    if (open) await loadRequests();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRequestDialog();
  });
  window.addEventListener("strategic-owl-access-change", initializeNewsFeed);
  window.addEventListener("pagehide", rememberNewsPosition);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") rememberNewsPosition();
  });
  installPullToRefresh();
  initializeNewsFeed();
})();
