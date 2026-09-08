(function () {
  "use strict";

  const NEWS_READER_FUNCTION = "news-reader";
  const NEWS_BETA_ADMINISTRATOR_ONLY = true;

  let currentAccess = null;
  let loading = false;

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

    if (error) throw error;
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
      websiteUrl: safeUrl(firstValue(source, ["websiteUrl", "website_url"]))
    };
  }

  function normalizeItem(item, sourceMap) {
    const nestedSource = firstValue(item, ["source", "newsSource", "news_sources"], {});
    const sourceId = String(firstValue(item, ["sourceId", "source_id"], firstValue(nestedSource, ["id"])));
    const mappedSource = sourceMap.get(sourceId) || {};
    const media = Array.isArray(item?.media) ? item.media[0] || {} : {};

    return {
      id: String(firstValue(item, ["id", "newsItemId", "news_item_id"])),
      headline: String(firstValue(item, ["headline", "title"], "Untitled story")),
      summary: String(firstValue(item, ["summaryText", "summary_text", "summary", "excerpt"], "Open the original source to read this story.")),
      publishedAt: firstValue(item, ["publishedAt", "published_at", "sourceUpdatedAt", "source_updated_at"]),
      originalUrl: safeUrl(firstValue(item, ["canonicalUrl", "canonical_url", "articleLink", "article_link", "url"])),
      imageUrl: safeUrl(firstValue(item, ["primaryMediaUrl", "primary_media_url", "thumbnailUrl", "thumbnail_url", "imageUrl", "image_url"], firstValue(media, ["url", "mediaUrl", "media_url"]))),
      sourceName: String(firstValue(nestedSource, ["sourceName", "source_name", "name"], mappedSource.name || firstValue(item, ["sourceName", "source_name"], "News Source"))),
      sourceStatus: String(firstValue(nestedSource, ["status"], mappedSource.status || firstValue(item, ["sourceStatus", "source_status"], "active"))).toLowerCase()
    };
  }

  function renderSources(rawSources) {
    const sources = rawSources.map(normalizeSource);
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
        <article class="news-source-card">
          <div class="news-source-title-row">
            <h3>${escapeHtml(source.name)}</h3>
            <span class="news-source-status" data-status="${escapeHtml(source.status)}">${escapeHtml(source.status)}</span>
          </div>
          ${details ? `<p>${escapeHtml(details)}</p>` : ""}
        </article>`;
    }).join("");

    return sources;
  }

  function renderItems(rawItems, sources) {
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const items = rawItems.map((item) => normalizeItem(item, sourceMap));
    const host = byId("news-item-list");
    const count = byId("news-item-count");
    if (count) count.textContent = String(items.length);
    if (!host) return;

    if (!items.length) {
      host.innerHTML = '<p class="news-empty">No imported stories were returned. Refresh the testing sources and try again.</p>';
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

      return `
        <details class="news-item">
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
            <p>${escapeHtml(item.summary)}</p>
            ${originalLink}
          </div>
        </details>`;
    }).join("");
  }

  async function loadNews() {
    if (loading || !currentAccess?.client) return;
    loading = true;
    const refreshButton = byId("news-refresh");
    const status = byId("news-status");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Refreshing…";
    }
    if (status) status.textContent = "Loading the testing feed…";

    try {
      const [sourcePayload, feedPayload] = await Promise.all([
        invokeReader("listNewsSources", { includeTesting: true }),
        invokeReader("listNewsFeed", { includeTesting: true, limit: 50, pageSize: 50 })
      ]);

      const rawSources = extractArray(sourcePayload, ["sources", "newsSources", "results"]);
      const rawItems = extractArray(feedPayload, ["items", "newsItems", "articles", "feed", "results"]);
      const sources = renderSources(rawSources);
      renderItems(rawItems, sources);
      if (status) {
        status.textContent = rawItems.length
          ? `Showing ${rawItems.length} imported ${rawItems.length === 1 ? "story" : "stories"}.`
          : "The connection worked, but no stories were returned.";
      }
    } catch (error) {
      console.error("Unable to load News Feed preview", error);
      renderSources([]);
      renderItems([], []);
      if (status) status.textContent = error?.message || "The News Feed could not be loaded.";
    } finally {
      loading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
      }
    }
  }

  async function initializeNewsFeed() {
    try {
      currentAccess = await getAuthorizedAccess();

      if (!currentAccess) {
        showGate(
          "Administrator preview",
          "Sign in through Owl Access to test the News Feed.",
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
      await loadNews();
    } catch (error) {
      console.error("News Feed access check failed", error);
      showGate(
        "Administrator access required",
        "Administrator access could not be confirmed. Please sign in again.",
        "Open Owl Access"
      );
    }
  }

  byId("news-refresh")?.addEventListener("click", loadNews);
  window.addEventListener("strategic-owl-access-change", initializeNewsFeed);
  initializeNewsFeed();
})();
