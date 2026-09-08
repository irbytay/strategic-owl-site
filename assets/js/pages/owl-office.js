(function () {
  "use strict";

  const ADMINISTRATOR_USER_ID = "5f96faeb-ec9e-4069-9b91-cbc65e422f73";
  const PROFILE_TABLE = "owl_profile";
  const IMAGE_BUCKET = "app-images";
  const REQUEST_TABLE = "owl_topic_requests";

  let administrator = null;
  let currentProfilePath = "";
  let selectedProfileFile = null;
  let selectedProfilePreviewUrl = "";
  let inboxRequests = [];
  let inboxView = "active";
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
    byId("office-refresh-inbox")?.addEventListener("click", loadInbox);
    document.querySelectorAll("[data-inbox-view]").forEach((button) => {
      button.addEventListener("click", () => {
        inboxView = button.dataset.inboxView;
        renderInbox();
      });
    });

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
    await Promise.allSettled([loadProfileImage(), loadInbox()]);
  }

  initializeOffice();
})();
