(function () {
  "use strict";

  const entry = document.getElementById("ask-owl-entry");
  if (!entry) return;

  let dialog = null;
  let requests = [];
  let loadingRequests = false;

  function accessSession() {
    return window.StrategicOwlAccess?.getSession?.() || null;
  }

  function canAskOwl() {
    const session = accessSession();
    return Boolean(session && session.source !== "administrator");
  }

  function setEntryVisibility() {
    entry.hidden = !canAskOwl();
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function statusDetails(status) {
    switch (status) {
      case "read":
        return ["Under Review", "I have reviewed this request."];
      case "researching":
        return ["Researching", "I am looking into this topic."];
      case "completed":
        return ["Complete", "My review of this request is complete."];
      case "archived":
        return ["Closed", "This request is no longer active."];
      default:
        return ["Received", "Your request is in the Owl Inbox."];
    }
  }

  function formatDate(value) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function setMessage(message, isError) {
    const element = dialog?.querySelector("[data-ask-message]");
    if (!element) return;
    element.textContent = message || "";
    element.dataset.error = isError ? "true" : "false";
  }

  function renderRequests() {
    const list = dialog?.querySelector("[data-ask-history]");
    if (!list) return;
    list.replaceChildren();

    if (!requests.length) {
      list.appendChild(createElement(
        "p",
        "ask-owl-empty",
        "You have not submitted any requests yet."
      ));
      return;
    }

    requests.forEach((request) => {
      const card = createElement("article", "ask-owl-request");
      const top = createElement("div", "ask-owl-request-top");
      top.appendChild(createElement("h3", "", request.topic || "Untitled request"));

      const status = String(request.status || "new");
      const [label, description] = statusDetails(status);
      const badge = createElement("span", "ask-owl-status", label);
      badge.dataset.status = status;
      top.appendChild(badge);
      card.appendChild(top);
      card.appendChild(createElement("p", "ask-owl-status-copy", description));

      const date = formatDate(request.created_at);
      if (date) card.appendChild(createElement("p", "ask-owl-date", `Submitted ${date}`));
      list.appendChild(card);
    });
  }

  async function loadRequests() {
    if (loadingRequests || !canAskOwl()) return;
    loadingRequests = true;
    const list = dialog?.querySelector("[data-ask-history]");
    if (list) list.textContent = "Loading your requests…";
    try {
      const result = await window.StrategicOwlAccess.invokeAudienceAction(
        "listOwlRequests"
      );
      requests = Array.isArray(result.requests) ? result.requests : [];
      renderRequests();
    } catch (error) {
      console.warn("Ask the Owl history failed", error);
      if (list) list.textContent = "Your requests could not be loaded.";
      setMessage(error?.message || "Please try again.", true);
    } finally {
      loadingRequests = false;
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const topic = form.elements.topic.value.trim();
    const audienceTake = form.elements.audienceTake.value.trim();

    if (topic.length < 3) {
      setMessage("Please enter a topic.", true);
      return;
    }
    if (topic.length > 150) {
      setMessage("Keep the topic under 150 characters.", true);
      return;
    }
    if (audienceTake.length > 500) {
      setMessage("Keep the additional context under 500 characters.", true);
      return;
    }

    button.disabled = true;
    button.textContent = "Sending…";
    setMessage("", false);
    try {
      const result = await window.StrategicOwlAccess.invokeAudienceAction(
        "submitOwlRequest",
        { topic, audienceTake }
      );
      if (result.submitted !== true) {
        throw new Error(result.error || "Your request could not be saved.");
      }
      form.reset();
      setMessage(
        "Your request was received. You can follow its status below.",
        false
      );
      await loadRequests();
    } catch (error) {
      console.warn("Ask the Owl submission failed", error);
      setMessage(error?.message || "Your request could not be sent.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Send for Review";
    }
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "ask-owl-dialog";
    dialog.setAttribute("aria-labelledby", "ask-owl-dialog-title");
    dialog.innerHTML = `
      <section class="ask-owl-panel">
        <button class="ask-owl-close" type="button" aria-label="Close">×</button>
        <header class="ask-owl-heading">
          <img src="assets/images/3X.png" alt="" />
          <div>
            <p>Owl Access</p>
            <h2 id="ask-owl-dialog-title">Ask the Owl</h2>
          </div>
        </header>
        <p class="ask-owl-intro">Don’t see a topic on The Perch or in the Misconceptions Hub? Ask me to look into it. Thoughtful review takes time, and not every request will be a fit.</p>
        <form class="ask-owl-form">
          <h3>New Request</h3>
          <label for="ask-owl-topic">What would you like me to examine?</label>
          <textarea id="ask-owl-topic" name="topic" rows="3" minlength="3" maxlength="150" required></textarea>
          <label for="ask-owl-context">What are you hearing or trying to respond to? <span>(Optional)</span></label>
          <textarea id="ask-owl-context" name="audienceTake" rows="4" maxlength="500"></textarea>
          <p class="ask-owl-message" data-ask-message role="status" aria-live="polite"></p>
          <button class="ask-owl-submit" type="submit">Send for Review</button>
        </form>
        <section class="ask-owl-history-section" aria-labelledby="ask-owl-history-title">
          <div class="ask-owl-history-heading">
            <h3 id="ask-owl-history-title">My Requests</h3>
            <button type="button" data-ask-refresh>Refresh</button>
          </div>
          <div class="ask-owl-history" data-ask-history></div>
        </section>
      </section>`;
    document.body.appendChild(dialog);

    dialog.querySelector(".ask-owl-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector(".ask-owl-form")?.addEventListener("submit", submitRequest);
    dialog.querySelector("[data-ask-refresh]")?.addEventListener("click", loadRequests);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => document.body.classList.remove("ask-owl-open"));
    return dialog;
  }

  async function openAskOwl() {
    if (!canAskOwl()) {
      window.StrategicOwlAccess?.open?.();
      return;
    }
    ensureDialog().showModal();
    document.body.classList.add("ask-owl-open");
    setMessage("", false);
    await loadRequests();
  }

  entry.innerHTML = `
    <button class="ask-owl-entry-button" type="button">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4Z"></path><path d="m4 13 4 1 2 3h4l2-3 4-1"></path></svg>
      <span>Ask the Owl</span>
    </button>`;
  entry.querySelector("button")?.addEventListener("click", openAskOwl);

  setEntryVisibility();
  window.addEventListener("strategic-owl-access-change", setEntryVisibility);
})();
