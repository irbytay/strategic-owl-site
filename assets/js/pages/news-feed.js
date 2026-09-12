(function () {
  "use strict";

  const NEWS_READER_FUNCTION = "news-reader";
  const NEWS_ADMIN_FUNCTION = "news-admin";
  const NEWS_BETA_ADMINISTRATOR_ONLY = false;
  const NEWS_SHARE_BASE_URL = "https://thestrategicowl.com/news";
  const NEWS_READER_API_URL = "https://thestrategicowl.com/api/news-reader";
  const MIN_FULL_READER_LENGTH = 1200;
  const NEWS_CACHE_VERSION = 5;
  const NEWS_CACHE_PREFIX = "strategic-owl-news-feed";
  const NEWS_PAGE_SIZE = 50;

  let currentAccess = null;
  let currentScope = "following";
  let requestsLoaded = false;
  let loading = false;
  let toastTimer = 0;
  let pullStartY = null;
  let pullDistance = 0;
  let pullRefreshing = false;
  let onboardingSources = [];
  let onboardingActive = false;
  let onboardingSourceGroup = "all";
  let loadedSources = [];
  let loadedItems = [];
  let loadedHasFollows = false;
  let selectedSourceId = "";
  const feedFilters = {
    viewpoint: "all",
    category: "",
    contentType: "",
    mediaType: "",
    articleAccess: ""
  };
  let nextBefore = "";
  let hasMore = false;
  let paginationObserver = null;
  let selectedAdminNewsItem = null;
  let activeReaderItem = null;
  let pendingOriginalUrl = "";
  let renderedItemsById = new Map();
  const readerCheckingIds = new Set();
  const readerCheckedIds = new Set();

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
      openItemIds: openNewsItemIds(),
      sourceFilterId: selectedSourceId,
      feedFilters: { ...feedFilters }
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

  function saveNewsView(scope, rawSources, rawItems, hasFollows, nextPageBefore, moreAvailable) {
    const cache = readNewsCache() || {
      version: NEWS_CACHE_VERSION,
      views: {}
    };
    cache.views[scope] = {
      scope,
      sources: rawSources,
      items: rawItems,
      hasFollows,
      nextBefore: nextPageBefore || "",
      hasMore: Boolean(moreAvailable),
      savedAt: Date.now()
    };
    cache.ui = {
      scope,
      scrollY: Math.max(0, window.scrollY || 0),
      openItemIds: openNewsItemIds(),
      sourceFilterId: selectedSourceId,
      feedFilters: { ...feedFilters }
    };
    writeNewsCache(cache);
  }

  function restoreNewsPosition(ui) {
    const openIds = new Set(Array.isArray(ui?.openItemIds) ? ui.openItemIds : []);
    document.querySelectorAll(".news-item[data-item-id]").forEach((item) => {
      item.open = openIds.has(item.dataset.itemId);
      if (item.open) prepareArticleReader(item.dataset.itemId);
    });

    const scrollY = Number(ui?.scrollY || 0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: Math.max(0, scrollY), left: 0, behavior: "auto" });
      });
    });
  }

  function restoreNewsView() {
    const cache = readNewsCache();
    if (!cache) return false;
    const view = cache.views?.following;
    if (!view || !Array.isArray(view.sources) || !Array.isArray(view.items)) return false;

    const sources = renderSources(view.sources);
    const visibleItems = view.hasFollows ? view.items : [];
    selectedSourceId = String(cache.ui?.sourceFilterId || "");
    Object.assign(feedFilters, cache.ui?.feedFilters || {});
    nextBefore = String(view.nextBefore || "");
    hasMore = Boolean(view.hasMore && nextBefore);
    renderItems(visibleItems, sources, { hasFollows: view.hasFollows });
    updatePaginationState();
    currentScope = "following";

    const status = byId("news-status");
    if (status) status.textContent = "";

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
    const toolbar = byId("news-feed-toolbar");
    const pullHint = byId("news-pull-hint");
    if (workspace) workspace.hidden = true;
    if (toolbar) toolbar.hidden = true;
    if (pullHint) pullHint.hidden = true;
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
    const toolbar = byId("news-feed-toolbar");
    const pullHint = byId("news-pull-hint");
    if (gate) gate.hidden = true;
    if (workspace) workspace.hidden = false;
    if (toolbar) toolbar.hidden = false;
    if (pullHint) pullHint.hidden = false;
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

  async function invokeCloudflareReader(articleId) {
    if (!currentAccess?.client || !currentAccess?.owlSession) {
      throw new Error("Owl Access is required.");
    }

    const sessionResult = await currentAccess.client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const session = sessionResult.data?.session || currentAccess.session;
    const accessToken = String(session?.access_token || "").trim();
    if (!accessToken) throw new Error("Your News Feed session has expired.");
    currentAccess.session = session;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(NEWS_READER_API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          articleId,
          email: currentAccess.owlSession.email
        })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "The Reader is unavailable right now.");
      }
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function invokeNewsAdmin(action, values = {}) {
    if (!currentAccess?.administrator || !currentAccess?.client) {
      throw new Error("Administrator access is required.");
    }

    const { data, error } = await currentAccess.client.functions.invoke(
      NEWS_ADMIN_FUNCTION,
      { body: { action, ...values } }
    );

    if (error) {
      let message = error.message || "The news administration request failed.";
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
      throw new Error(data.error || "The news administration request failed.");
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
      mediaType: String(firstValue(source, ["defaultMediaType", "default_media_type", "mediaType", "media_type"])),
      articleAccess: String(firstValue(source, ["articleAccess", "article_access"])).toLowerCase(),
      websiteUrl: safeUrl(firstValue(source, ["websiteUrl", "website_url"])),
      following: Boolean(firstValue(source, ["following", "isFollowing", "is_following"], false))
    };
  }

  function sourceGroups(source) {
    const groups = new Set();
    const alignment = String(source.alignment || "").trim().toLowerCase();
    const contentType = String(source.contentType || "").trim().toLowerCase();

    if (alignment === "left" || alignment === "center-left") groups.add("left");
    if (["center", "nonpartisan", "mixed"].includes(alignment)) groups.add("middle");
    if (["center-right", "right", "populist right"].includes(alignment)) groups.add("right");
    if (contentType === "primary source") groups.add("primary");
    return groups;
  }

  function renderSourceDashboard(sources) {
    const activeSources = sources.filter((source) => source.status === "active");
    const totalFor = (group) => activeSources.filter((source) => sourceGroups(source).has(group)).length;
    const metrics = [
      ["Left", totalFor("left")],
      ["Middle", totalFor("middle")],
      ["Right", totalFor("right")],
      ["Primary", totalFor("primary")]
    ];

    return `
      <section class="news-source-dashboard" aria-label="Available source overview">
        <div class="news-source-dashboard-heading">
          <span class="news-source-dashboard-mark" aria-hidden="true">
            <img src="assets/images/3X.png" alt="" />
          </span>
          <div>
            <strong>${activeSources.length} active ${activeSources.length === 1 ? "source" : "sources"}</strong>
            <p>Available for your News Feed</p>
          </div>
        </div>
        <div class="news-source-dashboard-metrics">
          ${metrics.map(([label, total]) => `<span><strong>${total}</strong><small>${label}</small></span>`).join("")}
        </div>
        <p class="news-source-dashboard-note">Each source is labeled so you can choose your own mix.</p>
      </section>`;
  }

  function renderOnboardingViewpoints() {
    const groups = [
      ["all", "All"],
      ["left", "Left"],
      ["middle", "Middle"],
      ["right", "Right"],
      ["primary", "Primary"]
    ];
    return `
      <nav class="news-onboarding-viewpoints" aria-label="Filter sources by viewpoint">
        ${groups.map(([value, label]) => `
          <button
            type="button"
            data-onboarding-source-group="${value}"
            aria-pressed="${String(value === onboardingSourceGroup)}"
          >${label}</button>`).join("")}
      </nav>`;
  }

  function normalizeItem(item, sourceMap) {
    const nestedSource = firstValue(item, ["source", "newsSource", "news_sources"], {});
    const sourceId = String(firstValue(item, ["sourceId", "source_id"], firstValue(nestedSource, ["id"])));
    const mappedSource = sourceMap.get(sourceId) || {};
    const media = Array.isArray(item?.media) ? item.media[0] || {} : {};
    const rawInsight = firstValue(item, ["owlInsight", "owl_insight"], null);
    const insightAnalysis = String(firstValue(rawInsight, ["owlAnalysis", "owl_analysis", "analysis"]));
    const rawReader = firstValue(item, ["reader", "readerResult", "reader_result"], {});
    const contentText = String(firstValue(item, ["contentText", "content_text", "content"]));
    const summaryText = String(firstValue(item, ["summaryText", "summary_text", "summary", "excerpt"]));
    const suppliedReaderText = String(firstValue(rawReader, ["text", "readerText", "reader_text"]));
    const readerText = suppliedReaderText || (contentText.length >= summaryText.length ? contentText : summaryText);
    const rawReaderMode = String(firstValue(
      rawReader,
      ["mode", "readerMode", "reader_mode"],
      firstValue(item, ["readerMode", "reader_mode"])
    )).trim().toLowerCase();
    const readerMode = rawReaderMode === "reader"
      ? "full"
      : rawReaderMode || (readerText.length >= MIN_FULL_READER_LENGTH ? "full" : "preview");

    return {
      id: String(firstValue(item, ["id", "newsItemId", "news_item_id"])),
      headline: String(firstValue(item, ["headline", "title"], "Untitled story")),
      summary: summaryText,
      publishedAt: firstValue(item, ["publishedAt", "published_at", "sourceUpdatedAt", "source_updated_at"]),
      originalUrl: safeUrl(firstValue(item, ["canonicalUrl", "canonical_url", "articleLink", "article_link", "url"])),
      imageUrl: safeUrl(firstValue(item, ["primaryMediaUrl", "primary_media_url", "thumbnailUrl", "thumbnail_url", "imageUrl", "image_url"], firstValue(media, ["url", "mediaUrl", "media_url"]))),
      authors: normalizeStringList(firstValue(item, ["authors", "author", "byline"], [])),
      categories: normalizeStringList(firstValue(item, ["categories", "category"], [])),
      sourceName: String(firstValue(nestedSource, ["sourceName", "source_name", "name"], mappedSource.name || firstValue(item, ["sourceName", "source_name"], "News Source"))),
      sourceId,
      sourceStatus: String(firstValue(nestedSource, ["status"], mappedSource.status || firstValue(item, ["sourceStatus", "source_status"], "active"))).toLowerCase(),
      articleAccess: String(firstValue(nestedSource, ["articleAccess", "article_access"], mappedSource.articleAccess || firstValue(item, ["articleAccess", "article_access"]))).toLowerCase(),
      readerMode,
      readerText,
      readerTextSource: String(firstValue(
        rawReader,
        ["textSource", "text_source", "source"],
        firstValue(item, ["readerTextSource", "reader_text_source"])
      )).trim().toLowerCase(),
      readerTextLength: Number(firstValue(
        rawReader,
        ["textLength", "text_length", "length"],
        firstValue(item, ["readerTextLength", "reader_text_length"], readerText.length)
      )) || readerText.length,
      owlInsight: insightAnalysis ? {
        label: String(firstValue(rawInsight, ["owlLabel", "owl_label"], "Owl Insight")),
        labels: normalizeStringList(firstValue(rawInsight, ["labels"], [])),
        analysis: insightAnalysis,
        public: Boolean(firstValue(rawInsight, ["public", "isPublic", "is_public"], false))
      } : null
    };
  }

  function renderSources(rawSources) {
    const sources = rawSources
      .map(normalizeSource)
      .sort((left, right) => left.name.localeCompare(right.name));
    return sources;
  }

  const ARTICLE_ACCESS_LABELS = {
    free: "Free to read",
    limited: "Some free access",
    subscription: "Subscription required"
  };

  function articleAccessLabel(value) {
    return ARTICLE_ACCESS_LABELS[String(value || "").trim().toLowerCase()] || "";
  }

  function hasMeaningfulPreviewText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    const normalized = text.toLowerCase().replace(/[.!]+$/, "");
    return ![
      "open the original source to read this story",
      "open the original source to read the full story",
      "read the full article at the original source",
      "read more at the original source"
    ].includes(normalized);
  }

  function hasMeaningfulPreview(item) {
    return hasMeaningfulPreviewText(item?.summary);
  }

  function renderArticleActions(item) {
    const fullReader = hasFullReader(item);
    const preview = hasMeaningfulPreview(item);
    const readerControl = fullReader
      ? `<button class="news-item-action news-item-action--primary" type="button" data-open-reader-id="${escapeHtml(item.id)}" aria-label="Read the full article here">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22Z"></path><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22Z"></path></svg>
          <span>Full Read</span>
        </button>`
      : "";
    const originalLabel = fullReader
      ? "Original"
      : preview
        ? "Continue at Source"
        : "Read at Source";
    const originalButton = item.originalUrl
      ? `<button class="news-item-action${fullReader ? "" : " news-item-action--primary"}" type="button" data-original-url="${escapeHtml(item.originalUrl)}" data-original-source="${escapeHtml(item.sourceName)}" aria-label="${escapeHtml(originalLabel)} at ${escapeHtml(item.sourceName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"></path><path d="m19 5-9 9"></path><path d="M19 13v6H5V5h6"></path></svg>
          <span>${escapeHtml(originalLabel)}</span>
        </button>`
      : "";
    const canShare = item.sourceStatus === "active" && Boolean(item.id);
    const shareButton = `<button class="news-item-action" type="button"${canShare
      ? ` data-share-id="${escapeHtml(item.id)}" aria-label="Share this article"`
      : " disabled title=\"Sharing becomes available after this source is approved\""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="m8 8 4-4 4 4"></path><path d="M5 12v7h14v-7"></path></svg>
        <span>Share</span>
      </button>`;
    const insightButton = currentAccess?.administrator
      ? `<button class="news-item-action" type="button" data-admin-insight-id="${escapeHtml(item.id)}" aria-label="${item.owlInsight ? "Edit" : "Add"} Owl Insight">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8Z"></path><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"></path></svg>
          <span>Insight</span>
        </button>`
      : "";

    return `${readerControl}${originalButton}${shareButton}${insightButton}`;
  }

  function distinctFollowedValues(sources, key) {
    return Array.from(new Set(
      sources
        .filter((source) => source.following)
        .map((source) => String(source[key] || "").trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));
  }

  function populateFeedFilter(id, sources, key, allLabel, labelForValue = (value) => value) {
    const select = byId(id);
    if (!select) return;
    const current = String(feedFilters[key] || "");
    const values = distinctFollowedValues(sources, key);
    select.innerHTML = [
      `<option value="">${escapeHtml(allLabel)}</option>`,
      ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelForValue(value))}</option>`)
    ].join("");
    if (current && values.includes(current)) {
      select.value = current;
    } else {
      feedFilters[key] = "";
      select.value = "";
    }
  }

  function activeFeedFilterCount() {
    return [
      feedFilters.viewpoint !== "all" ? feedFilters.viewpoint : "",
      feedFilters.category,
      feedFilters.contentType,
      feedFilters.mediaType,
      feedFilters.articleAccess
    ].filter(Boolean).length;
  }

  function updateFeedFilterCount() {
    const count = activeFeedFilterCount();
    const badge = byId("news-feed-filter-count");
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
  }

  function configureFeedFilters(sources, hasFollows) {
    const viewpoint = byId("news-feed-viewpoint-filter");
    if (viewpoint) viewpoint.value = feedFilters.viewpoint || "all";
    populateFeedFilter("news-feed-category-filter", sources, "category", "All categories");
    populateFeedFilter("news-feed-content-filter", sources, "contentType", "All content");
    populateFeedFilter("news-feed-media-filter", sources, "mediaType", "All media");
    populateFeedFilter("news-feed-access-filter", sources, "articleAccess", "All access", articleAccessLabel);
    updateFeedFilterCount();

    const moreFilters = byId("news-feed-more-filters");
    if (moreFilters) moreFilters.hidden = !hasFollows;
    if (!hasFollows) {
      const filterPanel = byId("news-feed-filter-panel");
      if (filterPanel) filterPanel.hidden = true;
      moreFilters?.setAttribute("aria-expanded", "false");
    }
  }

  function readFeedFilterControls() {
    feedFilters.viewpoint = String(byId("news-feed-viewpoint-filter")?.value || "all");
    feedFilters.category = String(byId("news-feed-category-filter")?.value || "");
    feedFilters.contentType = String(byId("news-feed-content-filter")?.value || "");
    feedFilters.mediaType = String(byId("news-feed-media-filter")?.value || "");
    feedFilters.articleAccess = String(byId("news-feed-access-filter")?.value || "");
    updateFeedFilterCount();
  }

  function resetFeedFilterControls() {
    Object.assign(feedFilters, {
      viewpoint: "all",
      category: "",
      contentType: "",
      mediaType: "",
      articleAccess: ""
    });
    [
      ["news-feed-viewpoint-filter", "all"],
      ["news-feed-category-filter", ""],
      ["news-feed-content-filter", ""],
      ["news-feed-media-filter", ""],
      ["news-feed-access-filter", ""]
    ].forEach(([id, value]) => {
      const control = byId(id);
      if (control) control.value = value;
    });
    updateFeedFilterCount();
  }

  function followButtonContent(following, pending = "") {
    const icon = following ? "✓" : "+";
    const label = pending || (following ? "Following" : "Follow");
    return `<span class="news-follow-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  }

  function onboardingSelectionCount() {
    return onboardingSources.filter((source) => source.following).length;
  }

  function updateOnboardingAction() {
    const button = byId("news-view-selected");
    if (!button) return;
    const count = onboardingSelectionCount();
    button.hidden = count === 0;
    button.textContent = `View My News (${count})`;
  }

  function onboardingButtonContent(following, pending = "") {
    if (pending) return `<span>${escapeHtml(pending)}</span>`;
    if (following) return '<span class="news-follow-icon" aria-hidden="true">✓</span>';
    return '<span class="news-follow-icon" aria-hidden="true">+</span><span>Follow</span>';
  }

  function renderSourceChoices(sources) {
    if (!sources.length) {
      return '<p class="news-empty">No sources are available yet.</p>';
    }

    const visibleSources = onboardingSourceGroup === "all"
      ? sources
      : sources.filter((source) => sourceGroups(source).has(onboardingSourceGroup));
    if (!visibleSources.length) {
      return '<p class="news-empty">No sources are available in this group.</p>';
    }

    return visibleSources.map((source) => {
      const details = [source.alignment, source.category, source.contentType].filter(Boolean).join(" · ");
      const access = articleAccessLabel(source.articleAccess);
      const testing = currentAccess?.administrator && source.status === "testing"
        ? '<span class="news-source-row-status">Testing</span>'
        : "";
      const actionLabel = source.following ? `Remove ${source.name}` : `Follow ${source.name}`;

      return `
        <article class="news-onboarding-source-row" data-selected="${String(source.following)}">
          <div>
            <div class="news-source-row-title">
              <h3>${escapeHtml(source.name)}</h3>
              ${testing}
            </div>
            ${details ? `<p>${escapeHtml(details)}</p>` : '<p class="news-source-detail-empty">Source details pending</p>'}
            ${access ? `<span class="news-source-access" data-access="${escapeHtml(source.articleAccess)}">${escapeHtml(access)}</span>` : ""}
          </div>
          <button
            class="news-follow-button"
            type="button"
            data-source-id="${escapeHtml(source.id)}"
            data-following="${String(source.following)}"
            aria-label="${escapeHtml(actionLabel)}"
            aria-pressed="${String(source.following)}"
          >${onboardingButtonContent(source.following)}</button>
        </article>`;
    }).join("");
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

  function configureSourceFilter(sources, hasFollows) {
    const host = byId("news-feed-filter");
    const select = byId("news-source-filter");
    if (!host || !select) return;

    const followedSources = sources.filter((source) => source.following);
    const validSourceIds = new Set(followedSources.map((source) => source.id));
    if (selectedSourceId && !validSourceIds.has(selectedSourceId)) {
      selectedSourceId = "";
    }

    select.innerHTML = [
      '<option value="">All Followed Sources</option>',
      ...followedSources.map((source) => (
        `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)}</option>`
      ))
    ].join("");
    select.value = selectedSourceId;
    host.hidden = !hasFollows || followedSources.length < 2;
    configureFeedFilters(sources, hasFollows);
  }

  function updatePaginationState() {
    const sentinel = byId("news-load-more");
    if (!sentinel) return;
    sentinel.hidden = !hasMore || !nextBefore || !loadedHasFollows;
    sentinel.dataset.loading = String(loading);
  }

  function mergeNewsItems(existingItems, newItems) {
    const merged = new Map();
    [...existingItems, ...newItems].forEach((item) => {
      const id = String(firstValue(item, ["id", "newsItemId", "news_item_id"]));
      if (id && !merged.has(id)) merged.set(id, item);
    });
    return Array.from(merged.values());
  }

  function renderItems(rawItems, sources, { hasFollows = true } = {}) {
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const allItems = rawItems.map((item) => normalizeItem(item, sourceMap));
    renderedItemsById = new Map(allItems.map((item) => [item.id, item]));
    loadedSources = sources;
    loadedItems = rawItems;
    loadedHasFollows = hasFollows;
    configureSourceFilter(sources, hasFollows);
    const items = selectedSourceId
      ? allItems.filter((item) => item.sourceId === selectedSourceId)
      : allItems;
    const host = byId("news-item-list");
    const count = byId("news-item-count");
    if (count) count.textContent = String(items.length);
    if (!host) return;

    if (!items.length) {
      onboardingActive = !hasFollows;
      onboardingSources = onboardingActive ? sources : [];
      const selectedSource = sources.find((source) => source.id === selectedSourceId);
      host.innerHTML = hasFollows
        ? `<p class="news-empty">${selectedSource
            ? `No recent stories from ${escapeHtml(selectedSource.name)}.`
            : "No recent stories from your sources."}</p>`
        : `<section class="news-feed-onboarding" aria-labelledby="news-following-empty-title">
            <div class="news-feed-onboarding-heading">
              <h3 id="news-following-empty-title">Choose Your Sources</h3>
              <p>Follow one or more sources to build your news feed.</p>
            </div>
            ${renderSourceDashboard(sources)}
            ${renderOnboardingViewpoints()}
            <div class="news-onboarding-source-list" id="news-onboarding-source-list">
              ${renderSourceChoices(sources)}
            </div>
            <div class="news-onboarding-actions">
              <button class="news-view-selected" id="news-view-selected" type="button" hidden>View My News (0)</button>
            </div>
          </section>`;
      updateOnboardingAction();
      return;
    }

    onboardingActive = false;
    onboardingSources = [];

    host.innerHTML = items.map((item) => {
      const image = item.imageUrl
        ? `<img class="news-item-image" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" />`
        : `<span class="news-item-image-placeholder"><img src="assets/images/3X.png" alt="" /></span>`;
      const published = formatDate(item.publishedAt);
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
      const accessLabel = articleAccessLabel(item.articleAccess);
      const accessMarkup = accessLabel
        ? `<span class="news-item-access" data-access="${escapeHtml(item.articleAccess)}">· ${escapeHtml(accessLabel)}</span>`
        : "";

      return `
        <details class="news-item" data-item-id="${escapeHtml(item.id)}">
          <summary class="news-item-summary">
            ${image}
            <div class="news-item-copy">
              <p class="news-item-source"><span>${escapeHtml(item.sourceName)}${item.sourceStatus === "testing" ? " · Testing" : ""}</span>${accessMarkup}</p>
              <h3>${escapeHtml(item.headline)}</h3>
              ${published ? `<p class="news-item-date">${escapeHtml(published)}</p>` : ""}
            </div>
            <span class="news-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>
            </span>
          </summary>
          <div class="news-item-details">
            ${metadataMarkup}
            ${hasMeaningfulPreview(item) ? `<p>${escapeHtml(item.summary)}</p>` : ""}
            ${insightMarkup}
            <div class="news-item-actions" aria-label="Article actions">
              ${renderArticleActions(item)}
            </div>
          </div>
        </details>`;
    }).join("");

    installImageFallbacks(host);
  }

  function hasFullReader(item) {
    return Boolean(
      item &&
      item.readerMode === "full" &&
      String(item.readerText || "").trim().length >= MIN_FULL_READER_LENGTH
    );
  }

  function renderReaderText(text) {
    const host = byId("news-reader-copy");
    if (!host) return;
    const paragraphs = String(text || "")
      .trim()
      .split(/\n{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);
    host.replaceChildren(...paragraphs.map((paragraph) => {
      const element = document.createElement("p");
      element.textContent = paragraph;
      return element;
    }));
  }

  function openArticleReader(item) {
    if (!hasFullReader(item)) return;
    activeReaderItem = item;
    byId("news-reader-title").textContent = item.headline || "Article";
    byId("news-reader-attribution").textContent = `Content provided by ${item.sourceName || "the source"}`;
    renderReaderText(item.readerText);

    const original = byId("news-reader-original");
    const originalUrl = safeUrl(item.originalUrl);
    original.hidden = !originalUrl;
    original.textContent = originalUrl
      ? `View Original at ${item.sourceName || "Source"}`
      : "";
    original.dataset.originalUrl = originalUrl;
    original.dataset.originalSource = item.sourceName || "the publisher";
    byId("news-reader-message").textContent = "";

    const dialog = byId("news-reader-dialog");
    if (!dialog?.open) dialog?.showModal();
    syncNewsDialogState();
    window.setTimeout(() => dialog?.querySelector("[data-close-news-reader]")?.focus(), 0);
  }

  function closeArticleReader() {
    const dialog = byId("news-reader-dialog");
    if (dialog?.open) dialog.close();
    activeReaderItem = null;
    syncNewsDialogState();
  }

  function updateArticleActions(itemId) {
    const item = renderedItemsById.get(String(itemId || ""));
    if (!item) return;
    const card = Array.from(document.querySelectorAll(".news-item[data-item-id]"))
      .find((element) => element.dataset.itemId === item.id);
    const actions = card?.querySelector(".news-item-actions");
    if (actions) actions.innerHTML = renderArticleActions(item);
  }

  async function prepareArticleReader(itemId) {
    const item = renderedItemsById.get(String(itemId || ""));
    if (
      !item ||
      hasFullReader(item) ||
      readerCheckingIds.has(item.id) ||
      readerCheckedIds.has(item.id)
    ) return;

    readerCheckingIds.add(item.id);
    try {
      const result = await invokeCloudflareReader(item.id);
      const reader = result?.reader && typeof result.reader === "object"
        ? result.reader
        : {};
      const readerText = String(firstValue(reader, ["text", "readerText", "reader_text"])).trim();
      const rawReaderMode = String(firstValue(reader, ["mode", "readerMode", "reader_mode"])).trim().toLowerCase();
      const resolvedReaderMode = rawReaderMode === "reader" ? "full" : rawReaderMode;
      const updatedItem = {
        ...item,
        originalUrl: safeUrl(result?.originalUrl) || item.originalUrl,
        readerMode: resolvedReaderMode,
        readerText,
        readerTextSource: String(firstValue(reader, ["textSource", "text_source", "source"])).trim().toLowerCase(),
        readerTextLength: Number(firstValue(reader, ["textLength", "text_length", "length"], readerText.length)) || readerText.length
      };
      renderedItemsById.set(item.id, updatedItem);
    } catch (error) {
      console.error("Article reader check failed", error);
    } finally {
      readerCheckingIds.delete(item.id);
      readerCheckedIds.add(item.id);
      updateArticleActions(item.id);
    }
  }

  function researchPromptFor(item) {
    return `Research this article using current, reliable sources and help me understand it clearly.

Title: ${item.headline || "Untitled article"}
Publisher: ${item.sourceName || "Unknown publisher"}
Original URL: ${item.originalUrl || "Not available"}

Please:
1. A concise explanation of the article's central claim or development.
2. Verify its most important factual claims.
3. Separate established facts from allegations, opinions, predictions, and uncertainty.
4. Explain the broader consensus among reliable sources and identify meaningful disagreement.
5. Provide relevant historical or legal context.
6. Identify important context the article may have omitted.
7. Link to primary records and reliable sources whenever possible.

Use clear, approachable, nonpartisan language. Do not assume the article, headline, or institutional claims are accurate without checking the evidence. If you cannot access the article, say so and research the reported subject using the title, publisher, and URL.`;
  }

  async function copyResearchPrompt() {
    if (!activeReaderItem) return;
    const message = byId("news-reader-message");
    try {
      await copyShareUrl(researchPromptFor(activeReaderItem));
      if (message) message.textContent = "Research prompt copied.";
    } catch (error) {
      console.error("Unable to copy research prompt", error);
      if (message) message.textContent = "The prompt could not be copied.";
    }
  }

  function openLeavingDialog(value, sourceName = "the publisher") {
    const url = safeUrl(value);
    if (!url) return;
    pendingOriginalUrl = url;
    const continueButton = byId("news-leaving-continue");
    if (continueButton) {
      continueButton.textContent = `Continue to ${sourceName || "Source"}`;
    }
    const dialog = byId("news-leaving-dialog");
    if (!dialog?.open) dialog?.showModal();
    syncNewsDialogState();
    window.setTimeout(() => continueButton?.focus(), 0);
  }

  function closeLeavingDialog() {
    const dialog = byId("news-leaving-dialog");
    if (dialog?.open) dialog.close();
    pendingOriginalUrl = "";
    syncNewsDialogState();
  }

  function continueToOriginal() {
    const url = pendingOriginalUrl;
    closeLeavingDialog();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
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

  function syncNewsDialogState() {
    document.body.classList.toggle(
      "owl-dialog-open",
      Boolean(document.querySelector(".news-dialog[open]"))
    );
  }

  function closeNewsInsightDialog() {
    const dialog = byId("news-insight-dialog");
    if (dialog?.open) dialog.close();
    syncNewsDialogState();
  }

  function syncInsightPublicControl() {
    const published = byId("news-insight-status")?.value === "published";
    const checkbox = byId("news-insight-public");
    if (!checkbox) return;
    checkbox.disabled = !published;
    if (!published) checkbox.checked = false;
  }

  function setInsightBusy(button, busy, busyLabel, readyLabel) {
    if (!button) return;
    button.disabled = busy;
    const nestedLabel = button.matches(".news-item-action")
      ? button.querySelector("span")
      : null;
    if (nestedLabel) {
      nestedLabel.textContent = busy ? busyLabel : readyLabel;
    } else {
      button.textContent = busy ? busyLabel : readyLabel;
    }
  }

  async function openNewsInsight(itemId, trigger) {
    if (!currentAccess?.administrator) return;
    const originalLabel = trigger?.querySelector("span")?.textContent || trigger?.textContent?.trim() || "Add Insight";
    setInsightBusy(trigger, true, "Opening…", originalLabel);

    try {
      const result = await invokeNewsAdmin("getNewsItem", { itemId });
      selectedAdminNewsItem = result.item || null;
      if (!selectedAdminNewsItem) {
        throw new Error("The article could not be found.");
      }

      const insight = selectedAdminNewsItem.insight || {};
      byId("news-insight-title").textContent = selectedAdminNewsItem.headline || "Owl Insight";
      byId("news-insight-source").textContent = selectedAdminNewsItem.source?.source_name || "News article";
      byId("news-insight-item-id").value = selectedAdminNewsItem.id;
      byId("news-insight-label").value = insight.owl_label || "";
      byId("news-insight-labels").value = Array.isArray(insight.labels)
        ? insight.labels.join(", ")
        : "";
      byId("news-insight-analysis").value = insight.owl_analysis || "";
      byId("news-insight-status").value = insight.review_status === "published"
        ? "published"
        : "draft";
      byId("news-insight-public").checked = Boolean(insight.is_public);
      byId("news-insight-hide").hidden = !selectedAdminNewsItem.insight || insight.review_status === "hidden";
      byId("news-insight-message").textContent = "";
      syncInsightPublicControl();

      const original = byId("news-insight-original");
      const originalUrl = safeUrl(selectedAdminNewsItem.canonical_url);
      original.hidden = !originalUrl;
      original.dataset.originalUrl = originalUrl;
      original.dataset.originalSource = selectedAdminNewsItem.source?.source_name || "the publisher";

      const dialog = byId("news-insight-dialog");
      if (!dialog?.open) dialog?.showModal();
      syncNewsDialogState();
      window.setTimeout(() => byId("news-insight-label")?.focus(), 0);
    } catch (error) {
      console.error("News article load failed", error);
      showToast(error?.message || "The article could not be loaded.");
    } finally {
      setInsightBusy(trigger, false, "Opening…", originalLabel);
    }
  }

  async function saveNewsInsight(event) {
    event.preventDefault();
    const button = byId("news-insight-save");
    const message = byId("news-insight-message");
    const labels = byId("news-insight-labels").value
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    setInsightBusy(button, true, "Saving…", "Save Insight");
    message.textContent = "";

    try {
      await invokeNewsAdmin("saveNewsInsight", {
        itemId: byId("news-insight-item-id").value,
        owlLabel: byId("news-insight-label").value.trim(),
        labels,
        owlAnalysis: byId("news-insight-analysis").value.trim(),
        reviewStatus: byId("news-insight-status").value,
        public: byId("news-insight-public").checked
      });
      closeNewsInsightDialog();
      clearNewsCache();
      await loadNews();
      showToast("Owl Insight saved.");
    } catch (error) {
      console.error("Owl Insight save failed", error);
      message.textContent = error?.message || "The Owl Insight could not be saved.";
    } finally {
      setInsightBusy(button, false, "Saving…", "Save Insight");
    }
  }

  async function hideNewsInsight() {
    const button = byId("news-insight-hide");
    const message = byId("news-insight-message");
    const itemId = byId("news-insight-item-id")?.value;
    if (!itemId) return;
    setInsightBusy(button, true, "Hiding…", "Hide Insight");
    message.textContent = "";

    try {
      await invokeNewsAdmin("hideNewsInsight", { itemId });
      closeNewsInsightDialog();
      clearNewsCache();
      await loadNews();
      showToast("Owl Insight hidden.");
    } catch (error) {
      console.error("Owl Insight hide failed", error);
      message.textContent = error?.message || "The Owl Insight could not be hidden.";
    } finally {
      setInsightBusy(button, false, "Hiding…", "Hide Insight");
    }
  }

  async function loadNews({ append = false } = {}) {
    if (loading || !currentAccess?.client) return;
    if (append && (!hasMore || !nextBefore)) return;
    loading = true;
    updatePaginationState();
    const refreshButton = byId("news-refresh");
    const status = byId("news-status");
    if (refreshButton) {
      refreshButton.disabled = true;
      const label = refreshButton.querySelector("span");
      if (label) label.textContent = "Refreshing…";
    }
    if (status && !append) status.textContent = "Updating…";

    try {
      let rawSources = loadedSources;
      let sources = loadedSources;

      if (!append) {
        const sourcePayload = await invokeReader("listNewsSources", { includeTesting: true });
        rawSources = extractArray(sourcePayload, ["sources", "newsSources", "results"]);
        sources = renderSources(rawSources);

        const followedSourceIds = new Set(
          sources.filter((source) => source.following).map((source) => source.id)
        );
        if (selectedSourceId && !followedSourceIds.has(selectedSourceId)) {
          selectedSourceId = "";
        }
      }

      const feedPayload = await invokeReader("listNewsFeed", {
        includeTesting: true,
        scope: "following",
        limit: NEWS_PAGE_SIZE,
        pageSize: NEWS_PAGE_SIZE,
        ...(selectedSourceId ? { sourceId: selectedSourceId } : {}),
        ...(feedFilters.viewpoint !== "all" ? { viewpoint: feedFilters.viewpoint } : {}),
        ...(feedFilters.category ? { sourceCategory: feedFilters.category } : {}),
        ...(feedFilters.contentType ? { sourceContentType: feedFilters.contentType } : {}),
        ...(feedFilters.mediaType ? { sourceMediaType: feedFilters.mediaType } : {}),
        ...(feedFilters.articleAccess ? { articleAccess: feedFilters.articleAccess } : {}),
        ...(append && nextBefore ? { before: nextBefore } : {})
      });

      const pageItems = extractArray(feedPayload, ["items", "newsItems", "articles", "feed", "results"]);
      const hasFollows = Boolean(firstValue(feedPayload, ["hasFollows", "has_follows"], sources.some((source) => source.following)));
      const visibleItems = hasFollows
        ? (append ? mergeNewsItems(loadedItems, pageItems) : pageItems)
        : [];
      const preservedUi = append
        ? { scrollY: window.scrollY || 0, openItemIds: openNewsItemIds() }
        : null;

      nextBefore = String(firstValue(feedPayload, ["nextBefore", "next_before"], ""));
      hasMore = Boolean(firstValue(
        feedPayload,
        ["hasMore", "has_more"],
        pageItems.length === NEWS_PAGE_SIZE && Boolean(nextBefore)
      )) && Boolean(nextBefore);

      renderItems(visibleItems, sources, { hasFollows });
      if (preservedUi) restoreNewsPosition(preservedUi);
      currentScope = "following";
      if (status) status.textContent = "";
      saveNewsView(currentScope, rawSources, visibleItems, hasFollows, nextBefore, hasMore);
    } catch (error) {
      console.error("Unable to load News Feed preview", error);
      if (append) {
        hasMore = false;
        showToast(error?.message || "More stories could not be loaded.");
      } else if (!byId("news-item-list")?.querySelector(".news-item")) {
        renderSources([]);
        renderItems([], []);
      }
      if (status && !append) status.textContent = error?.message || "The News Feed could not be loaded.";
    } finally {
      loading = false;
      updatePaginationState();
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

  function installInfiniteScroll() {
    const sentinel = byId("news-load-more");
    if (!sentinel || !("IntersectionObserver" in window)) return;
    paginationObserver?.disconnect();
    paginationObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadNews({ append: true });
      }
    }, { rootMargin: "500px 0px" });
    paginationObserver.observe(sentinel);
  }

  async function changeFollow(button) {
    const sourceId = String(button?.dataset.sourceId || "");
    const following = button?.dataset.following === "true";
    if (!sourceId || !currentAccess?.client) return;

    button.disabled = true;
    button.innerHTML = onboardingActive
      ? onboardingButtonContent(following, following ? "Removing…" : "Adding…")
      : followButtonContent(following, following ? "Removing…" : "Following…");

    try {
      await invokeReader(
        following ? "unfollowNewsSource" : "followNewsSource",
        { sourceId }
      );
      clearNewsCache();
      if (onboardingActive) {
        const source = onboardingSources.find((entry) => entry.id === sourceId);
        if (source) source.following = !following;
        button.dataset.following = String(!following);
        button.setAttribute("aria-pressed", String(!following));
        button.setAttribute("aria-label", `${following ? "Follow" : "Remove"} ${source?.name || "source"}`);
        button.innerHTML = onboardingButtonContent(!following);
        button.disabled = false;
        button.closest(".news-onboarding-source-row")?.setAttribute("data-selected", String(!following));
        updateOnboardingAction();
        return;
      }
      if (!following) currentScope = "following";
      await loadNews();
    } catch (error) {
      console.error("Unable to change followed source", error);
      const status = byId("news-status");
      if (status) status.textContent = error?.message || "The source selection could not be changed.";
      button.disabled = false;
      button.innerHTML = onboardingActive
        ? onboardingButtonContent(following)
        : followButtonContent(following);
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
            : "You choose the sources. Stories are shown newest first. No algorithm decides what you see. Follow or remove sources anytime, request new ones, and read Owl Insights alongside the reporting. No ads. No algorithms.",
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
  byId("news-source-filter")?.addEventListener("change", (event) => {
    selectedSourceId = String(event.currentTarget.value || "");
    nextBefore = "";
    hasMore = false;
    loadNews();
  });
  byId("news-feed-more-filters")?.addEventListener("click", (event) => {
    const panel = byId("news-feed-filter-panel");
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  byId("news-feed-apply-filters")?.addEventListener("click", () => {
    readFeedFilterControls();
    nextBefore = "";
    hasMore = false;
    const panel = byId("news-feed-filter-panel");
    if (panel) panel.hidden = true;
    byId("news-feed-more-filters")?.setAttribute("aria-expanded", "false");
    loadNews();
  });
  byId("news-feed-clear-filters")?.addEventListener("click", () => {
    resetFeedFilterControls();
    nextBefore = "";
    hasMore = false;
    loadNews();
  });
  byId("news-item-list")?.addEventListener("click", (event) => {
    const sourceGroupButton = event.target.closest("[data-onboarding-source-group]");
    if (sourceGroupButton) {
      onboardingSourceGroup = sourceGroupButton.dataset.onboardingSourceGroup || "all";
      document.querySelectorAll("[data-onboarding-source-group]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.onboardingSourceGroup === onboardingSourceGroup));
      });
      const sourceList = byId("news-onboarding-source-list");
      if (sourceList) sourceList.innerHTML = renderSourceChoices(onboardingSources);
      return;
    }
    const viewSelected = event.target.closest("#news-view-selected");
    if (viewSelected) {
      loadNews();
      return;
    }
    const followButton = event.target.closest(".news-follow-button");
    if (followButton) {
      changeFollow(followButton);
      return;
    }
    const summary = event.target.closest(".news-item-summary");
    if (summary) {
      const article = summary.closest(".news-item[data-item-id]");
      if (article && !article.open) {
        window.setTimeout(() => prepareArticleReader(article.dataset.itemId), 0);
      }
      return;
    }
    const readerButton = event.target.closest("[data-open-reader-id]");
    if (readerButton) {
      const item = renderedItemsById.get(readerButton.dataset.openReaderId);
      if (item) openArticleReader(item);
      return;
    }
    const originalButton = event.target.closest("[data-original-url]");
    if (originalButton) {
      openLeavingDialog(originalButton.dataset.originalUrl, originalButton.dataset.originalSource);
      return;
    }
    const insightButton = event.target.closest("[data-admin-insight-id]");
    if (insightButton) {
      openNewsInsight(insightButton.dataset.adminInsightId, insightButton);
      return;
    }
    const button = event.target.closest("[data-share-id]");
    if (button) shareStory(button.dataset.shareId);
  });
  byId("news-insight-form")?.addEventListener("submit", saveNewsInsight);
  byId("news-insight-hide")?.addEventListener("click", hideNewsInsight);
  byId("news-insight-status")?.addEventListener("change", syncInsightPublicControl);
  byId("news-insight-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeNewsInsightDialog();
  });
  byId("news-insight-dialog")?.addEventListener("close", syncNewsDialogState);
  byId("news-insight-original")?.addEventListener("click", (event) => {
    openLeavingDialog(event.currentTarget.dataset.originalUrl, event.currentTarget.dataset.originalSource);
  });
  document.querySelectorAll("[data-close-news-insight]").forEach((button) => {
    button.addEventListener("click", closeNewsInsightDialog);
  });
  byId("news-reader-copy-prompt")?.addEventListener("click", copyResearchPrompt);
  byId("news-reader-original")?.addEventListener("click", (event) => {
    openLeavingDialog(event.currentTarget.dataset.originalUrl, event.currentTarget.dataset.originalSource);
  });
  byId("news-reader-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeArticleReader();
  });
  byId("news-reader-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeArticleReader();
  });
  byId("news-reader-dialog")?.addEventListener("close", syncNewsDialogState);
  document.querySelectorAll("[data-close-news-reader]").forEach((button) => {
    button.addEventListener("click", closeArticleReader);
  });
  byId("news-leaving-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeLeavingDialog();
  });
  byId("news-leaving-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLeavingDialog();
  });
  byId("news-leaving-dialog")?.addEventListener("close", syncNewsDialogState);
  byId("news-leaving-continue")?.addEventListener("click", continueToOriginal);
  document.querySelectorAll("[data-close-news-leaving]").forEach((button) => {
    button.addEventListener("click", closeLeavingDialog);
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
    if (event.key === "Escape") {
      if (byId("news-leaving-dialog")?.open) {
        closeLeavingDialog();
      } else if (byId("news-insight-dialog")?.open) {
        closeNewsInsightDialog();
      } else if (byId("news-reader-dialog")?.open) {
        closeArticleReader();
      } else {
        closeRequestDialog();
      }
    }
  });
  window.addEventListener("strategic-owl-access-change", initializeNewsFeed);
  window.addEventListener("pagehide", rememberNewsPosition);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") rememberNewsPosition();
  });
  installPullToRefresh();
  installInfiniteScroll();
  initializeNewsFeed();
})();
