(function () {
  "use strict";

  const NEWS_READER_FUNCTION = "news-reader";

  let currentAccess = null;
  let sources = [];
  let requestsLoaded = false;
  let toastTimer = 0;
  let selectedSourceGroup = "all";

  const sourceFilters = {
    search: "",
    category: "",
    contentType: "",
    mediaType: "",
    articleAccess: ""
  };

  const accessLabels = {
    free: "Free to read",
    limited: "Some free access",
    subscription: "Subscription required"
  };

  const byId = (id) => document.getElementById(id);

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date);
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

  function clearNewsFeedCache() {
    try {
      const matchingKeys = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith("strategic-owl-news-feed:")) matchingKeys.push(key);
      }
      matchingKeys.forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      // Source changes still succeed when browser storage is unavailable.
    }
  }

  function showGate(heading, message, allowAccess = false) {
    const gate = byId("news-sources-gate");
    const workspace = byId("news-sources-workspace");
    if (workspace) workspace.hidden = true;
    if (!gate) return;
    gate.hidden = false;
    gate.innerHTML = `
      <h2>${escapeHtml(heading)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      ${allowAccess ? '<button class="news-access-button" id="news-open-access" type="button">Open Owl Access</button>' : ""}`;
    byId("news-open-access")?.addEventListener("click", () => window.StrategicOwlAccess?.open());
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
    const { data, error } = await currentAccess.client.functions.invoke(NEWS_READER_FUNCTION, {
      body: {
        action,
        email: currentAccess.owlSession.email,
        ...values
      }
    });
    if (error) {
      let message = error.message || "The request failed.";
      try {
        const response = error.context;
        if (response && typeof response.clone === "function") {
          const details = await response.clone().json();
          message = details?.error || details?.message || message;
        }
      } catch {
        // Keep the original Supabase message.
      }
      throw new Error(message);
    }
    if (data?.ok === false) throw new Error(data.error || "The request failed.");
    return data || {};
  }

  function normalizeSource(source) {
    return {
      id: String(firstValue(source, ["id", "sourceId", "source_id"])),
      name: String(firstValue(source, ["name", "sourceName", "source_name"], "News Source")),
      status: String(firstValue(source, ["status"], "active")).toLowerCase(),
      alignment: String(firstValue(source, ["alignmentLabel", "alignment_label", "alignment"])),
      category: String(firstValue(source, ["sourceCategory", "source_category", "category"])),
      contentType: String(firstValue(source, ["contentType", "content_type"])),
      mediaType: String(firstValue(source, ["defaultMediaType", "default_media_type"])),
      articleAccess: String(firstValue(source, ["articleAccess", "article_access"])).toLowerCase(),
      following: Boolean(firstValue(source, ["following", "isFollowing", "is_following"], false))
    };
  }

  function sourceGroups(source) {
    const groups = new Set();
    const alignment = source.alignment.trim().toLowerCase();
    const contentType = source.contentType.trim().toLowerCase();

    if (alignment === "left" || alignment === "center-left") groups.add("left");
    if (["center", "nonpartisan", "mixed"].includes(alignment)) groups.add("middle");
    if (["center-right", "right", "populist right"].includes(alignment)) groups.add("right");
    if (contentType === "primary source") groups.add("primary");

    return groups;
  }

  function articleAccessLabel(value) {
    return accessLabels[String(value || "").toLowerCase()] || "";
  }

  function uniqueSourceValues(key) {
    return Array.from(new Set(
      sources.map((source) => String(source[key] || "").trim()).filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));
  }

  function populateSourceFilter(selectId, key, emptyLabel, labelForValue = (value) => value) {
    const select = byId(selectId);
    if (!select) return;
    const selected = String(sourceFilters[key] || "");
    const values = uniqueSourceValues(key);
    select.innerHTML = [
      `<option value="">${escapeHtml(emptyLabel)}</option>`,
      ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelForValue(value))}</option>`)
    ].join("");
    if (selected && values.includes(selected)) select.value = selected;
    else sourceFilters[key] = "";
  }

  function configureSourceFilters() {
    populateSourceFilter("news-source-category-filter", "category", "All categories");
    populateSourceFilter("news-source-content-filter", "contentType", "All content");
    populateSourceFilter("news-source-media-filter", "mediaType", "All media", (value) => {
      if (value.toLowerCase() === "unknown") return "Unknown";
      return value.charAt(0).toUpperCase() + value.slice(1);
    });
    populateSourceFilter("news-source-access-filter", "articleAccess", "All access", articleAccessLabel);
  }

  function updateSourceOverview() {
    const activeSources = sources.filter((source) => source.status === "active");
    const count = byId("news-active-source-count");
    if (count) count.textContent = `${activeSources.length} active ${activeSources.length === 1 ? "source" : "sources"}`;
    const totals = {
      left: activeSources.filter((source) => sourceGroups(source).has("left")).length,
      middle: activeSources.filter((source) => sourceGroups(source).has("middle")).length,
      right: activeSources.filter((source) => sourceGroups(source).has("right")).length,
      primary: activeSources.filter((source) => sourceGroups(source).has("primary")).length
    };
    Object.entries(totals).forEach(([group, total]) => {
      const element = byId(`news-${group}-source-count`);
      if (element) element.textContent = String(total);
    });
  }

  function activeSourceFilterCount() {
    return [
      selectedSourceGroup === "all" ? "" : selectedSourceGroup,
      sourceFilters.search,
      sourceFilters.category,
      sourceFilters.contentType,
      sourceFilters.mediaType,
      sourceFilters.articleAccess
    ].filter(Boolean).length;
  }

  function updateSourceFilterState() {
    document.querySelectorAll("[data-source-group]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.sourceGroup === selectedSourceGroup));
    });
    const count = byId("news-source-filter-count");
    const total = activeSourceFilterCount();
    if (count) {
      count.textContent = String(total);
      count.hidden = total === 0;
    }
  }

  function sourceMatchesFilters(source) {
    if (selectedSourceGroup !== "all" && !sourceGroups(source).has(selectedSourceGroup)) return false;
    if (sourceFilters.search && !source.name.toLowerCase().includes(sourceFilters.search.toLowerCase())) return false;
    if (sourceFilters.category && source.category !== sourceFilters.category) return false;
    if (sourceFilters.contentType && source.contentType !== sourceFilters.contentType) return false;
    if (sourceFilters.mediaType && source.mediaType !== sourceFilters.mediaType) return false;
    if (sourceFilters.articleAccess && source.articleAccess !== sourceFilters.articleAccess) return false;
    return true;
  }

  function followButtonContent(following, pending = "") {
    const icon = following ? "✓" : "+";
    const label = pending || (following ? "Following" : "Follow");
    return `<span class="news-follow-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  }

  function sourceRow(source) {
    const details = [source.alignment, source.category, source.contentType].filter(Boolean).join(" · ");
    const accessLabel = articleAccessLabel(source.articleAccess);
    const testing = currentAccess?.administrator && source.status === "testing"
      ? '<span class="news-source-row-status">Testing</span>'
      : "";
    const actionLabel = source.following ? `Stop following ${source.name}` : `Follow ${source.name}`;

    return `
      <article class="news-source-row">
        <div>
          <div class="news-source-row-title">
            <h3>${escapeHtml(source.name)}</h3>
            ${testing}
          </div>
          ${details ? `<p>${escapeHtml(details)}</p>` : '<p class="news-source-detail-empty">Source details pending</p>'}
          ${accessLabel ? `<p class="news-source-access" data-access="${escapeHtml(source.articleAccess)}">${escapeHtml(accessLabel)}</p>` : ""}
        </div>
        <button
          class="news-follow-button"
          type="button"
          data-source-id="${escapeHtml(source.id)}"
          data-following="${String(source.following)}"
          aria-label="${escapeHtml(actionLabel)}"
          aria-pressed="${String(source.following)}"
        >${followButtonContent(source.following)}</button>
      </article>`;
  }

  function sourceGroup(id, heading, groupSources, emptyMessage) {
    return `
      <section class="news-source-group" aria-labelledby="${id}">
        <div class="news-source-group-heading">
          <h2 id="${id}">${heading}</h2>
          <span aria-label="${groupSources.length} sources">${groupSources.length}</span>
        </div>
        <div class="news-source-rows">
          ${groupSources.length
            ? groupSources.map(sourceRow).join("")
            : `<p class="news-source-group-empty">${emptyMessage}</p>`}
        </div>
      </section>`;
  }

  function renderSources(rawSources = null) {
    if (Array.isArray(rawSources)) {
      sources = rawSources
        .map(normalizeSource)
        .sort((left, right) => left.name.localeCompare(right.name));
      configureSourceFilters();
      updateSourceOverview();
    }
    const list = byId("news-source-list");
    const summary = byId("news-source-summary");
    updateSourceFilterState();
    if (!list) return;
    if (!sources.length) {
      list.innerHTML = '<p class="news-empty">No sources are available yet.</p>';
      if (summary) summary.textContent = "";
      return;
    }

    const filteredSources = sources.filter(sourceMatchesFilters);
    const followingSources = filteredSources.filter((source) => source.following);
    const availableSources = filteredSources.filter((source) => !source.following);

    if (summary) {
      summary.textContent = activeSourceFilterCount()
        ? `${filteredSources.length} of ${sources.length} sources shown`
        : "";
    }

    if (!filteredSources.length) {
      list.innerHTML = '<p class="news-empty">No sources match these filters.</p>';
      return;
    }

    list.innerHTML = [
      sourceGroup(
        "news-following-sources-title",
        "Following",
        followingSources,
        "No sources selected."
      ),
      sourceGroup(
        "news-available-sources-title",
        "Available Sources",
        availableSources,
        "All available sources are in your feed."
      )
    ].join("");
  }

  async function loadSources() {
    const summary = byId("news-source-summary");
    if (summary) summary.textContent = "Loading…";
    try {
      const payload = await invokeReader("listNewsSources");
      renderSources(extractArray(payload, ["sources", "newsSources", "results"]));
    } catch (error) {
      console.error("Unable to load news sources", error);
      byId("news-source-list").innerHTML = `<p class="news-empty">${escapeHtml(error?.message || "Sources could not be loaded.")}</p>`;
      if (summary) summary.textContent = "";
    }
  }

  async function changeFollow(button) {
    const sourceId = String(button.dataset.sourceId || "");
    const following = button.dataset.following === "true";
    if (!sourceId) return;
    button.disabled = true;
    button.innerHTML = followButtonContent(following, following ? "Removing…" : "Adding…");
    try {
      await invokeReader(following ? "unfollowNewsSource" : "followNewsSource", { sourceId });
      clearNewsFeedCache();
      await loadSources();
    } catch (error) {
      console.error("Unable to change source selection", error);
      showToast(error?.message || "The source selection could not be changed.");
      button.disabled = false;
      button.innerHTML = followButtonContent(following);
    }
  }

  function normalizeRequest(request) {
    const resolved = firstValue(request, ["resolvedSource", "resolved_source"], {});
    return {
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
      host.innerHTML = '<p class="news-empty">No source requests yet.</p>';
      return;
    }
    host.innerHTML = requests.map((request) => {
      const detail = request.adminNotes || (request.resolvedName
        ? `Connected to ${request.resolvedName}.`
        : "Under review");
      return `
        <article class="news-request-card">
          <h3>${escapeHtml(request.sourceName)}</h3>
          <span class="news-request-status" data-status="${escapeHtml(request.status)}">${escapeHtml(request.status)}</span>
          <p>${escapeHtml([formatDate(request.createdAt), detail].filter(Boolean).join(" · "))}</p>
        </article>`;
    }).join("");
  }

  async function loadRequests(force = false) {
    const host = byId("news-request-history");
    if (!host || (!force && requestsLoaded)) return;
    host.innerHTML = '<p class="news-empty">Loading requests…</p>';
    try {
      const payload = await invokeReader("listMyNewsSourceRequests");
      renderRequests(extractArray(payload, ["requests", "sourceRequests", "results"]));
      requestsLoaded = true;
    } catch (error) {
      host.innerHTML = `<p class="news-empty">${escapeHtml(error?.message || "Requests could not be loaded.")}</p>`;
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
    const values = Object.fromEntries(new FormData(form).entries());
    const message = byId("news-request-message");
    const button = byId("news-request-submit");
    button.disabled = true;
    button.textContent = "Sending…";
    message.textContent = "";
    try {
      const result = await invokeReader("submitNewsSourceRequest", {
        sourceName: String(values.sourceName || "").trim(),
        reason: String(values.reason || "").trim()
      });
      message.textContent = result.message || "Request sent.";
      form.reset();
      requestsLoaded = false;
      await loadRequests(true);
      window.setTimeout(closeRequestDialog, 800);
    } catch (error) {
      message.textContent = error?.message || "The request could not be sent.";
    } finally {
      button.disabled = false;
      button.textContent = "Send Request";
    }
  }

  async function initialize() {
    try {
      currentAccess = await getAuthorizedAccess();
      if (!currentAccess) {
        showGate("Owl Access required", "Choose the sources you want in your News Feed. Follow or remove them at any time.", true);
        return;
      }
      byId("news-sources-gate").hidden = true;
      byId("news-sources-workspace").hidden = false;
      await loadSources();
    } catch (error) {
      console.error("News source access check failed", error);
      showGate("Owl Access required", "Your access could not be confirmed. Please sign in again.", true);
    }
  }

  byId("news-source-list")?.addEventListener("click", (event) => {
    const button = event.target.closest(".news-follow-button");
    if (button) changeFollow(button);
  });
  document.querySelectorAll("[data-source-group]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSourceGroup = button.dataset.sourceGroup || "all";
      renderSources();
    });
  });
  byId("news-source-filter-toggle")?.addEventListener("click", (event) => {
    const panel = byId("news-source-filter-panel");
    const open = Boolean(panel?.hidden);
    if (panel) panel.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  byId("news-source-search")?.addEventListener("input", (event) => {
    sourceFilters.search = String(event.currentTarget.value || "").trim();
    renderSources();
  });
  for (const [id, key] of [
    ["news-source-category-filter", "category"],
    ["news-source-content-filter", "contentType"],
    ["news-source-media-filter", "mediaType"],
    ["news-source-access-filter", "articleAccess"]
  ]) {
    byId(id)?.addEventListener("change", (event) => {
      sourceFilters[key] = String(event.currentTarget.value || "");
      renderSources();
    });
  }
  byId("news-source-clear-filters")?.addEventListener("click", () => {
    selectedSourceGroup = "all";
    Object.keys(sourceFilters).forEach((key) => { sourceFilters[key] = ""; });
    const search = byId("news-source-search");
    if (search) search.value = "";
    configureSourceFilters();
    renderSources();
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
    const open = host.hidden;
    host.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
    event.currentTarget.textContent = open ? "Hide Requests" : "My Requests";
    if (open) await loadRequests();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRequestDialog();
  });
  window.addEventListener("strategic-owl-access-change", initialize);
  initialize();
})();
