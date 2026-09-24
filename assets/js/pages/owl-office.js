(function () {
  "use strict";

  const ADMINISTRATOR_USER_ID = "5f96faeb-ec9e-4069-9b91-cbc65e422f73";
  const PROFILE_TABLE = "owl_profile";
  const IMAGE_BUCKET = "app-images";
  const REQUEST_TABLE = "owl_topic_requests";
  const NEWS_ADMIN_FUNCTION = "news-admin";

  let administrator = null;
  let currentProfilePath = "";
  let selectedProfileFile = null;
  let selectedProfilePreviewUrl = "";
  let inboxRequests = [];
  let inboxView = "active";
  let newsAdminView = "dashboard";
  let newsSourceFilter = "testing";
  let newsSources = [];
  let newsSourceRequests = [];
  let newsItems = [];
  let newsSearchMeta = { query: "", total: 0, offset: 0, limit: 50, hasMore: false };
  let newsTaxonomy = [];
  let reusableInsights = [];
  let readerRights = [];
  let storyClusters = [];
  let coverageGroups = [];
  let dashboardCoverageGroups = [];
  let dashboardCoverageSort = "coverage";
  let dashboardCoverageWindowDays = 7;
  let selectedArticleIds = new Set();
  let newsDashboardSummary = {};
  let taxonomyFilter = "all";
  let taxonomySearch = "";
  let deskSearch = "";
  let activeSubjectFilter = "";
  let activeStoryFilter = "";
  let selectedNewsItem = null;
  let editingReusableInsight = null;
  let coverageGroupDraft = { itemIds: [], onSaved: null, onCancel: null };
  let reviewingSourceRequestId = "";
  let editingNewsSourceId = "";
  let newsAdminLoading = false;
  let toastTimer = null;

  const byId = (id) => document.getElementById(id);

  function showToast(message) {
    const toast = byId("office-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.visible = "true";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.dataset.visible = "false";
    }, 3600);
  }

  function setBusy(button, busy, busyLabel, readyLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : readyLabel;
  }

  function openDialog(dialog) {
    if (!dialog?.open) dialog?.showModal();
    document.body.classList.add("owl-dialog-open");
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function currentUserIsAdministrator() {
    const user = administrator?.session?.user;
    return Boolean(user && !user.is_anonymous && user.id === ADMINISTRATOR_USER_ID);
  }

  function requireCurrentAdministrator() {
    if (!administrator || !currentUserIsAdministrator()) {
      throw new Error("Your administrator session is no longer valid.");
    }
    return administrator.client;
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  async function invokeNewsAdmin(action, values = {}) {
    const client = requireCurrentAdministrator();
    const { data, error } = await client.functions.invoke(NEWS_ADMIN_FUNCTION, {
      body: { action, ...values }
    });

    if (error) {
      let message = error.message || "The news administration request failed.";
      try {
        const response = error.context;
        if (response && typeof response.clone === "function") {
          const details = await response.clone().json();
          message = details?.error || details?.message || message;
        }
      } catch {
        // Keep the original Supabase message when there is no JSON response.
      }
      throw new Error(message);
    }
    if (data?.ok === false) {
      throw new Error(data.error || "The news administration request failed.");
    }
    return data || {};
  }

  function showAccessDenied(message) {
    const gate = byId("office-gate");
    const workspace = byId("office-workspace");
    if (workspace) workspace.hidden = true;
    if (!gate) return;
    gate.innerHTML = `
      <h2>Administrator access required</h2>
      <p>${message || "Sign in through Owl Access to open The Owl's Office."}</p>
      <button class="office-button office-button--primary" id="office-open-access" type="button">Open Owl Access</button>`;
    byId("office-open-access")?.addEventListener("click", () => {
      window.StrategicOwlAccess?.open();
    });
  }

  async function verifyOfficeAccess() {
    try {
      administrator = await window.StrategicOwlAccess?.requireAdministrator();
      if (!administrator || administrator.session.user.id !== ADMINISTRATOR_USER_ID) {
        showAccessDenied();
        return false;
      }
      byId("office-gate").hidden = true;
      byId("office-workspace").hidden = false;
      return true;
    } catch (error) {
      console.error("Office authorization failed", error);
      showAccessDenied("Administrator access could not be confirmed. Please sign in again.");
      return false;
    }
  }

  async function loadProfileImage() {
    const client = requireCurrentAdministrator();
    const { data, error } = await client
      .from(PROFILE_TABLE)
      .select("avatar_path")
      .eq("id", ADMINISTRATOR_USER_ID)
      .maybeSingle();
    if (error) throw error;
    currentProfilePath = String(data?.avatar_path || "").trim();
    if (!currentProfilePath) return;
    const { data: publicData } = client.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(currentProfilePath);
    if (publicData?.publicUrl) {
      byId("office-profile-image").src = `${publicData.publicUrl}?v=${Date.now()}`;
    }
  }

  function imageExtension(file) {
    const type = String(file?.type || "").toLowerCase();
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    if (type === "image/heic") return "heic";
    if (type === "image/heif") return "heif";
    const nameExtension = String(file?.name || "").split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(nameExtension)
      ? nameExtension
      : "jpg";
  }

  function selectProfileImage(file) {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showToast("Choose an image file.");
      return;
    }
    selectedProfileFile = file;
    if (selectedProfilePreviewUrl) URL.revokeObjectURL(selectedProfilePreviewUrl);
    selectedProfilePreviewUrl = URL.createObjectURL(file);
    byId("office-profile-image").src = selectedProfilePreviewUrl;
    byId("office-save-profile").hidden = false;
    byId("office-choose-profile").textContent = "Change Photo";
  }

  async function saveProfileImage() {
    if (!selectedProfileFile) return;
    const client = requireCurrentAdministrator();
    const button = byId("office-save-profile");
    setBusy(button, true, "Uploading…", "Update Profile");
    const extension = imageExtension(selectedProfileFile);
    const imagePath = `profile/taylor-irby-profile-${Date.now()}.${extension}`;
    let uploaded = false;
    let profileSaved = false;
    try {
      const { error: uploadError } = await client.storage
        .from(IMAGE_BUCKET)
        .upload(imagePath, selectedProfileFile, {
          cacheControl: "31536000",
          contentType: selectedProfileFile.type || `image/${extension}`,
          upsert: false
        });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { error: profileError } = await client.from(PROFILE_TABLE).upsert(
        {
          id: ADMINISTRATOR_USER_ID,
          avatar_path: imagePath,
          updated_at: new Date().toISOString()
        },
        { onConflict: "id" }
      );
      if (profileError) throw profileError;
      profileSaved = true;

      const previousPath = currentProfilePath;
      currentProfilePath = imagePath;
      if (previousPath && previousPath !== imagePath) {
        client.storage.from(IMAGE_BUCKET).remove([previousPath]).catch(() => {});
      }

      selectedProfileFile = null;
      if (selectedProfilePreviewUrl) URL.revokeObjectURL(selectedProfilePreviewUrl);
      selectedProfilePreviewUrl = "";
      button.hidden = true;
      byId("office-choose-profile").textContent = "Choose Photo";
      await loadProfileImage();
      showToast("Profile image updated.");
    } catch (error) {
      console.error("Profile update failed", error);
      if (uploaded && !profileSaved) {
        client.storage.from(IMAGE_BUCKET).remove([imagePath]).catch(() => {});
      }
      showToast(error?.message || "The profile image could not be updated.");
    } finally {
      setBusy(button, false, "Uploading…", "Update Profile");
    }
  }

  async function addAllowedUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("[data-form-message]");
    const button = form.querySelector('button[type="submit"]');
    const displayName = byId("office-user-name").value.trim();
    const email = byId("office-user-email").value.trim().toLowerCase();
    if (!displayName) {
      message.textContent = "Enter a name.";
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      message.textContent = "Enter a valid email address.";
      return;
    }

    setBusy(button, true, "Adding…", "Add User");
    message.textContent = "";
    try {
      const client = requireCurrentAdministrator();
      const { error } = await client.from("allowed_users").insert({
        display_name: displayName,
        email,
        role: "user"
      });
      if (error) throw error;
      form.reset();
      closeDialog(byId("office-add-user-dialog"));
      showToast("User added.");
    } catch (error) {
      console.error("Add user failed", error);
      message.textContent = error?.code === "23505"
        ? "This email is already authorized."
        : error?.message || "The user could not be added.";
    } finally {
      setBusy(button, false, "Adding…", "Add User");
    }
  }

  function safeStorageName(file) {
    const safeName = String(file?.name || "owl-post")
      .split(/[\\/]/)
      .pop()
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `${Date.now()}-${safeName || `owl-post.${imageExtension(file)}`}`;
  }

  async function publishOwlPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("[data-form-message]");
    const button = form.querySelector('button[type="submit"]');
    const subject = byId("office-post-subject").value.trim();
    const logic = byId("office-post-logic").value.trim();
    const position = byId("office-post-position").value.trim();
    const imageFile = byId("office-post-image").files?.[0] || null;
    if (subject.length < 3 || subject.length > 120 || !logic || !position) {
      message.textContent = "Add a subject, Owl Logic, and The Owl's Position.";
      return;
    }

    setBusy(button, true, "Publishing…", "Publish to The Perch");
    message.textContent = "";
    let uploadedPath = "";
    try {
      const client = requireCurrentAdministrator();
      let imageUrl = null;
      if (imageFile) {
        uploadedPath = safeStorageName(imageFile);
        const { error: uploadError } = await client.storage
          .from(IMAGE_BUCKET)
          .upload(uploadedPath, imageFile, {
            cacheControl: "31536000",
            contentType: imageFile.type || `image/${imageExtension(imageFile)}`,
            upsert: false
          });
        if (uploadError) throw uploadError;
        const { data: publicData } = client.storage
          .from(IMAGE_BUCKET)
          .getPublicUrl(uploadedPath);
        imageUrl = publicData?.publicUrl || null;
      }

      const { error: postError } = await client.from("owl_posts").insert({
        author_id: administrator.session.user.id,
        subject,
        daily_owl_logic: logic,
        strategic_positioning: position,
        image_url: imageUrl,
        is_validated: true
      });
      if (postError) throw postError;

      form.reset();
      byId("office-post-preview").hidden = true;
      closeDialog(byId("office-post-dialog"));
      showToast("Your Owl post is now on The Perch.");
    } catch (error) {
      console.error("Post publishing failed", error);
      if (uploadedPath) {
        administrator?.client?.storage.from(IMAGE_BUCKET).remove([uploadedPath]).catch(() => {});
      }
      message.textContent = error?.message || "The Owl post could not be published.";
    } finally {
      setBusy(button, false, "Publishing…", "Publish to The Perch");
    }
  }

  function formatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function sourceLabel(value) {
    if (value === "allowed_user") return "Approved user";
    if (value === "owl_access" || value === "app_subscription") {
      return "Owl Access subscriber";
    }
    return "Substack subscriber";
  }

  function activeStatusPriority(status) {
    return { new: 0, researching: 1, read: 2, completed: 3 }[status] ?? 4;
  }

  function filteredInboxRequests() {
    const archived = inboxView === "archived";
    return inboxRequests
      .filter((request) => (request.status === "archived") === archived)
      .sort((first, second) => {
        if (!archived) {
          const priority = activeStatusPriority(first.status) - activeStatusPriority(second.status);
          if (priority !== 0) return priority;
        }
        const firstTime = Date.parse(first.status_updated_at || first.created_at || "") || 0;
        const secondTime = Date.parse(second.status_updated_at || second.created_at || "") || 0;
        return secondTime - firstTime;
      });
  }

  function appendText(parent, tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function setNewsMessage(message = "") {
    const host = byId("office-news-message");
    if (host) host.textContent = message;
  }

  function newsStatusBadge(status) {
    const badge = document.createElement("span");
    badge.className = "office-news-status";
    badge.dataset.status = status || "unknown";
    badge.textContent = status || "unknown";
    return badge;
  }

  function appendNewsLink(parent, label, value) {
    const url = safeUrl(value);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    parent.appendChild(link);
  }

  function newsButton(label, className, action, id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `office-button ${className}`;
    button.textContent = label;
    button.dataset.newsAction = action;
    if (id) button.dataset.newsId = id;
    return button;
  }

  function newsArticleAction({ label, icon, url = "", action = "", id = "" }) {
    const safeHref = safeUrl(url);
    const control = safeHref
      ? document.createElement("a")
      : document.createElement("button");
    if (safeHref) {
      control.href = safeHref;
      control.target = "_blank";
      control.rel = "noopener noreferrer";
    } else {
      control.type = "button";
      control.dataset.newsAction = action;
      if (id) control.dataset.newsId = id;
    }
    control.className = "office-news-article-action";
    control.insertAdjacentHTML("beforeend", icon === "original"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"></path><path d="m19 5-9 9"></path><path d="M19 13v6H5V5h6"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8Z"></path><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"></path></svg>');
    const text = document.createElement("span");
    text.textContent = label;
    control.appendChild(text);
    return control;
  }

  function renderNewsRequests() {
    const list = byId("office-news-request-list");
    if (!list) return;
    list.replaceChildren();

    if (!newsSourceRequests.length) {
      appendText(list, "p", "No source requests.", "office-empty");
      return;
    }

    for (const request of newsSourceRequests) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      card.dataset.requestId = request.id;

      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", request.requested_source_name || "Requested source");
      header.appendChild(newsStatusBadge(request.status));
      card.appendChild(header);

      const requester = request.submitted_email || "Authenticated Owl Access user";
      const date = formatDate(request.created_at);
      appendText(card, "p", [requester, date].filter(Boolean).join(" · "));
      if (request.request_reason) appendText(card, "p", request.request_reason);
      appendNewsLink(card, "Website", request.requested_website_url);
      appendNewsLink(card, "RSS Feed", request.requested_feed_url);

      if (request.status === "pending" || request.status === "testing") {
        const controls = document.createElement("div");
        controls.className = "office-news-card-controls";

        const notesLabel = document.createElement("label");
        notesLabel.textContent = "Administrator notes";
        const notes = document.createElement("textarea");
        notes.rows = 2;
        notes.maxLength = 2000;
        notes.value = request.admin_notes || "";
        notes.dataset.requestNotes = "";
        notesLabel.appendChild(notes);
        controls.appendChild(notesLabel);

        if (request.status === "pending") {
          const sourceLabel = document.createElement("label");
          sourceLabel.textContent = "Existing source";
          const sourceSelect = document.createElement("select");
          sourceSelect.dataset.requestSource = "";
          const blank = document.createElement("option");
          blank.value = "";
          blank.textContent = "Choose source";
          sourceSelect.appendChild(blank);
          for (const source of newsSources) {
            const option = document.createElement("option");
            option.value = source.id;
            option.textContent = source.source_name;
            sourceSelect.appendChild(option);
          }
          sourceLabel.appendChild(sourceSelect);
          controls.appendChild(sourceLabel);
        }

        card.appendChild(controls);

        const actions = document.createElement("div");
        actions.className = "office-news-card-actions";
        if (request.status === "pending") {
          actions.appendChild(newsButton("Review Source", "office-button--primary", "request-review", request.id));
          actions.appendChild(newsButton("Mark Duplicate", "office-button--secondary", "request-duplicate", request.id));
        } else if (request.resolved_source_id) {
          actions.appendChild(newsButton("Make Live", "office-button--primary", "request-live", request.id));
        }
        actions.appendChild(newsButton("Reject", "office-button--danger", "request-reject", request.id));
        card.appendChild(actions);
      } else if (request.admin_notes) {
        appendText(card, "p", `Administrator note: ${request.admin_notes}`);
      }

      list.appendChild(card);
    }
  }

  function renderNewsSources() {
    const list = byId("office-news-source-list");
    const filter = byId("office-news-source-filter");
    if (!list || !filter) return;

    const selectedFilter = filter.value;
    filter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All Sources";
    filter.appendChild(allOption);
    for (const source of newsSources) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.source_name;
      option.selected = source.id === selectedFilter;
      filter.appendChild(option);
    }

    const sourceCounts = {
      all: newsSources.length,
      testing: 0,
      active: 0,
      paused: 0,
      retired: 0
    };
    for (const source of newsSources) {
      if (Object.hasOwn(sourceCounts, source.status)) {
        sourceCounts[source.status] += 1;
      }
    }
    for (const [status, count] of Object.entries(sourceCounts)) {
      const countElement = byId(`office-source-filter-${status}`);
      if (countElement) countElement.textContent = String(count);
    }
    document.querySelectorAll("[data-source-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.sourceFilter === newsSourceFilter));
    });

    const visibleSources = newsSourceFilter === "all"
      ? newsSources
      : newsSources.filter((source) => source.status === newsSourceFilter);

    list.replaceChildren();
    if (!visibleSources.length) {
      const emptyMessage = newsSourceFilter === "all"
        ? "No connected news sources."
        : `No ${newsSourceFilter} sources.`;
      appendText(list, "p", emptyMessage, "office-empty");
      return;
    }

    for (const source of visibleSources) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      card.dataset.sourceId = source.id;
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", source.source_name || "News source");
      header.appendChild(newsStatusBadge(source.status));
      card.appendChild(header);

      const accessLabel = {
        free: "Free to read",
        limited: "Some free access",
        subscription: "Subscription required"
      }[String(source.article_access || "").toLowerCase()];
      const details = [source.alignment_label, source.source_category, source.content_type, accessLabel]
        .filter(Boolean).join(" · ");
      if (details) appendText(card, "p", details);
      appendNewsLink(card, "Website", source.website_url);
      appendNewsLink(card, "RSS Feed", source.feed_url);

      const latest = source.latest_run;
      if (latest) {
        const runSummary = latest.status === "succeeded"
          ? `${latest.items_found || 0} found · ${latest.items_inserted || 0} new · ${latest.items_updated || 0} updated`
          : latest.error_message || "The latest import failed.";
        appendText(card, "p", `Latest import: ${runSummary}`);
      }

      const controls = document.createElement("div");
      controls.className = "office-news-card-controls";
      const statusLabel = document.createElement("label");
      statusLabel.textContent = "Source status";
      const statusSelect = document.createElement("select");
      statusSelect.dataset.sourceStatus = "";
      statusSelect.dataset.previousStatus = source.status;
      for (const [value, label] of [
        ["testing", "Testing"],
        ["active", "Active"],
        ["paused", "Paused"],
        ["retired", "Retired"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = source.status === value;
        statusSelect.appendChild(option);
      }
      statusLabel.appendChild(statusSelect);
      controls.appendChild(statusLabel);
      card.appendChild(controls);

      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Edit", "office-news-text-action", "source-edit", source.id));
      if (source.status === "testing" || source.status === "active") {
        actions.appendChild(newsButton("Refresh", "office-news-text-action", "source-ingest", source.id));
      }
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderNewsItems() {
    const list = byId("office-news-item-list");
    if (!list) return;
    list.replaceChildren();

    const group = activeStoryFilter
      ? coverageGroups.find((entry) => String(entry.id) === String(activeStoryFilter))
      : null;
    const visibleItems = group
      ? newsItems.filter((item) => (item.coverageGroups || []).some((row) =>
        String(row.story_cluster_id) === String(group.id) && row.membership_status !== "rejected"))
      : newsItems;

    renderNewsSearchMeta(visibleItems.length);

    if (group) {
      const notice = appendText(list, "p", `Showing articles in ${group.title}.`, "office-filter-notice");
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "office-news-text-action";
      clear.dataset.newsAction = "clear-story-filter";
      clear.textContent = "Clear group";
      notice.append(" ", clear);
    }

    if (!visibleItems.length) {
      appendText(list, "p", "No articles match this view.", "office-empty");
      return;
    }

    for (const item of visibleItems) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      card.dataset.itemId = item.id;
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      const titleWrap = document.createElement("div");
      titleWrap.className = "office-article-title-wrap";
      const select = document.createElement("input");
      select.type = "checkbox";
      select.className = "office-article-selector";
      select.dataset.selectArticle = item.id;
      select.checked = selectedArticleIds.has(String(item.id));
      select.setAttribute("aria-label", `Select ${item.headline || "article"}`);
      appendText(titleWrap, "h3", item.headline || "Untitled article");
      header.append(select, titleWrap);
      const appliedInsights = Array.isArray(item.reusableInsights) ? item.reusableInsights : [];
      header.appendChild(newsStatusBadge(appliedInsights.length ? `${appliedInsights.length} insight${appliedInsights.length === 1 ? "" : "s"}` : "no insight"));
      card.appendChild(header);
      const sourceName = item.source?.source_name || "News source";
      const sourceLine = [sourceName, item.source?.alignment_label, formatDate(item.published_at)].filter(Boolean).join(" · ");
      appendText(card, "p", sourceLine);
      const matchedFields = Array.isArray(item.matched_fields) ? item.matched_fields : [];
      if (newsSearchMeta.query && matchedFields.length) {
        appendText(
          card,
          "p",
          `Matched: ${matchedFields.map((field) => String(field).replace(/^./, (letter) => letter.toUpperCase())).join(", ")}`,
          "office-search-match"
        );
      }
      if (item.summary_text) appendText(card, "p", item.summary_text);
      const memberships = Array.isArray(item.coverageGroups) ? item.coverageGroups : [];
      const confirmedGroups = memberships
        .filter((row) => row.membership_status === "confirmed")
        .map((row) => row.news_story_clusters?.title)
        .filter(Boolean);
      const suggestedGroups = memberships
        .filter((row) => row.membership_status === "suggested")
        .map((row) => row.news_story_clusters?.title)
        .filter(Boolean);
      if (confirmedGroups.length || suggestedGroups.length || appliedInsights.length) {
        const chips = document.createElement("div");
        chips.className = "office-coverage-chip-row";
        for (const name of confirmedGroups.slice(0, 6)) appendText(chips, "span", name);
        for (const name of suggestedGroups.slice(0, 4)) appendText(chips, "span", `Suggested: ${name}`);
        for (const insight of appliedInsights.slice(0, 3)) appendText(chips, "span", `Insight: ${insight.owl_label || "Owl Insight"}`);
        card.appendChild(chips);
      }
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions office-news-article-actions";
      if (safeUrl(item.canonical_url)) {
        actions.appendChild(newsArticleAction({
          label: "Original",
          icon: "original",
          url: item.canonical_url
        }));
      }
      actions.appendChild(newsArticleAction({
        label: "Add Insight",
        icon: "insight",
        action: "article-insight",
        id: item.id
      }));
      actions.appendChild(newsArticleAction({
        label: "Coverage",
        icon: "insight",
        action: "article-coverage",
        id: item.id
      }));
      actions.appendChild(newsArticleAction({
        label: "New Group",
        icon: "insight",
        action: "article-new-group",
        id: item.id
      }));
      card.appendChild(actions);
      list.appendChild(card);
    }
    syncArticleBulkToolbar();
  }

  function renderNewsSearchMeta(visibleCount = newsItems.length) {
    const count = byId("office-news-result-count");
    const loadMore = byId("office-news-load-more");
    const total = Number(newsSearchMeta.total || visibleCount || 0);
    const query = String(newsSearchMeta.query || "").trim();
    if (count) {
      count.textContent = query
        ? `${total} matching article${total === 1 ? "" : "s"} for “${query}”`
        : `Showing ${visibleCount} of ${total || visibleCount} article${(total || visibleCount) === 1 ? "" : "s"}`;
    }
    if (loadMore) loadMore.hidden = !newsSearchMeta.hasMore || Boolean(activeStoryFilter);
  }

  function syncArticleBulkToolbar() {
    const count = selectedArticleIds.size;
    const countNode = byId("office-selected-article-count");
    if (countNode) countNode.textContent = String(count);
    const assign = byId("office-assign-selected-articles");
    if (assign) assign.disabled = !count || !byId("office-bulk-coverage-group")?.value;
    const create = byId("office-create-group-selected");
    if (create) create.disabled = !count;
  }

  function taxonomyName(term) {
    return term?.subject_name || term?.news_subjects?.subject_name || "Taxonomy term";
  }

  function renderTaxonomy() {
    const list = byId("office-taxonomy-list");
    if (!list) return;
    const query = taxonomySearch.toLocaleLowerCase();
    const filtered = newsTaxonomy.filter((term) => {
      if (taxonomyFilter !== "all" && term.subject_type !== taxonomyFilter) return false;
      if (!query) return true;
      const aliases = Array.isArray(term.news_subject_aliases) ? term.news_subject_aliases : [];
      return [term.subject_name, term.description, ...aliases.map((alias) => alias.alias_text)]
        .filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
    });
    if (byId("office-taxonomy-count")) byId("office-taxonomy-count").textContent = String(newsTaxonomy.length);
    list.replaceChildren();
    if (!filtered.length) {
      appendText(list, "p", "No taxonomy terms match this view.", "office-empty");
      return;
    }
    for (const term of filtered) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      card.dataset.taxonomyId = term.id;
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", term.subject_name);
      header.appendChild(newsStatusBadge(`${term.subject_type} · ${term.status}`));
      card.appendChild(header);
      if (term.description) appendText(card, "p", term.description);
      const aliases = Array.isArray(term.news_subject_aliases) ? term.news_subject_aliases : [];
      appendText(card, "p", aliases.length
        ? `Matches: ${aliases.map((alias) => alias.alias_text).join(", ")}`
        : "No matching phrases yet.");
      const controls = document.createElement("div");
      controls.className = "office-inline-entry";
      const input = document.createElement("input");
      input.placeholder = "Add matching phrase";
      input.maxLength = 160;
      input.dataset.aliasInput = "";
      controls.append(input, newsButton("Add Phrase", "office-news-text-action", "taxonomy-alias", term.id));
      card.appendChild(controls);
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Edit Term", "office-news-text-action", "taxonomy-edit", term.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderReusableInsights() {
    const list = byId("office-reusable-insight-list");
    if (!list) return;
    byId("office-reusable-insight-count").textContent = String(reusableInsights.length);
    list.replaceChildren();
    if (!reusableInsights.length) {
      appendText(list, "p", "No reusable Insights yet.", "office-empty");
      return;
    }
    for (const insight of reusableInsights) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", insight.owl_label || "Reusable Owl Insight");
      header.appendChild(newsStatusBadge(insight.review_status));
      card.appendChild(header);
      if (insight.owl_analysis) appendText(card, "p", insight.owl_analysis);
      const linkedGroups = (insight.owl_insight_clusters || [])
        .map((row) => row.news_story_clusters)
        .filter(Boolean);
      const linkedItems = Array.isArray(insight.owl_insight_items) ? insight.owl_insight_items : [];
      let appliesTo = "Coverage has not been selected.";
      if (insight.scope_type === "cluster" && linkedGroups.length) {
        appliesTo = `Coverage: ${linkedGroups.map((group) => group.title).join(" · ")}`;
      }
      else if (insight.scope_type === "article" || linkedItems.length) appliesTo = `${linkedItems.length || 1} selected article${linkedItems.length === 1 ? "" : "s"}`;
      else if ((insight.owl_insight_subjects || []).length) appliesTo = "Legacy subject-based Insight";
      appendText(card, "p", appliesTo, "office-insight-scope");
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Edit Insight", "office-news-text-action", "reusable-edit", insight.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function searchableArticleText(item) {
    return [
      item.headline,
      item.summary_text,
      item.source?.source_name,
      ...(Array.isArray(item.categories) ? item.categories : [])
    ].filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function inferredSubjectCoverage() {
    const completeCoverage = Array.isArray(newsDashboardSummary?.subjectCoverage)
      ? newsDashboardSummary.subjectCoverage
      : [];
    if (completeCoverage.length) {
      return completeCoverage.map((group) => ({
        term: {
          id: group.id,
          subject_name: group.subjectName,
          subject_type: group.subjectType
        },
        items: Array.isArray(group.recentArticles) ? group.recentArticles : [],
        sources: (group.sources || []).map((source) => source.source_name).filter(Boolean),
        articleCount: Number(group.articleCount || 0),
        sourceCount: Number(group.sourceCount || 0),
        insight: group.insight || null
      }));
    }
    const groups = [];
    for (const term of newsTaxonomy.filter((entry) => entry.status === "active" && entry.subject_type === "subject")) {
      const aliases = Array.isArray(term.news_subject_aliases)
        ? term.news_subject_aliases.map((alias) => alias.alias_text).filter(Boolean)
        : [];
      const phrases = [term.subject_name, ...aliases].map((value) => String(value).toLocaleLowerCase());
      const matched = newsItems.filter((item) => {
        const text = searchableArticleText(item);
        return phrases.some((phrase) => phrase.length > 2 && text.includes(phrase));
      });
      if (!matched.length) continue;
      const sources = [...new Set(matched.map((item) => item.source?.source_name).filter(Boolean))];
      const insight = reusableInsights.find((entry) =>
        (entry.owl_insight_subjects || []).some((row) => String(row.subject_id || row.news_subjects?.id || "") === String(term.id))
      );
      groups.push({ term, items: matched, sources, articleCount: matched.length, sourceCount: sources.length, insight });
    }
    return groups.sort((left, right) =>
      Number(right.sourceCount || right.sources.length) - Number(left.sourceCount || left.sources.length) ||
      Number(right.articleCount || right.items.length) - Number(left.articleCount || left.items.length)
    );
  }

  function renderSubjectDashboard() {
    const list = byId("office-subject-dashboard");
    if (!list) return;
    list.replaceChildren();
    const query = deskSearch.toLocaleLowerCase();
    const groups = dashboardCoverageGroups.filter((group) => !query || [
      group.title,
      group.summary,
      ...(group.recentArticles || []).map((item) => item?.headline),
      ...(group.alignmentCoverage || []).map((row) => row.alignment_label)
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
    if (!groups.length) {
      appendText(list, "p", query
        ? "No Coverage Groups match that search."
        : "No Coverage Groups are ready yet.", "office-empty");
      return;
    }
    for (const group of groups.slice(0, 12)) {
      const card = document.createElement("article");
      card.className = "office-subject-card";
      const top = document.createElement("div");
      top.className = "office-subject-card-top";
      const title = document.createElement("div");
      appendText(title, "h4", group.title || "Coverage Group");
      const articleCount = Number(group.stats?.article_count || 0);
      const sourceCount = Number(group.stats?.source_count || 0);
      const totals = document.createElement("div");
      totals.className = "office-coverage-totals";
      const sourceTotal = document.createElement("span");
      sourceTotal.className = "office-coverage-total";
      appendText(sourceTotal, "strong", String(sourceCount));
      sourceTotal.append(document.createTextNode(` source${sourceCount === 1 ? "" : "s"}`));
      const articleTotal = document.createElement("span");
      articleTotal.className = "office-coverage-total";
      appendText(articleTotal, "strong", String(articleCount));
      articleTotal.append(document.createTextNode(` article${articleCount === 1 ? "" : "s"}`));
      totals.append(sourceTotal, articleTotal);
      title.appendChild(totals);
      const insightCount = Array.isArray(group.insights) ? group.insights.length : 0;
      top.append(title, newsStatusBadge(insightCount ? `${insightCount} insight${insightCount === 1 ? "" : "s"}` : group.review_status));
      card.appendChild(top);
      const alignment = (group.alignmentCoverage || [])
        .map((row) => `${row.alignment_label}: ${row.source_count}`)
        .join(" · ");
      appendText(card, "p", alignment || `${group.group_type || "story"} · source alignment not assessed`, "office-subject-sources");
      const sourceNames = (group.sources || []).map((source) => source?.source_name).filter(Boolean).slice(0, 8);
      if (sourceNames.length) appendText(card, "p", sourceNames.join(" · "), "office-subject-sources");
      const headlines = document.createElement("ul");
      for (const item of (group.recentArticles || []).slice(0, 3)) appendText(headlines, "li", item?.headline || "Untitled article");
      card.appendChild(headlines);
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Review Articles", "office-news-text-action", "story-view", group.id));
      actions.appendChild(newsButton("Apply Insight", "office-news-text-action", "story-insight", group.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderStoryClusters() {
    const list = byId("office-story-list");
    if (!list) return;
    byId("office-story-count").textContent = String(coverageGroups.length);
    if (byId("office-coverage-manage-count")) byId("office-coverage-manage-count").textContent = String(coverageGroups.length);
    list.replaceChildren();
    if (!coverageGroups.length) {
      appendText(list, "p", "No Coverage Groups yet. Create one here or begin from an article.", "office-empty");
      return;
    }
    for (const story of coverageGroups) {
      const coverage = story.stats || {};
      const confirmed = Number(coverage.article_count || 0);
      const suggested = Number(coverage.suggested_article_count || 0);
      const sourceCount = Number(coverage.source_count || 0);
      const card = document.createElement("article");
      card.className = "office-story-card";
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", story.title || "Developing story");
      header.appendChild(newsStatusBadge(`${story.group_type || "story"} · ${story.review_status || "confirmed"}`));
      card.appendChild(header);
      appendText(card, "p", `${confirmed} confirmed article${confirmed === 1 ? "" : "s"}${sourceCount ? ` · ${sourceCount} source${sourceCount === 1 ? "" : "s"}` : ""}${suggested ? ` · ${suggested} suggested` : ""}`);
      const alignment = (story.alignmentCoverage || []).map((row) => `${row.alignment_label}: ${row.source_count}`).join(" · ");
      if (alignment) appendText(card, "p", alignment, "office-subject-sources");
      if (story.summary) appendText(card, "p", story.summary);
      appendText(card, "p", coverage.latest_confirmed_article_at ? `Latest coverage ${formatDate(coverage.latest_confirmed_article_at)}` : "Waiting for coverage", "office-story-date");
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("View Articles", "office-news-text-action", "story-view", story.id));
      actions.appendChild(newsButton(story.insights?.length ? "Manage Insights" : "Add Insight", "office-news-text-action", "story-insight", story.id));
      actions.appendChild(newsButton("Edit Group", "office-news-text-action", "coverage-edit", story.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderDashboardQueue() {
    const host = byId("office-dashboard-queue");
    if (!host) return;
    host.replaceChildren();
    const suggested = Number(newsDashboardSummary?.attention?.suggestedCoverageMatches ?? 0);
    const withoutInsight = coverageGroups.filter((group) => !(group.insights || []).length).length;
    const pending = Number(newsDashboardSummary?.requests?.pending || 0);
    const rows = [
      [suggested, "suggested coverage matches", "stories"],
      [withoutInsight, "Coverage Groups without an Insight", "insights"],
      [pending, "source requests waiting", "requests"]
    ];
    for (const [count, label, target] of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.dashboardTarget = target;
      appendText(button, "strong", String(count));
      appendText(button, "span", label);
      host.appendChild(button);
    }
    byId("office-metric-stories").textContent = String(coverageGroups.length);
    byId("office-metric-articles").textContent = String(Number(newsDashboardSummary?.items?.active || newsItems.length));
    byId("office-metric-insights").textContent = String(reusableInsights.length);
    byId("office-metric-attention").textContent = String(suggested + withoutInsight + pending);
  }

  function renderEditorialDashboard() {
    const heading = byId("office-coverage-heading");
    if (heading) heading.textContent = dashboardCoverageSort === "coverage"
      ? "Most Covered Stories"
      : "Newest Stories";
    document.querySelectorAll("[data-coverage-sort]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.coverageSort === dashboardCoverageSort));
    });
    document.querySelectorAll("[data-coverage-window]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.coverageWindow) === dashboardCoverageWindowDays));
    });
    renderSubjectDashboard();
    renderStoryClusters();
    renderDashboardQueue();
  }

  async function loadDashboardCoverage() {
    const list = byId("office-subject-dashboard");
    if (list) {
      list.replaceChildren();
      appendText(list, "p", "Loading stories…", "office-empty");
    }
    try {
      const result = await invokeNewsAdmin("listCoverageGroups", {
        status: "active",
        reviewStatus: "all",
        visibility: "all",
        groupType: "story",
        sortBy: dashboardCoverageSort,
        windowDays: dashboardCoverageWindowDays,
        limit: 100
      });
      dashboardCoverageGroups = Array.isArray(result.coverageGroups) ? result.coverageGroups : [];
      renderEditorialDashboard();
    } catch (error) {
      setNewsMessage(error?.message || "Coverage could not be loaded.");
    }
  }

  function renderReaderRights() {
    const list = byId("office-rights-list");
    if (!list) return;
    byId("office-rights-count").textContent = String(readerRights.length);
    list.replaceChildren();
    if (!readerRights.length) {
      appendText(list, "p", "No Reader-rights records. Full text remains blocked.", "office-empty");
      return;
    }
    for (const right of readerRights) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", right.publisher_host || "Publisher rights");
      header.appendChild(newsStatusBadge(right.is_active ? "active" : "inactive"));
      card.appendChild(header);
      appendText(card, "p", `${right.scope_type} · ${String(right.rights_basis || "").replaceAll("_", " ")}`);
      appendText(card, "p", `Full text: ${right.allow_full_text ? "Allowed" : "Blocked"} · Images: ${right.allow_images ? "Allowed" : "Blocked"}`);
      appendText(card, "p", right.rights_reference || "No reference recorded.");
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Edit", "office-news-text-action", "right-edit", right.id));
      actions.appendChild(newsButton("Delete", "office-news-text-action", "right-delete", right.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function populateTaxonomySelect() {
    const select = byId("office-reusable-subjects");
    const tagSelect = byId("office-tag-add-term");
    if (!select || !tagSelect) return;
    select.replaceChildren();
    tagSelect.innerHTML = '<option value="">Add a confirmed tag</option>';
    for (const term of newsTaxonomy.filter((entry) => entry.status === "active")) {
      const option = document.createElement("option");
      option.value = term.id;
      option.textContent = `${term.subject_type}: ${term.subject_name}`;
      select.appendChild(option);
      tagSelect.appendChild(option.cloneNode(true));
    }
  }

  function populateInsightStorySelect() {
    const select = byId("office-reusable-story");
    const articleSelect = byId("office-article-coverage-groups");
    const bulkSelect = byId("office-bulk-coverage-group");
    if (!select || !articleSelect || !bulkSelect) return;
    const selected = new Set(Array.from(select.selectedOptions).map((option) => option.value));
    const articleSelected = new Set(Array.from(articleSelect.selectedOptions).map((option) => option.value));
    const bulkCurrent = bulkSelect.value;
    select.replaceChildren();
    articleSelect.replaceChildren();
    bulkSelect.innerHTML = '<option value="">Choose a Coverage Group</option>';
    for (const story of coverageGroups.filter((entry) => entry.status === "active" && entry.review_status !== "rejected")) {
      const option = document.createElement("option");
      option.value = story.id;
      option.textContent = `${story.group_type || "story"}: ${story.title || "Coverage Group"}`;
      select.appendChild(option);
      articleSelect.appendChild(option.cloneNode(true));
      bulkSelect.appendChild(option.cloneNode(true));
    }
    Array.from(select.options).forEach((option) => { option.selected = selected.has(option.value); });
    Array.from(articleSelect.options).forEach((option) => { option.selected = articleSelected.has(option.value); });
    bulkSelect.value = bulkCurrent;
    syncArticleBulkToolbar();
  }

  function populateRightsSources() {
    const select = byId("office-right-source");
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Choose a source</option>';
    for (const source of newsSources) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.source_name;
      select.appendChild(option);
    }
    select.value = current;
  }

  function updateNewsAdminView() {
    document.querySelectorAll("[data-news-admin-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.newsAdminView === newsAdminView));
    });
    document.querySelectorAll("[data-news-admin-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.newsAdminPanel !== newsAdminView;
    });
  }

  function showNewsAdminView(view) {
    newsAdminView = view;
    updateNewsAdminView();
    byId("office-news-dialog")?.querySelector(".office-dialog-card")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function editReusableInsight(insightId) {
    try {
      const result = await invokeNewsAdmin("getReusableInsight", { insightId });
      openReusableInsightEditor(result.insight);
    } catch (error) {
      setNewsMessage(error?.message || "The Insight could not be loaded.");
    }
  }

  function updateNewsDashboard(dashboard) {
    newsDashboardSummary = dashboard || {};
    const pending = Number(dashboard?.requests?.pending || 0);
    const sourceCount = Object.values(dashboard?.sources || {}).reduce((total, value) => total + Number(value || 0), 0);
    const itemCount = Number(dashboard?.items?.active || newsItems.length);
    const badge = byId("office-news-count");
    badge.textContent = pending > 99 ? "99+" : String(pending);
    badge.hidden = pending === 0;
    byId("office-news-request-count").textContent = String(pending);
    byId("office-news-source-count").textContent = String(sourceCount || newsSources.length);
    if (byId("office-news-source-tab-count")) {
      byId("office-news-source-tab-count").textContent = String(sourceCount || newsSources.length);
    }
    byId("office-news-item-count").textContent = String(itemCount);
  }

  async function loadNewsAdministration() {
    if (newsAdminLoading) return;
    newsAdminLoading = true;
    const refresh = byId("office-refresh-news");
    setBusy(refresh, true, "Refreshing…", "Refresh");
    setNewsMessage("Loading news administration…");
    try {
      const [dashboardResult, sourceResult, requestResult, itemResult, reusableResult, rightsResult, coverageResult, dashboardCoverageResult] = await Promise.all([
        invokeNewsAdmin("getAdminDashboard"),
        invokeNewsAdmin("listNewsSources"),
        invokeNewsAdmin("listSourceRequests", { status: "all", limit: 200 }),
        invokeNewsAdmin("listNewsItems", { status: "active", limit: 50 }),
        invokeNewsAdmin("listReusableInsights", { reviewStatus: "all", limit: 100 }),
        invokeNewsAdmin("listReaderRights"),
        invokeNewsAdmin("listCoverageGroups", { status: "active", reviewStatus: "all", visibility: "all", limit: 100 }),
        invokeNewsAdmin("listCoverageGroups", {
          status: "active",
          reviewStatus: "all",
          visibility: "all",
          groupType: "story",
          sortBy: dashboardCoverageSort,
          windowDays: dashboardCoverageWindowDays,
          limit: 100
        })
      ]);
      newsSources = Array.isArray(sourceResult.sources) ? sourceResult.sources : [];
      newsSourceRequests = Array.isArray(requestResult.requests) ? requestResult.requests : [];
      newsItems = Array.isArray(itemResult.items) ? itemResult.items : [];
      newsSearchMeta = itemResult.search || {
        query: "",
        total: newsItems.length,
        offset: 0,
        limit: 50,
        hasMore: false
      };
      newsTaxonomy = [];
      reusableInsights = Array.isArray(reusableResult.insights) ? reusableResult.insights : [];
      readerRights = Array.isArray(rightsResult.rights) ? rightsResult.rights : [];
      coverageGroups = Array.isArray(coverageResult.coverageGroups) ? coverageResult.coverageGroups : [];
      dashboardCoverageGroups = Array.isArray(dashboardCoverageResult.coverageGroups)
        ? dashboardCoverageResult.coverageGroups
        : [];
      storyClusters = coverageGroups;
      updateNewsDashboard(dashboardResult.dashboard || {});
      renderNewsSources();
      renderNewsRequests();
      renderNewsItems();
      renderReusableInsights();
      renderReaderRights();
      renderEditorialDashboard();
      populateInsightStorySelect();
      populateRightsSources();
      setNewsMessage("");
    } catch (error) {
      console.error("News administration load failed", error);
      setNewsMessage(error?.message || "News administration could not be loaded.");
    } finally {
      newsAdminLoading = false;
      setBusy(refresh, false, "Refreshing…", "Refresh");
    }
  }

  async function loadNewsDashboardBadge() {
    try {
      const result = await invokeNewsAdmin("getAdminDashboard");
      updateNewsDashboard(result.dashboard || {});
    } catch (error) {
      console.warn("News dashboard count could not be loaded", error);
    }
  }

  function requestCard(requestId) {
    return byId("office-news-request-list")?.querySelector(`[data-request-id="${requestId}"]`);
  }

  function setSourceSelectValue(id, value, fallback) {
    const select = byId(id);
    if (!select) return;
    const requestedValue = String(value || fallback || "");
    select.querySelectorAll("[data-legacy-option]").forEach((option) => option.remove());
    const existingOption = Array.from(select.options)
      .find((option) => option.value === requestedValue);

    if (existingOption) {
      select.value = requestedValue;
      return;
    }

    if (requestedValue) {
      const legacyOption = document.createElement("option");
      legacyOption.value = requestedValue;
      legacyOption.textContent = `${requestedValue} (current)`;
      legacyOption.dataset.legacyOption = "true";
      select.appendChild(legacyOption);
      select.value = requestedValue;
      return;
    }

    select.value = fallback || "";
  }

  function openSourceEditor(request = null, source = null) {
    const form = byId("office-source-form");
    if (!form) return;
    form.reset();
    form.querySelector("[data-form-message]").textContent = "";
    editingNewsSourceId = source?.id || "";
    reviewingSourceRequestId = source ? "" : request?.id || "";
    byId("office-source-title").textContent = source
      ? "Edit News Source"
      : request
        ? "Review News Source"
        : "Add News Source";
    const requestDetails = byId("office-source-request-details");
    requestDetails.hidden = Boolean(source) || !request?.request_reason;
    requestDetails.textContent = request?.request_reason
      ? `Requester’s note: ${request.request_reason}`
      : "";
    byId("office-source-name").value = source?.source_name || request?.requested_source_name || "";
    byId("office-source-feed").value = source?.feed_url || request?.requested_feed_url || "";
    byId("office-source-website").value = source?.website_url || request?.requested_website_url || "";
    setSourceSelectValue("office-source-format", source?.feed_format, "rss");
    setSourceSelectValue("office-source-alignment", source?.alignment_label, "Not Assessed");
    setSourceSelectValue("office-source-category", source?.source_category, "Not Assessed");
    setSourceSelectValue("office-source-content", source?.content_type, "Not Assessed");
    setSourceSelectValue("office-source-media", source?.default_media_type, "unknown");
    setSourceSelectValue("office-source-access", source?.article_access, "");
    byId("office-source-submit").textContent = source ? "Save Changes" : "Add for Testing";
    openDialog(byId("office-source-dialog"));
    window.setTimeout(() => {
      (source || request?.requested_source_name ? byId("office-source-feed") : byId("office-source-name"))?.focus();
    }, 0);
  }

  async function handleNewsRequestAction(button) {
    const request = newsSourceRequests.find((entry) => entry.id === button.dataset.newsId);
    const card = requestCard(button.dataset.newsId);
    if (!request || !card) return;
    if (button.dataset.newsAction === "request-review") {
      openSourceEditor(request);
      return;
    }
    const notes = card.querySelector("[data-request-notes]")?.value.trim() || "";
    const selectedSourceId = card.querySelector("[data-request-source]")?.value || "";
    const readyLabel = button.textContent;
    setBusy(button, true, "Working…", readyLabel);
    setNewsMessage("");

    try {
      if (button.dataset.newsAction === "request-reject") {
        await invokeNewsAdmin("reviewSourceRequest", {
          requestId: request.id,
          status: "rejected",
          adminNotes: notes
        });
        showToast("Source request rejected.");
      } else if (button.dataset.newsAction === "request-duplicate") {
        if (!selectedSourceId) throw new Error("Choose the existing source first.");
        await invokeNewsAdmin("reviewSourceRequest", {
          requestId: request.id,
          status: "duplicate",
          resolvedSourceId: selectedSourceId,
          adminNotes: notes
        });
        showToast("Request linked to the existing source.");
      } else if (button.dataset.newsAction === "request-live") {
        if (!request.resolved_source_id) throw new Error("This request is not connected to a testing source.");
        await invokeNewsAdmin("reviewSourceRequest", {
          requestId: request.id,
          status: "live",
          resolvedSourceId: request.resolved_source_id,
          adminNotes: notes
        });
        showToast("Source is now live.");
      }
      await loadNewsAdministration();
    } catch (error) {
      console.error("Source request review failed", error);
      setNewsMessage(error?.message || "The source request could not be updated.");
      setBusy(button, false, "Working…", readyLabel);
    }
  }

  async function changeNewsSourceStatus(select) {
    const card = select.closest("[data-source-id]");
    const sourceId = card?.dataset.sourceId;
    const previous = select.dataset.previousStatus;
    if (!sourceId || select.value === previous) return;
    select.disabled = true;
    setNewsMessage("");
    try {
      await invokeNewsAdmin("setNewsSourceStatus", { sourceId, status: select.value });
      showToast(`Source changed to ${select.value}.`);
      await loadNewsAdministration();
    } catch (error) {
      console.error("Source status update failed", error);
      select.value = previous;
      select.disabled = false;
      setNewsMessage(error?.message || "The source status could not be changed.");
    }
  }

  async function refreshNewsSource(button) {
    const readyLabel = button.textContent;
    setBusy(button, true, "Importing…", readyLabel);
    setNewsMessage("");
    try {
      await invokeNewsAdmin("triggerNewsIngest", { sourceId: button.dataset.newsId });
      showToast("Feed refreshed.");
      await loadNewsAdministration();
    } catch (error) {
      console.error("Manual news import failed", error);
      setNewsMessage(error?.message || "The feed could not be refreshed.");
      setBusy(button, false, "Importing…", readyLabel);
    }
  }

  async function submitNewsSource(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    const values = Object.fromEntries(new FormData(form).entries());
    const editing = Boolean(editingNewsSourceId);
    const readyLabel = editing ? "Save Changes" : "Add for Testing";
    setBusy(button, true, editing ? "Saving…" : "Adding…", readyLabel);
    message.textContent = "";
    try {
      await invokeNewsAdmin(editing ? "updateNewsSource" : "createNewsSource", {
        ...values,
        ...(editing
          ? { sourceId: editingNewsSourceId }
          : {
              ...(reviewingSourceRequestId ? { requestId: reviewingSourceRequestId } : {}),
              status: "testing"
            })
      });
      form.reset();
      editingNewsSourceId = "";
      reviewingSourceRequestId = "";
      closeDialog(byId("office-source-dialog"));
      showToast(editing ? "Source changes saved." : "Source added for testing.");
      newsAdminView = "sources";
      updateNewsAdminView();
      await loadNewsAdministration();
    } catch (error) {
      console.error("News source creation failed", error);
      message.textContent = error?.message || "The news source could not be added.";
    } finally {
      setBusy(button, false, editing ? "Saving…" : "Adding…", readyLabel);
    }
  }

  async function filterNewsItems(event) {
    event?.preventDefault();
    const form = byId("office-news-filter-form");
    const button = form?.querySelector('button[type="submit"]');
    setBusy(button, true, "Searching…", "Search");
    setNewsMessage("");
    activeSubjectFilter = "";
    activeStoryFilter = "";
    try {
      const result = await invokeNewsAdmin("listNewsItems", {
        status: "active",
        limit: 50,
        offset: 0,
        sourceId: byId("office-news-source-filter").value,
        search: byId("office-news-search").value.trim()
      });
      newsItems = Array.isArray(result.items) ? result.items : [];
      newsSearchMeta = result.search || {
        query: byId("office-news-search").value.trim(),
        total: newsItems.length,
        offset: 0,
        limit: 50,
        hasMore: false
      };
      renderNewsItems();
    } catch (error) {
      console.error("News article search failed", error);
      setNewsMessage(error?.message || "The articles could not be loaded.");
    } finally {
      setBusy(button, false, "Searching…", "Search");
    }
  }

  async function loadMoreNewsItems() {
    const button = byId("office-news-load-more");
    if (!newsSearchMeta.hasMore || button?.disabled) return;
    setBusy(button, true, "Loading…", "Load More");
    try {
      const result = await invokeNewsAdmin("listNewsItems", {
        status: "active",
        limit: Number(newsSearchMeta.limit || 50),
        offset: newsItems.length,
        sourceId: byId("office-news-source-filter").value,
        search: byId("office-news-search").value.trim()
      });
      const incoming = Array.isArray(result.items) ? result.items : [];
      const knownIds = new Set(newsItems.map((item) => String(item.id)));
      newsItems.push(...incoming.filter((item) => !knownIds.has(String(item.id))));
      newsSearchMeta = result.search || {
        ...newsSearchMeta,
        offset: newsItems.length,
        hasMore: incoming.length === Number(newsSearchMeta.limit || 50)
      };
      renderNewsItems();
    } catch (error) {
      console.error("More news articles could not be loaded", error);
      showToast(error?.message || "More articles could not be loaded.");
    } finally {
      setBusy(button, false, "Loading…", "Load More");
    }
  }

  async function loadScopedNewsItems({ subjectId = "", storyClusterId = "" } = {}) {
    setNewsMessage("Loading matching articles…");
    try {
      const result = await invokeNewsAdmin("listNewsItems", {
        status: "active",
        limit: 100,
        subjectId,
        storyClusterId
      });
      newsItems = Array.isArray(result.items) ? result.items : [];
      newsSearchMeta = result.search || {
        query: "",
        total: newsItems.length,
        offset: 0,
        limit: 100,
        hasMore: false
      };
      activeSubjectFilter = subjectId;
      activeStoryFilter = storyClusterId;
      renderNewsItems();
      setNewsMessage("");
    } catch (error) {
      setNewsMessage(error?.message || "The matching articles could not be loaded.");
    }
  }

  function syncInsightPublicControl() {
    const published = byId("office-insight-status")?.value === "published";
    const checkbox = byId("office-insight-public");
    if (!checkbox) return;
    checkbox.disabled = !published;
    if (!published) checkbox.checked = false;
  }

  async function openNewsInsight(itemId) {
    setNewsMessage("Loading article…");
    try {
      const result = await invokeNewsAdmin("getNewsItem", { itemId });
      selectedNewsItem = result.item || null;
      if (!selectedNewsItem) throw new Error("The article could not be found.");
      const insight = selectedNewsItem.insight || {};
      byId("office-insight-title").textContent = selectedNewsItem.headline || "Owl Insight";
      byId("office-insight-source").textContent = selectedNewsItem.source?.source_name || "News article";
      byId("office-insight-item-id").value = selectedNewsItem.id;
      byId("office-insight-label").value = insight.owl_label || "";
      byId("office-insight-analysis").value = insight.owl_analysis || "";
      byId("office-insight-status").value = insight.review_status === "published" ? "published" : "draft";
      byId("office-insight-public").checked = Boolean(insight.is_public);
      syncInsightPublicControl();

      const original = byId("office-insight-link");
      const url = safeUrl(selectedNewsItem.canonical_url);
      original.hidden = !url;
      if (url) original.href = url;
      byId("office-hide-insight").hidden = !selectedNewsItem.insight || insight.review_status === "hidden";
      byId("office-insight-form").querySelector("[data-form-message]").textContent = "";
      openDialog(byId("office-insight-dialog"));
      setNewsMessage("");
    } catch (error) {
      console.error("News article load failed", error);
      setNewsMessage(error?.message || "The article could not be loaded.");
    }
  }

  async function saveNewsInsight(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    setBusy(button, true, "Saving…", "Save Insight");
    message.textContent = "";
    try {
      await invokeNewsAdmin("saveNewsInsight", {
        itemId: byId("office-insight-item-id").value,
        owlLabel: byId("office-insight-label").value.trim(),
        labels: [],
        owlAnalysis: byId("office-insight-analysis").value.trim(),
        reviewStatus: byId("office-insight-status").value,
        public: byId("office-insight-public").checked
      });
      closeDialog(byId("office-insight-dialog"));
      showToast("Owl Insight saved.");
      await loadNewsAdministration();
    } catch (error) {
      console.error("Owl Insight save failed", error);
      message.textContent = error?.message || "The Owl Insight could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Insight");
    }
  }

  async function hideNewsInsight() {
    const button = byId("office-hide-insight");
    const message = byId("office-insight-form")?.querySelector("[data-form-message]");
    const itemId = byId("office-insight-item-id")?.value;
    if (!itemId) return;
    setBusy(button, true, "Hiding…", "Hide Insight");
    if (message) message.textContent = "";
    try {
      await invokeNewsAdmin("hideNewsInsight", { itemId });
      closeDialog(byId("office-insight-dialog"));
      showToast("Owl Insight hidden.");
      await loadNewsAdministration();
    } catch (error) {
      console.error("Owl Insight hide failed", error);
      if (message) message.textContent = error?.message || "The Owl Insight could not be hidden.";
    } finally {
      setBusy(button, false, "Hiding…", "Hide Insight");
    }
  }

  function renderTagAssignments(assignments) {
    const list = byId("office-tag-review-list");
    list.replaceChildren();
    if (!assignments.length) {
      appendText(list, "p", "No tags have been suggested for this article.", "office-empty");
      return;
    }
    for (const assignment of assignments) {
      const card = document.createElement("article");
      card.className = "office-tag-review-card";
      const name = assignment.news_subjects?.subject_name || "Taxonomy term";
      appendText(card, "strong", name);
      appendText(card, "span", `${assignment.news_subjects?.subject_type || "tag"} · ${assignment.assignment_status} · ${Math.round(Number(assignment.confidence || 0) * 100)}%`);
      const evidence = assignment.evidence?.matches?.map((match) => `${match.scope}: ${match.alias}`).join(" · ");
      if (evidence) appendText(card, "small", evidence);
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton("Confirm", "office-news-text-action", "tag-confirm", assignment.subject_id));
      actions.appendChild(newsButton("Reject", "office-news-text-action", "tag-reject", assignment.subject_id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  async function openTagReview(itemId) {
    setNewsMessage("Loading article tags…");
    try {
      const result = await invokeNewsAdmin("getNewsItem", { itemId });
      selectedNewsItem = result.item;
      if (!selectedNewsItem) throw new Error("The article could not be found.");
      byId("office-tag-title").textContent = selectedNewsItem.headline || "Review Suggested Tags";
      byId("office-tag-source").textContent = selectedNewsItem.source?.source_name || "News article";
      byId("office-tag-item-id").value = selectedNewsItem.id;
      byId("office-tag-access").value = selectedNewsItem.article_access_override || "";
      byId("office-tag-message").textContent = "";
      renderTagAssignments(selectedNewsItem.subjectAssignments || []);
      openDialog(byId("office-tag-dialog"));
      setNewsMessage("");
    } catch (error) {
      setNewsMessage(error?.message || "Article tags could not be loaded.");
    }
  }

  async function reviewTag(subjectId, status, manual = false) {
    const itemId = byId("office-tag-item-id").value;
    try {
      await invokeNewsAdmin("reviewItemSubject", {
        itemId,
        subjectId,
        assignmentStatus: status,
        manual
      });
      await openTagReview(itemId);
      showToast(status === "confirmed" ? "Tag confirmed." : "Tag rejected.");
    } catch (error) {
      byId("office-tag-message").textContent = error?.message || "The tag could not be reviewed.";
    }
  }

  async function saveArticleAccessOverride() {
    const button = byId("office-save-tag-access");
    setBusy(button, true, "Saving…", "Save Access Setting");
    try {
      await invokeNewsAdmin("updateNewsItem", {
        itemId: byId("office-tag-item-id").value,
        articleAccessOverride: byId("office-tag-access").value
      });
      showToast("Article access setting saved.");
    } catch (error) {
      byId("office-tag-message").textContent = error?.message || "The access setting could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Access Setting");
    }
  }

  function openTaxonomyEditor(term = null) {
    const form = byId("office-taxonomy-form");
    form.reset();
    form.querySelector("[data-form-message]").textContent = "";
    byId("office-taxonomy-id").value = term?.id || "";
    byId("office-taxonomy-name").value = term?.subject_name || "";
    byId("office-taxonomy-type").value = term?.subject_type || "subject";
    byId("office-taxonomy-status").value = term?.status || "active";
    byId("office-taxonomy-description").value = term?.description || "";
    byId("office-taxonomy-title").textContent = term ? "Edit Taxonomy Term" : "Add Taxonomy Term";
    openDialog(byId("office-taxonomy-dialog"));
  }

  async function saveTaxonomyTerm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    setBusy(button, true, "Saving…", "Save Term");
    try {
      await invokeNewsAdmin("saveTaxonomyTerm", {
        subjectId: byId("office-taxonomy-id").value || undefined,
        subjectName: byId("office-taxonomy-name").value.trim(),
        taxonomyType: byId("office-taxonomy-type").value,
        status: byId("office-taxonomy-status").value,
        description: byId("office-taxonomy-description").value.trim()
      });
      closeDialog(byId("office-taxonomy-dialog"));
      showToast("Taxonomy term saved.");
      await loadNewsAdministration();
    } catch (error) {
      message.textContent = error?.message || "The taxonomy term could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Term");
    }
  }

  async function addTaxonomyAlias(card, subjectId) {
    const input = card.querySelector("[data-alias-input]");
    const aliasText = input?.value.trim();
    if (!aliasText) return;
    try {
      await invokeNewsAdmin("saveTaxonomyAlias", {
        subjectId,
        aliasText,
        matchScope: "any",
        matchType: "phrase",
        weight: 1,
        active: true
      });
      showToast("Matching phrase added.");
      await loadNewsAdministration();
    } catch (error) {
      setNewsMessage(error?.message || "The matching phrase could not be added.");
    }
  }

  function openReusableInsightEditor(insight = null, options = {}) {
    const form = byId("office-reusable-insight-form");
    form.reset();
    form.querySelector("[data-form-message]").textContent = "";
    const seededItem = options.item || null;
    editingReusableInsight = insight || (seededItem ? {
      scope_type: "article",
      owl_insight_items: [{ news_item_id: seededItem.id, relationship: "include", news_items: seededItem }]
    } : null);
    byId("office-reusable-insight-id").value = insight?.id || "";
    byId("office-reusable-label").value = insight?.owl_label || "";
    byId("office-reusable-analysis").value = insight?.owl_analysis || "";
    byId("office-reusable-status").value = insight?.review_status === "published" ? "published" : "draft";
    byId("office-reusable-public").checked = Boolean(insight?.is_public);
    const scope = editingReusableInsight?.scope_type === "article" ? "article" : "cluster";
    const articleScopeControl = form.querySelector('input[name="officeReusableScope"][value="article"]');
    const linkedItems = editingReusableInsight?.owl_insight_items || [];
    if (articleScopeControl) articleScopeControl.disabled = !linkedItems.length;
    const scopeControl = form.querySelector(`input[name="officeReusableScope"][value="${scope}"]`);
    if (scopeControl) scopeControl.checked = true;
    const selected = new Set((insight?.owl_insight_clusters || []).map((row) => String(row.story_cluster_id || row.news_story_clusters?.id || "")));
    if (options.coverageGroupId) selected.add(String(options.coverageGroupId));
    Array.from(byId("office-reusable-story").options).forEach((option) => {
      option.selected = selected.has(option.value);
    });
    syncReusableInsightScope();
    openDialog(byId("office-reusable-insight-dialog"));
  }

  function selectedReusableInsightScope() {
    return document.querySelector('input[name="officeReusableScope"]:checked')?.value || "cluster";
  }

  function syncReusableInsightScope() {
    const scope = selectedReusableInsightScope();
    byId("office-reusable-story-fields").hidden = scope !== "cluster";
    const reach = byId("office-reusable-reach");
    if (!reach) return;
    if (scope === "cluster") {
      const selectedIds = new Set(Array.from(byId("office-reusable-story").selectedOptions).map((option) => option.value));
      const selectedGroups = coverageGroups.filter((entry) => selectedIds.has(String(entry.id)));
      const articleCount = selectedGroups.reduce((total, group) => total + Number(group.stats?.article_count || 0), 0);
      const sourceCount = new Set(selectedGroups.flatMap((group) => (group.alignmentCoverage || []).map((row) => `${group.id}:${row.alignment_label}`))).size;
      reach.textContent = selectedGroups.length
        ? `This will follow ${articleCount} confirmed article${articleCount === 1 ? "" : "s"} across ${selectedGroups.length} Coverage Group${selectedGroups.length === 1 ? "" : "s"}${sourceCount ? ` and ${sourceCount} alignment segment${sourceCount === 1 ? "" : "s"}` : ""}.`
        : "Choose at least one Coverage Group.";
      return;
    }
    if (scope === "article") {
      const linked = editingReusableInsight?.owl_insight_items || [];
      reach.textContent = `This Insight is connected to ${linked.length || 1} selected article${linked.length === 1 ? "" : "s"}.`;
      return;
    }
  }

  async function saveReusableInsight(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    const coverageGroupIds = Array.from(byId("office-reusable-story").selectedOptions).map((option) => option.value);
    const scopeType = selectedReusableInsightScope();
    setBusy(button, true, "Saving…", "Save Reusable Insight");
    try {
      await invokeNewsAdmin("saveReusableInsight", {
        insightId: byId("office-reusable-insight-id").value || undefined,
        owlLabel: byId("office-reusable-label").value.trim(),
        owlAnalysis: byId("office-reusable-analysis").value.trim(),
        scopeType,
        coverageGroupIds: scopeType === "cluster" ? coverageGroupIds : [],
        reviewStatus: byId("office-reusable-status").value,
        public: byId("office-reusable-public").checked,
        itemLinks: (editingReusableInsight?.owl_insight_items || []).map((row) => ({
          itemId: row.news_item_id,
          relationship: row.relationship
        }))
      });
      closeDialog(byId("office-reusable-insight-dialog"));
      showToast("Reusable Owl Insight saved.");
      await loadNewsAdministration();
    } catch (error) {
      message.textContent = error?.message || "The reusable Insight could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Reusable Insight");
    }
  }

  function openCoverageGroupEditor(group = null, options = {}) {
    const form = byId("office-coverage-group-form");
    form.reset();
    form.querySelector("[data-form-message]").textContent = "";
    byId("office-coverage-group-id").value = group?.id || "";
    byId("office-coverage-group-name").value = group?.title || "";
    byId("office-coverage-group-type").value = group?.group_type || "story";
    byId("office-coverage-group-visibility").value = group?.visibility || "private";
    byId("office-coverage-group-summary").value = group?.summary || "";
    coverageGroupDraft = {
      itemIds: group ? [] : [...new Set((options.itemIds || []).map(String).filter(Boolean))],
      onSaved: typeof options.onSaved === "function" ? options.onSaved : null,
      onCancel: typeof options.onCancel === "function" ? options.onCancel : null
    };
    byId("office-coverage-group-title").textContent = group ? "Edit Coverage Group" : "New Coverage Group";
    openDialog(byId("office-coverage-group-dialog"));
  }

  async function saveCoverageGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    setBusy(button, true, "Saving…", "Save Coverage Group");
    message.textContent = "";
    try {
      const result = await invokeNewsAdmin("saveCoverageGroup", {
        coverageGroupId: byId("office-coverage-group-id").value || undefined,
        title: byId("office-coverage-group-name").value.trim(),
        groupType: byId("office-coverage-group-type").value,
        visibility: byId("office-coverage-group-visibility").value,
        reviewStatus: "confirmed",
        status: "active",
        summary: byId("office-coverage-group-summary").value.trim(),
        itemIds: coverageGroupDraft.itemIds
      });
      const savedGroupId = String(result.coverageGroup?.id || result.storyCluster?.id || byId("office-coverage-group-id").value || "");
      const onSaved = coverageGroupDraft.onSaved;
      coverageGroupDraft.onCancel = null;
      closeDialog(byId("office-coverage-group-dialog"));
      showToast("Coverage Group saved.");
      await loadNewsAdministration();
      if (onSaved && savedGroupId) onSaved(savedGroupId);
    } catch (error) {
      message.textContent = error?.message || "The Coverage Group could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Coverage Group");
    }
  }

  async function openArticleCoverage(itemId) {
    setNewsMessage("Loading article coverage…");
    try {
      const result = await invokeNewsAdmin("getNewsItem", { itemId });
      selectedNewsItem = result.item || null;
      if (!selectedNewsItem) throw new Error("The article could not be found.");
      byId("office-article-coverage-item-id").value = selectedNewsItem.id;
      byId("office-article-coverage-title").textContent = selectedNewsItem.headline || "Assign Coverage";
      byId("office-article-coverage-source").textContent = selectedNewsItem.source?.source_name || "News article";
      byId("office-article-coverage-form").querySelector("[data-form-message]").textContent = "";
      const assignedIds = new Set((selectedNewsItem.storyAssignments || [])
        .filter((row) => row.membership_status === "confirmed")
        .map((row) => String(row.news_story_clusters?.id || "")));
      Array.from(byId("office-article-coverage-groups").options).forEach((option) => {
        option.selected = assignedIds.has(option.value);
      });
      const signals = byId("office-article-coverage-signals");
      signals.replaceChildren();
      const usefulSignals = (selectedNewsItem.coverageSignals || []).filter((signal) => !["author", "keyword"].includes(signal.signal_type));
      if (usefulSignals.length) {
        appendText(signals, "strong", "Article signals");
        const row = document.createElement("div");
        row.className = "office-coverage-chip-row";
        for (const signal of usefulSignals.slice(0, 16)) appendText(row, "span", signal.display_value);
        signals.appendChild(row);
      }
      openDialog(byId("office-article-coverage-dialog"));
      setNewsMessage("");
    } catch (error) {
      setNewsMessage(error?.message || "Article coverage could not be loaded.");
    }
  }

  async function saveArticleCoverage(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    const itemId = byId("office-article-coverage-item-id").value;
    const groupIds = Array.from(byId("office-article-coverage-groups").selectedOptions).map((option) => option.value);
    if (!groupIds.length) {
      message.textContent = "Choose at least one Coverage Group.";
      return;
    }
    setBusy(button, true, "Applying…", "Apply Coverage");
    try {
      await Promise.all(groupIds.map((coverageGroupId) => invokeNewsAdmin("bulkAssignCoverageGroupItems", {
        coverageGroupId,
        itemIds: [itemId],
        membershipStatus: "confirmed"
      })));
      closeDialog(byId("office-article-coverage-dialog"));
      showToast(`Article added to ${groupIds.length} Coverage Group${groupIds.length === 1 ? "" : "s"}.`);
      await loadNewsAdministration();
    } catch (error) {
      message.textContent = error?.message || "Coverage could not be applied.";
    } finally {
      setBusy(button, false, "Applying…", "Apply Coverage");
    }
  }

  async function assignSelectedArticles() {
    const coverageGroupId = byId("office-bulk-coverage-group")?.value || "";
    if (!coverageGroupId || !selectedArticleIds.size) return;
    const button = byId("office-assign-selected-articles");
    setBusy(button, true, "Applying…", "Apply Group");
    try {
      await invokeNewsAdmin("bulkAssignCoverageGroupItems", {
        coverageGroupId,
        itemIds: [...selectedArticleIds],
        membershipStatus: "confirmed"
      });
      showToast(`${selectedArticleIds.size} article${selectedArticleIds.size === 1 ? "" : "s"} added to the Coverage Group.`);
      selectedArticleIds.clear();
      await loadNewsAdministration();
    } catch (error) {
      setNewsMessage(error?.message || "The selected articles could not be assigned.");
    } finally {
      setBusy(button, false, "Applying…", "Apply Group");
      syncArticleBulkToolbar();
    }
  }

  async function openReusableInsightForArticle(itemId) {
    try {
      const result = await invokeNewsAdmin("getNewsItem", { itemId });
      if (!result.item) throw new Error("The article could not be found.");
      openReusableInsightEditor(null, { item: result.item });
    } catch (error) {
      setNewsMessage(error?.message || "The article could not be loaded.");
    }
  }

  function sourceForRight(right) {
    return newsSources.find((source) => source.id === right?.news_source_id) || null;
  }

  function openRightsEditor(right = null) {
    const form = byId("office-rights-form");
    form.reset();
    form.querySelector("[data-form-message]").textContent = "";
    byId("office-right-id").value = right?.id || "";
    byId("office-right-scope").value = right?.scope_type || "publisher";
    byId("office-right-basis").value = right?.rights_basis || "permission";
    byId("office-right-source").value = right?.news_source_id || "";
    byId("office-right-item").value = right?.news_item_id || "";
    byId("office-right-host").value = right?.publisher_host || "";
    byId("office-right-reference").value = right?.rights_reference || "";
    byId("office-right-full-text").checked = Boolean(right?.allow_full_text);
    byId("office-right-images").checked = Boolean(right?.allow_images);
    byId("office-right-active").checked = right ? Boolean(right.is_active) : true;
    openDialog(byId("office-rights-dialog"));
  }

  async function saveReaderRight(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-form-message]");
    setBusy(button, true, "Saving…", "Save Rights Record");
    try {
      await invokeNewsAdmin("saveReaderRight", {
        rightId: byId("office-right-id").value || undefined,
        scopeType: byId("office-right-scope").value,
        rightsBasis: byId("office-right-basis").value,
        sourceId: byId("office-right-source").value || undefined,
        itemId: byId("office-right-item").value.trim() || undefined,
        publisherHost: byId("office-right-host").value.trim(),
        rightsReference: byId("office-right-reference").value.trim(),
        allowFullText: byId("office-right-full-text").checked,
        allowImages: byId("office-right-images").checked,
        active: byId("office-right-active").checked
      });
      closeDialog(byId("office-rights-dialog"));
      showToast("Reader-rights record saved.");
      await loadNewsAdministration();
    } catch (error) {
      message.textContent = error?.message || "The rights record could not be saved.";
    } finally {
      setBusy(button, false, "Saving…", "Save Rights Record");
    }
  }

  async function deleteReaderRight(rightId) {
    if (!window.confirm("Delete this Reader-rights record? Full text may become unavailable.")) return;
    try {
      await invokeNewsAdmin("deleteReaderRight", { rightId });
      showToast("Reader-rights record deleted.");
      await loadNewsAdministration();
    } catch (error) {
      setNewsMessage(error?.message || "The rights record could not be deleted.");
    }
  }

  function renderInbox() {
    const list = byId("office-inbox-list");
    const active = inboxRequests.filter((request) => request.status !== "archived");
    const archived = inboxRequests.filter((request) => request.status === "archived");
    byId("office-active-count").textContent = active.length;
    byId("office-archive-count").textContent = archived.length;
    document.querySelectorAll("[data-inbox-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.inboxView === inboxView));
    });
    list.replaceChildren();
    const requests = filteredInboxRequests();
    if (!requests.length) {
      appendText(list, "p", inboxView === "archived" ? "No archived requests." : "No active requests.", "office-empty");
      return;
    }

    for (const request of requests) {
      const card = document.createElement("article");
      card.className = "office-inbox-card";
      const header = document.createElement("div");
      header.className = "office-inbox-card-header";
      appendText(header, "h3", request.topic || "Untitled request");
      const time = appendText(header, "time", formatDate(request.created_at));
      if (request.created_at) time.dateTime = request.created_at;
      card.appendChild(header);
      appendText(
        card,
        "p",
        `${request.submitted_email || "No email"} · ${sourceLabel(request.requester_source)}`,
        "office-inbox-meta"
      );
      if (request.audience_take) {
        appendText(card, "p", request.audience_take, "office-inbox-take");
      }

      const select = document.createElement("select");
      select.setAttribute("aria-label", `Status for ${request.topic || "request"}`);
      for (const [value, label] of [
        ["new", "New"],
        ["read", "Read"],
        ["researching", "Researching"],
        ["completed", "Complete"],
        ["archived", "Archived"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = request.status === value;
        select.appendChild(option);
      }
      select.addEventListener("change", () => updateRequestStatus(request, select.value, select));
      card.appendChild(select);
      list.appendChild(card);
    }
  }

  async function loadInbox() {
    const message = byId("office-inbox-message");
    message.textContent = "Loading requests…";
    try {
      const client = requireCurrentAdministrator();
      const { data, error } = await client
        .from(REQUEST_TABLE)
        .select("id,submitted_email,submitted_user_id,requester_source,topic,audience_take,status,created_at,reviewed_at,status_updated_at,archived_from")
        .order("created_at", { ascending: false });
      if (error) throw error;
      inboxRequests = Array.isArray(data) ? data : [];
      message.textContent = "";
      renderInbox();
      updateInboxBadge();
    } catch (error) {
      console.error("Inbox load failed", error);
      message.textContent = error?.message || "The Owl Inbox could not be loaded.";
    }
  }

  function updateInboxBadge() {
    const count = inboxRequests.filter((request) => request.status === "new").length;
    const badge = byId("office-inbox-count");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  }

  async function updateRequestStatus(request, nextStatus, select) {
    const currentStatus = request.status || "new";
    if (nextStatus === currentStatus) return;
    select.disabled = true;
    try {
      const client = requireCurrentAdministrator();
      const now = new Date().toISOString();
      const updates = { status: nextStatus, status_updated_at: now };
      if (nextStatus === "read" && !request.reviewed_at) updates.reviewed_at = now;
      if (nextStatus === "archived") {
        updates.archived_from = ["new", "read", "researching", "completed"].includes(currentStatus)
          ? currentStatus
          : "read";
      } else if (currentStatus === "archived") {
        updates.archived_from = null;
      }
      const { error } = await client.from(REQUEST_TABLE).update(updates).eq("id", request.id);
      if (error) throw error;
      await loadInbox();
    } catch (error) {
      console.error("Inbox status update failed", error);
      select.value = currentStatus;
      showToast(error?.message || "The request could not be updated.");
    } finally {
      select.disabled = false;
    }
  }

  async function signOut() {
    const button = byId("office-confirm-sign-out");
    setBusy(button, true, "Signing Out…", "Sign Out");
    try {
      await administrator?.client?.auth.signOut();
    } catch (error) {
      console.warn("Supabase sign out failed", error);
    }
    window.StrategicOwlAccess?.clear();
    window.location.replace("index.html");
  }

  function bindDialogs() {
    document.querySelectorAll(".office-dialog").forEach((dialog) => {
      dialog.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => closeDialog(dialog));
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener("close", () => {
        if (dialog.id === "office-coverage-group-dialog" && coverageGroupDraft.onCancel) {
          const onCancel = coverageGroupDraft.onCancel;
          coverageGroupDraft.onCancel = null;
          onCancel();
        }
        if (!document.querySelector(".office-dialog[open]")) {
          document.body.classList.remove("owl-dialog-open");
        }
      });
    });
  }

  function bindOfficeControls() {
    bindDialogs();
    byId("office-new-post")?.addEventListener("click", () => openDialog(byId("office-post-dialog")));
    byId("office-inbox")?.addEventListener("click", async () => {
      openDialog(byId("office-inbox-dialog"));
      await loadInbox();
    });
    byId("office-news-admin")?.addEventListener("click", async () => {
      openDialog(byId("office-news-dialog"));
      updateNewsAdminView();
      await loadNewsAdministration();
    });
    byId("office-refresh-inbox")?.addEventListener("click", loadInbox);
    byId("office-refresh-news")?.addEventListener("click", loadNewsAdministration);
    document.querySelectorAll("[data-inbox-view]").forEach((button) => {
      button.addEventListener("click", () => {
        inboxView = button.dataset.inboxView;
        renderInbox();
      });
    });
    document.querySelectorAll("[data-news-admin-view]").forEach((button) => {
      button.addEventListener("click", () => {
        showNewsAdminView(button.dataset.newsAdminView);
      });
    });
    document.querySelectorAll("[data-coverage-sort]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextSort = button.dataset.coverageSort === "newest" ? "newest" : "coverage";
        if (nextSort === dashboardCoverageSort) return;
        dashboardCoverageSort = nextSort;
        renderEditorialDashboard();
        await loadDashboardCoverage();
      });
    });
    document.querySelectorAll("[data-coverage-window]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextWindow = Number(button.dataset.coverageWindow || 7);
        if (![1, 7, 30].includes(nextWindow) || nextWindow === dashboardCoverageWindowDays) return;
        dashboardCoverageWindowDays = nextWindow;
        renderEditorialDashboard();
        await loadDashboardCoverage();
      });
    });
    byId("office-news-dialog")?.addEventListener("click", (event) => {
      const dashboardTarget = event.target.closest("[data-dashboard-target]");
      if (dashboardTarget) {
        showNewsAdminView(dashboardTarget.dataset.dashboardTarget);
        return;
      }
      const manageTarget = event.target.closest("[data-manage-target]");
      if (manageTarget) {
        showNewsAdminView(manageTarget.dataset.manageTarget);
        return;
      }
      const action = event.target.closest("[data-news-action]");
      if (!action) return;
      if (action.dataset.newsAction === "reusable-edit") editReusableInsight(action.dataset.newsId);
      if (action.dataset.newsAction === "clear-story-filter") {
        activeStoryFilter = "";
        filterNewsItems();
      }
      if (action.dataset.newsAction === "story-insight") {
        openReusableInsightEditor(null, { coverageGroupId: action.dataset.newsId || "" });
      }
      if (action.dataset.newsAction === "story-view") {
        const storyClusterId = action.dataset.newsId || "";
        byId("office-news-search").value = "";
        showNewsAdminView("articles");
        loadScopedNewsItems({ storyClusterId });
      }
      if (action.dataset.newsAction === "coverage-edit") {
        const group = coverageGroups.find((entry) => String(entry.id) === String(action.dataset.newsId));
        if (group) openCoverageGroupEditor(group);
      }
    });
    byId("office-desk-search-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      deskSearch = byId("office-desk-search").value.trim();
      renderSubjectDashboard();
    });
    byId("office-dashboard-new-insight")?.addEventListener("click", () => openReusableInsightEditor());
    byId("office-taxonomy-search")?.addEventListener("input", (event) => {
      taxonomySearch = event.target.value.trim();
      renderTaxonomy();
    });
    document.querySelectorAll("[data-source-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        newsSourceFilter = button.dataset.sourceFilter || "all";
        renderNewsSources();
      });
    });
    byId("office-news-request-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='request-']");
      if (button) handleNewsRequestAction(button);
    });
    byId("office-news-source-list")?.addEventListener("change", (event) => {
      const select = event.target.closest("[data-source-status]");
      if (select) changeNewsSourceStatus(select);
    });
    byId("office-news-source-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='source-']");
      if (!button) return;
      if (button.dataset.newsAction === "source-edit") {
        const source = newsSources.find((entry) => entry.id === button.dataset.newsId);
        if (source) openSourceEditor(null, source);
      } else if (button.dataset.newsAction === "source-ingest") {
        refreshNewsSource(button);
      }
    });
    byId("office-news-item-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='article-']");
      if (!button) return;
      if (button.dataset.newsAction === "article-insight") openReusableInsightForArticle(button.dataset.newsId);
      if (button.dataset.newsAction === "article-coverage") openArticleCoverage(button.dataset.newsId);
      if (button.dataset.newsAction === "article-new-group") {
        const item = newsItems.find((entry) => String(entry.id) === String(button.dataset.newsId));
        openCoverageGroupEditor(null, { itemIds: [button.dataset.newsId], title: item?.headline || "" });
        if (item?.headline) byId("office-coverage-group-name").value = item.headline;
      }
    });
    byId("office-news-item-list")?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-article]");
      if (!checkbox) return;
      if (checkbox.checked) selectedArticleIds.add(String(checkbox.dataset.selectArticle));
      else selectedArticleIds.delete(String(checkbox.dataset.selectArticle));
      syncArticleBulkToolbar();
    });
    document.querySelectorAll("[data-taxonomy-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        taxonomyFilter = button.dataset.taxonomyFilter || "all";
        document.querySelectorAll("[data-taxonomy-filter]").forEach((entry) => {
          entry.setAttribute("aria-pressed", String(entry === button));
        });
        renderTaxonomy();
      });
    });
    byId("office-taxonomy-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='taxonomy-']");
      if (!button) return;
      const term = newsTaxonomy.find((entry) => entry.id === button.dataset.newsId);
      if (button.dataset.newsAction === "taxonomy-edit" && term) openTaxonomyEditor(term);
      if (button.dataset.newsAction === "taxonomy-alias") {
        addTaxonomyAlias(button.closest("[data-taxonomy-id]"), button.dataset.newsId);
      }
    });
    byId("office-rights-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='right-']");
      if (!button) return;
      const right = readerRights.find((entry) => entry.id === button.dataset.newsId);
      if (button.dataset.newsAction === "right-edit" && right) openRightsEditor(right);
      if (button.dataset.newsAction === "right-delete") deleteReaderRight(button.dataset.newsId);
    });
    byId("office-tag-review-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-news-action^='tag-']");
      if (!button) return;
      reviewTag(button.dataset.newsId, button.dataset.newsAction === "tag-confirm" ? "confirmed" : "rejected");
    });
    byId("office-add-confirmed-tag")?.addEventListener("click", () => {
      const subjectId = byId("office-tag-add-term").value;
      if (subjectId) reviewTag(subjectId, "confirmed", true);
    });
    byId("office-save-tag-access")?.addEventListener("click", saveArticleAccessOverride);
    byId("office-add-taxonomy")?.addEventListener("click", () => openTaxonomyEditor());
    byId("office-taxonomy-form")?.addEventListener("submit", saveTaxonomyTerm);
    byId("office-add-reusable-insight")?.addEventListener("click", () => openReusableInsightEditor());
    byId("office-reusable-insight-form")?.addEventListener("submit", saveReusableInsight);
    document.querySelectorAll('input[name="officeReusableScope"]').forEach((input) => input.addEventListener("change", syncReusableInsightScope));
    byId("office-reusable-story")?.addEventListener("change", syncReusableInsightScope);
    byId("office-add-coverage-group")?.addEventListener("click", () => openCoverageGroupEditor());
    byId("office-coverage-group-form")?.addEventListener("submit", saveCoverageGroup);
    byId("office-article-coverage-form")?.addEventListener("submit", saveArticleCoverage);
    byId("office-bulk-coverage-group")?.addEventListener("change", syncArticleBulkToolbar);
    byId("office-assign-selected-articles")?.addEventListener("click", assignSelectedArticles);
    byId("office-create-group-selected")?.addEventListener("click", () => {
      const ids = [...selectedArticleIds];
      const first = newsItems.find((entry) => ids.includes(String(entry.id)));
      openCoverageGroupEditor(null, { itemIds: ids });
      if (first?.headline) byId("office-coverage-group-name").value = first.headline;
    });
    byId("office-article-create-group")?.addEventListener("click", () => {
      const itemId = byId("office-article-coverage-item-id")?.value || "";
      closeDialog(byId("office-article-coverage-dialog"));
      openCoverageGroupEditor(null, { itemIds: [itemId] });
      if (selectedNewsItem?.headline) byId("office-coverage-group-name").value = selectedNewsItem.headline;
    });
    byId("office-insight-create-group")?.addEventListener("click", () => {
      const itemIds = (editingReusableInsight?.owl_insight_items || []).map((row) => row.news_item_id).filter(Boolean);
      const draftInsight = {
        ...(editingReusableInsight || {}),
        owl_label: byId("office-reusable-label")?.value || "",
        owl_analysis: byId("office-reusable-analysis")?.value || "",
        review_status: byId("office-reusable-status")?.value || "draft",
        is_public: Boolean(byId("office-reusable-public")?.checked),
        scope_type: "cluster",
        owl_insight_clusters: Array.from(byId("office-reusable-story")?.selectedOptions || []).map((option) => ({
          story_cluster_id: option.value
        })),
        owl_insight_items: editingReusableInsight?.owl_insight_items || []
      };
      closeDialog(byId("office-reusable-insight-dialog"));
      openCoverageGroupEditor(null, {
        itemIds,
        onSaved: (groupId) => {
          openReusableInsightEditor(draftInsight, { coverageGroupId: groupId });
        },
        onCancel: () => openReusableInsightEditor(draftInsight)
      });
    });
    byId("office-clear-selected-articles")?.addEventListener("click", () => {
      selectedArticleIds.clear();
      renderNewsItems();
    });
    byId("office-add-right")?.addEventListener("click", () => openRightsEditor());
    byId("office-rights-form")?.addEventListener("submit", saveReaderRight);
    byId("office-right-source")?.addEventListener("change", (event) => {
      const source = newsSources.find((entry) => entry.id === event.target.value);
      if (!source?.website_url) return;
      try {
        byId("office-right-host").value = new URL(source.website_url).hostname.replace(/^www\./, "");
      } catch {
        // Leave the host available for manual entry.
      }
    });
    byId("office-add-source")?.addEventListener("click", () => openSourceEditor());
    byId("office-source-form")?.addEventListener("submit", submitNewsSource);
    byId("office-news-filter-form")?.addEventListener("submit", filterNewsItems);
    byId("office-news-load-more")?.addEventListener("click", loadMoreNewsItems);
    byId("office-insight-status")?.addEventListener("change", syncInsightPublicControl);
    byId("office-insight-form")?.addEventListener("submit", saveNewsInsight);
    byId("office-hide-insight")?.addEventListener("click", hideNewsInsight);

    byId("office-choose-profile")?.addEventListener("click", () => byId("office-profile-file")?.click());
    byId("office-profile-file")?.addEventListener("change", (event) => {
      selectProfileImage(event.target.files?.[0]);
    });
    byId("office-save-profile")?.addEventListener("click", saveProfileImage);
    byId("office-add-user")?.addEventListener("click", () => openDialog(byId("office-add-user-dialog")));
    byId("office-add-user-form")?.addEventListener("submit", addAllowedUser);
    byId("office-post-form")?.addEventListener("submit", publishOwlPost);
    byId("office-post-image")?.addEventListener("change", (event) => {
      const preview = byId("office-post-preview");
      const file = event.target.files?.[0];
      if (!file) {
        preview.hidden = true;
        return;
      }
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });
    byId("office-sign-out")?.addEventListener("click", () => openDialog(byId("office-sign-out-dialog")));
    byId("office-confirm-sign-out")?.addEventListener("click", signOut);
  }

  async function initializeOffice() {
    bindOfficeControls();
    if (!(await verifyOfficeAccess())) return;
    await Promise.allSettled([loadProfileImage(), loadInbox(), loadNewsDashboardBadge()]);
  }

  initializeOffice();
})();
