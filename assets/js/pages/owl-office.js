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
  let newsAdminView = "requests";
  let newsSources = [];
  let newsSourceRequests = [];
  let newsItems = [];
  let selectedNewsItem = null;
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

    list.replaceChildren();
    if (!newsSources.length) {
      appendText(list, "p", "No connected news sources.", "office-empty");
      return;
    }

    for (const source of newsSources) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      card.dataset.sourceId = source.id;
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", source.source_name || "News source");
      header.appendChild(newsStatusBadge(source.status));
      card.appendChild(header);

      const details = [source.alignment_label, source.source_category, source.content_type]
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
      actions.appendChild(newsButton("Edit Source", "office-button--secondary", "source-edit", source.id));
      if (source.status === "testing" || source.status === "active") {
        actions.appendChild(newsButton("Refresh Feed", "office-button--secondary", "source-ingest", source.id));
      }
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderNewsItems() {
    const list = byId("office-news-item-list");
    if (!list) return;
    byId("office-news-item-count").textContent = String(newsItems.length);
    list.replaceChildren();

    if (!newsItems.length) {
      appendText(list, "p", "No articles match this view.", "office-empty");
      return;
    }

    for (const item of newsItems) {
      const card = document.createElement("article");
      card.className = "office-news-card";
      const header = document.createElement("div");
      header.className = "office-news-card-header";
      appendText(header, "h3", item.headline || "Untitled article");
      header.appendChild(newsStatusBadge(item.insight?.review_status || "unanalyzed"));
      card.appendChild(header);
      const sourceName = item.source?.source_name || "News source";
      appendText(card, "p", [sourceName, formatDate(item.published_at)].filter(Boolean).join(" · "));
      if (item.summary_text) appendText(card, "p", item.summary_text);
      appendNewsLink(card, "Read Original", item.canonical_url);
      const actions = document.createElement("div");
      actions.className = "office-news-card-actions";
      actions.appendChild(newsButton(item.insight ? "Edit Insight" : "Add Insight", "office-button--primary", "article-insight", item.id));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function updateNewsAdminView() {
    document.querySelectorAll("[data-news-admin-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.newsAdminView === newsAdminView));
    });
    document.querySelectorAll("[data-news-admin-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.newsAdminPanel !== newsAdminView;
    });
  }

  function updateNewsDashboard(dashboard) {
    const pending = Number(dashboard?.requests?.pending || 0);
    const sourceCount = Object.values(dashboard?.sources || {}).reduce((total, value) => total + Number(value || 0), 0);
    const itemCount = Number(dashboard?.items?.active || newsItems.length);
    const badge = byId("office-news-count");
    badge.textContent = pending > 99 ? "99+" : String(pending);
    badge.hidden = pending === 0;
    byId("office-news-request-count").textContent = String(pending);
    byId("office-news-source-count").textContent = String(sourceCount || newsSources.length);
    byId("office-news-item-count").textContent = String(itemCount);
  }

  async function loadNewsAdministration() {
    if (newsAdminLoading) return;
    newsAdminLoading = true;
    const refresh = byId("office-refresh-news");
    setBusy(refresh, true, "Refreshing…", "Refresh");
    setNewsMessage("Loading news administration…");
    try {
      const [dashboardResult, sourceResult, requestResult, itemResult] = await Promise.all([
        invokeNewsAdmin("getAdminDashboard"),
        invokeNewsAdmin("listNewsSources"),
        invokeNewsAdmin("listSourceRequests", { status: "all", limit: 200 }),
        invokeNewsAdmin("listNewsItems", { status: "active", limit: 50 })
      ]);
      newsSources = Array.isArray(sourceResult.sources) ? sourceResult.sources : [];
      newsSourceRequests = Array.isArray(requestResult.requests) ? requestResult.requests : [];
      newsItems = Array.isArray(itemResult.items) ? itemResult.items : [];
      updateNewsDashboard(dashboardResult.dashboard || {});
      renderNewsSources();
      renderNewsRequests();
      renderNewsItems();
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
    try {
      const result = await invokeNewsAdmin("listNewsItems", {
        status: "active",
        limit: 50,
        sourceId: byId("office-news-source-filter").value,
        search: byId("office-news-search").value.trim()
      });
      newsItems = Array.isArray(result.items) ? result.items : [];
      renderNewsItems();
    } catch (error) {
      console.error("News article search failed", error);
      setNewsMessage(error?.message || "The articles could not be loaded.");
    } finally {
      setBusy(button, false, "Searching…", "Search");
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
      byId("office-insight-labels").value = Array.isArray(insight.labels) ? insight.labels.join(", ") : "";
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
    const labels = byId("office-insight-labels").value
      .split(",").map((label) => label.trim()).filter(Boolean);
    setBusy(button, true, "Saving…", "Save Insight");
    message.textContent = "";
    try {
      await invokeNewsAdmin("saveNewsInsight", {
        itemId: byId("office-insight-item-id").value,
        owlLabel: byId("office-insight-label").value.trim(),
        labels,
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
        newsAdminView = button.dataset.newsAdminView;
        updateNewsAdminView();
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
      const button = event.target.closest("[data-news-action='article-insight']");
      if (button) openNewsInsight(button.dataset.newsId);
    });
    byId("office-add-source")?.addEventListener("click", () => openSourceEditor());
    byId("office-source-form")?.addEventListener("submit", submitNewsSource);
    byId("office-news-filter-form")?.addEventListener("submit", filterNewsItems);
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
