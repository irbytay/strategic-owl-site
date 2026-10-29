(function () {
  "use strict";

  const state = {
    initialized: false,
    client: null,
    session: null,
    profile: null,
    preview: true,
    challenge: null,
    result: null,
    selected: null,
    displayChoices: [],
    arranged: [],
    assignments: {},
    activeItem: null,
    touched: false,
    mission: 1
  };

  const states = [
    ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
    ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
    ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
    ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
    ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
    ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
    ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
    ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
    ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
    ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
    ["DC","District of Columbia"]
  ];

  const interactionLabels = {
    multipleChoice: "Choose the best answer",
    claimCheck: "Is this statement accurate?",
    caseDecision: "Choose the strongest decision",
    wordTiles: "Build the phrase",
    ordering: "Put these in order",
    matching: "Match each idea",
    powerAssignment: "Assign each power"
  };

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }
  function shuffled(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    if (result.length > 1 && result.every((value, index) => value === values[index])) {
      [result[0], result[1]] = [result[1], result[0]];
    }
    return result;
  }
  function rpcValue(data) { return Array.isArray(data) ? data[0] : data; }
  function levelLabel(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return `Level ${numeric}`;
    const label = String(value || "Foundation").trim();
    return label || "Foundation";
  }

  async function ensureSession() {
    const client = window.StrategicOwlAccess.getSupabaseClient();
    let { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const anonymous = await client.auth.signInAnonymously();
      if (anonymous.error) throw anonymous.error;
      data = anonymous.data;
    }
    if (!data.session) throw new Error("A secure Civic Owl session could not be created.");
    state.client = client;
    state.session = data.session;
    return data.session;
  }

  async function loadProfile() {
    const session = await ensureSession();
    if (session.user?.is_anonymous) {
      state.profile = null;
      state.preview = true;
      return null;
    }
    const fields = "user_id,public_id,display_name,bio,state_code,avatar_path,leaderboard_alias,current_rating,highest_rating,total_questions_answered,total_correct_answers,profile_is_public";
    const { data, error } = await state.client.from("civic_owl_profiles").select(fields).limit(1).maybeSingle();
    if (error) throw error;
    state.profile = data || null;
    state.preview = !state.profile;
    return state.profile;
  }

  function renderIdentity() {
    const name = byId("civic-identity-name");
    const detail = byId("civic-identity-detail");
    const action = byId("civic-identity-action");
    if (!name || !detail || !action) return;
    if (state.profile) {
      name.textContent = state.profile.display_name || "Civic Identity";
      const handle = state.profile.leaderboard_alias ? `@${state.profile.leaderboard_alias} · ` : "";
      detail.textContent = `${handle}${Number(state.profile.current_rating || 0)} civic points`;
      action.textContent = "Manage identity";
      action.hidden = false;
    } else {
      name.textContent = state.session?.user?.is_anonymous ? "Begin with 10 questions" : "Finish your Civic Identity";
      detail.textContent = state.session?.user?.is_anonymous
        ? "Your preview does not change a rating."
        : "Create a private identity to save scored progress.";
      action.textContent = state.session?.user?.is_anonymous ? "Create identity" : "Finish setup";
      action.hidden = false;
    }
  }

  function updateProgress(question = state.challenge, result = state.result) {
    const rating = Number(result?.rating_after ?? question?.current_rating ?? state.profile?.current_rating ?? 0);
    const streak = Number(result?.current_streak ?? question?.current_streak ?? 0);
    const answered = Number(result?.preview_answered ?? question?.preview_answered ?? 0);
    const limit = Number(result?.preview_limit ?? question?.preview_limit ?? 10);
    const mastered = Number(result?.mastered_units ?? question?.mastered_units ?? 0);
    const required = Math.max(1, Number(result?.required_units ?? question?.required_units ?? 285));
    byId("civic-rating").textContent = String(rating);
    byId("civic-streak").textContent = String(streak);
    byId("civic-mission-value").textContent = String(Math.max(1, state.mission));
    const percent = state.preview ? Math.min(100, answered / Math.max(1, limit) * 100) : Math.min(100, mastered / required * 100);
    byId("civic-progress-fill").style.width = `${percent}%`;
    byId("civic-progress-copy").textContent = state.preview
      ? `Free preview ${Math.min(answered, limit)} of ${limit}`
      : `${mastered} of ${required} curriculum units mastered`;
  }

  function resetInteraction(challenge) {
    state.result = null;
    state.selected = null;
    state.assignments = {};
    state.touched = false;
    const choices = (challenge.choices || []).map((label, index) => ({ label, index }));
    state.displayChoices = shuffled(choices);
    const items = challenge.interaction_payload?.items || [];
    state.arranged = ["ordering", "matching", "powerAssignment"].includes(challenge.interaction_type)
      ? shuffled(items)
      : [];
    state.activeItem = state.arranged[0] || null;
  }

  async function loadChallenge() {
    const host = byId("civic-challenge");
    if (!host) return;
    host.setAttribute("aria-busy", "true");
    host.innerHTML = '<div class="civic-loading"><span></span><p>Preparing Civic Owl</p></div>';
    try {
      await ensureSession();
      const args = state.preview ? undefined : {
        p_client_attempt_id: crypto.randomUUID().toLowerCase(),
        p_knowledge_area: null,
        p_level: null,
        p_placement_only: false
      };
      const name = state.preview ? "civic_owl_start_free_preview" : "civic_owl_start_curriculum_challenge";
      const response = args ? await state.client.rpc(name, args) : await state.client.rpc(name);
      if (response.error) throw response.error;
      const challenge = rpcValue(response.data);
      if (!challenge?.session_id) {
        renderPreviewComplete(challenge);
        return;
      }
      state.challenge = challenge;
      state.mission += state.mission === 1 && Number(challenge.preview_answered || 0) ? Number(challenge.preview_answered || 0) : 0;
      resetInteraction(challenge);
      updateProgress(challenge);
      renderChallenge();
    } catch (error) {
      console.error("Civic Owl could not start", error);
      host.innerHTML = `<div class="civic-result-card" data-correct="false"><h2 class="civic-result-heading"><i>!</i>Civic Owl needs a moment</h2><p>${escapeHtml(error?.message || "The next question could not be loaded.")}</p><button class="civic-next-button" type="button" data-civic-retry>Try again</button></div>`;
      host.querySelector("[data-civic-retry]")?.addEventListener("click", loadChallenge);
    } finally {
      host.setAttribute("aria-busy", "false");
    }
  }

  function renderPreviewComplete() {
    const host = byId("civic-challenge");
    host.innerHTML = `
      <div class="civic-result-card" data-correct="true">
        <h2 class="civic-result-heading"><i>✓</i>Your preview is complete</h2>
        <p>Create a free, private Civic Identity to continue through the complete scored Challenge and keep your progress across devices.</p>
        <button class="civic-primary-button" type="button" data-create-identity>Create Civic Identity</button>
      </div>`;
    host.querySelector("[data-create-identity]")?.addEventListener("click", openIdentityDialog);
    updateProgress({ preview_answered: 10, preview_limit: 10 });
  }

  function renderChoiceInteraction(challenge) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return `<div class="civic-answer-grid">${state.displayChoices.map(({ label, index }, displayIndex) => `
      <button class="civic-answer" type="button" data-choice-index="${index}" aria-pressed="${state.selected === index}">
        <b>${letters[displayIndex]}</b><span>${escapeHtml(label)}</span>
      </button>`).join("")}</div>`;
  }

  function renderWordTiles(challenge) {
    const items = challenge.interaction_payload?.items || [];
    return `
      <div class="civic-arranged-list">${state.arranged.map((item, index) => `<button class="civic-tile" type="button" data-remove-tile="${index}">${escapeHtml(item)}</button>`).join("") || '<p class="civic-dialog-intro">Tap the words below to build your answer.</p>'}</div>
      <div class="civic-tile-bank">${shuffled(items).map((item) => {
        const used = state.arranged.filter((value) => value === item).length >= items.filter((value) => value === item).length;
        return `<button class="civic-tile" type="button" data-add-tile="${escapeHtml(item)}" ${used ? "disabled" : ""}>${escapeHtml(item)}</button>`;
      }).join("")}</div>`;
  }

  function renderOrdering() {
    return `<div class="civic-arranged-list">${state.arranged.map((item, index) => `
      <div class="civic-order-row"><span>${index + 1}</span><strong>${escapeHtml(item)}</strong><div class="civic-order-controls">
        <button type="button" aria-label="Move up" data-move="${index},-1" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" aria-label="Move down" data-move="${index},1" ${index === state.arranged.length - 1 ? "disabled" : ""}>↓</button>
      </div></div>`).join("")}</div>`;
  }

  function renderMatching(challenge) {
    const categories = challenge.interaction_payload?.categories || [];
    return `
      <div class="civic-tile-bank">${state.arranged.map((item) => `<button class="civic-tile" type="button" data-active-item="${escapeHtml(item)}" ${state.assignments[item] ? "disabled" : ""}>${escapeHtml(item)}</button>`).join("")}</div>
      <p class="civic-dialog-intro">${state.activeItem ? `Where does “${escapeHtml(state.activeItem)}” belong?` : "Every item is placed."}</p>
      <div class="civic-category-list">${categories.map((category) => {
        const assigned = Object.entries(state.assignments).filter(([, value]) => value === category).map(([item]) => item).join(", ");
        return `<button class="civic-category" type="button" data-category="${escapeHtml(category)}" ${state.activeItem ? "" : "disabled"}><strong>${escapeHtml(category)}</strong><small>${escapeHtml(assigned)}</small></button>`;
      }).join("")}</div>`;
  }

  function responseReady(challenge) {
    if (["multipleChoice", "claimCheck", "caseDecision"].includes(challenge.interaction_type)) return state.selected !== null;
    if (challenge.interaction_type === "wordTiles") return state.arranged.length === (challenge.interaction_payload?.items || []).length;
    if (challenge.interaction_type === "ordering") return state.touched && state.arranged.length === (challenge.interaction_payload?.items || []).length;
    return Object.keys(state.assignments).length === (challenge.interaction_payload?.items || []).length;
  }

  function renderChallenge() {
    const host = byId("civic-challenge");
    const challenge = state.challenge;
    if (!host || !challenge) return;
    const type = challenge.interaction_type || "multipleChoice";
    let interaction = renderChoiceInteraction(challenge);
    if (type === "wordTiles") interaction = renderWordTiles(challenge);
    if (type === "ordering") interaction = renderOrdering();
    if (["matching", "powerAssignment"].includes(type)) interaction = renderMatching(challenge);
    host.innerHTML = `
      <section class="civic-question-card">
        <div class="civic-question-meta"><span>◆ ${escapeHtml(challenge.knowledge_area || "Civics")}</span><span>${escapeHtml(levelLabel(challenge.level))}</span></div>
        <h2>${escapeHtml(challenge.question)}</h2>
        ${challenge.scenario ? `<p class="civic-scenario">${escapeHtml(challenge.scenario)}</p>` : ""}
        ${researchAction(challenge)}
      </section>
      <section class="civic-interaction-card">
        <p class="civic-instruction">${escapeHtml(interactionLabels[type] || "Choose your answer")}</p>
        ${interaction}
      </section>
      <button class="civic-lock-button" type="button" data-submit-answer ${responseReady(challenge) ? "" : "disabled"}>Lock in answer</button>`;
    wireInteractionEvents();
  }

  function researchAction(challenge) {
    if (state.preview || !challenge.library_entry_id) return "";
    const hasAccess = window.StrategicOwlAccess?.can?.("researchPrompt") === true;
    return `
      <button class="civic-research-button" type="button" data-research-topic data-member-access="${hasAccess}">
        <span aria-hidden="true">▤</span>
        <strong>Research the topic</strong>
      </button>`;
  }

  async function openResearchTopic() {
    const challenge = state.challenge;
    if (!challenge?.library_entry_id) return;
    if (window.StrategicOwlAccess?.can?.("researchPrompt") !== true) {
      window.StrategicOwlAccess?.open?.();
      return;
    }
    const button = byId("civic-challenge")?.querySelector("[data-research-topic]");
    if (button) button.disabled = true;
    try {
      if (!state.preview && !challenge.used_study) {
        const marked = await state.client.rpc("civic_owl_mark_challenge_studied", {
          p_session_id: challenge.session_id
        });
        if (marked.error) throw marked.error;
        challenge.used_study = true;
      }
      const destination = new URL("constitution.html", window.location.href);
      destination.searchParams.set("entry", challenge.library_entry_id);
      destination.searchParams.set("return", "civic-owl");
      window.location.href = destination.href;
    } catch (error) {
      console.error("The research passage could not be opened", error);
      if (button) {
        button.disabled = false;
        button.querySelector("strong").textContent = "Try research again";
      }
    }
  }

  function wireInteractionEvents() {
    const host = byId("civic-challenge");
    host.querySelectorAll("[data-choice-index]").forEach((button) => button.addEventListener("click", () => {
      state.selected = Number(button.dataset.choiceIndex);
      renderChallenge();
      window.setTimeout(() => byId("civic-challenge")?.querySelector("[data-submit-answer]")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }));
    host.querySelectorAll("[data-add-tile]").forEach((button) => button.addEventListener("click", () => {
      state.arranged.push(button.dataset.addTile); state.touched = true; renderChallenge();
    }));
    host.querySelectorAll("[data-remove-tile]").forEach((button) => button.addEventListener("click", () => {
      state.arranged.splice(Number(button.dataset.removeTile), 1); state.touched = true; renderChallenge();
    }));
    host.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
      const [from, delta] = button.dataset.move.split(",").map(Number); const to = from + delta;
      if (from >= 0 && to >= 0 && to < state.arranged.length) [state.arranged[from], state.arranged[to]] = [state.arranged[to], state.arranged[from]];
      state.touched = true; renderChallenge();
    }));
    host.querySelectorAll("[data-active-item]").forEach((button) => button.addEventListener("click", () => {
      state.activeItem = button.dataset.activeItem; renderChallenge();
    }));
    host.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
      if (!state.activeItem) return;
      state.assignments[state.activeItem] = button.dataset.category;
      state.activeItem = state.arranged.find((item) => !state.assignments[item]) || null;
      state.touched = true; renderChallenge();
    }));
    host.querySelector("[data-submit-answer]")?.addEventListener("click", submitAnswer);
    host.querySelector("[data-research-topic]")?.addEventListener("click", openResearchTopic);
  }

  async function submitAnswer() {
    const button = byId("civic-challenge")?.querySelector("[data-submit-answer]");
    if (!button || !state.challenge || !responseReady(state.challenge)) return;
    button.disabled = true;
    button.textContent = "Checking your answer";
    let response = state.selected;
    if (["wordTiles", "ordering"].includes(state.challenge.interaction_type)) response = state.arranged;
    if (["matching", "powerAssignment"].includes(state.challenge.interaction_type)) response = state.assignments;
    const rpc = state.preview ? "civic_owl_submit_free_preview" : "civic_owl_submit_rated_response";
    const submission = await state.client.rpc(rpc, { p_session_id: state.challenge.session_id, p_response: response });
    if (submission.error) {
      button.disabled = false;
      button.textContent = "Try that answer again";
      return;
    }
    state.result = rpcValue(submission.data) || {};
    renderResult();
    updateProgress(state.challenge, state.result);
    window.setTimeout(() => byId("civic-result")?.scrollIntoView({ behavior: "smooth", block: "center" }), 40);
  }

  function renderResult() {
    const result = state.result || {};
    const correct = result.is_correct === true;
    const host = byId("civic-challenge");
    host.insertAdjacentHTML("beforeend", `
      <section class="civic-result-card" id="civic-result" data-correct="${correct}">
        <h2 class="civic-result-heading"><i>${correct ? "✓" : "×"}</i>${correct ? "Sound judgment" : "Review the principle"}</h2>
        <p>${escapeHtml(result.explanation || (correct ? "That answer is supported by the source." : "Review the source before trying another challenge."))}</p>
        <div class="civic-result-stats">
          ${state.preview ? "<span>Preview answer</span>" : `<span>${Number(result.rating_change || 0) >= 0 ? "+" : ""}${Number(result.rating_change || 0)} civic points</span>`}
          ${result.source ? `<span>Source: ${escapeHtml(result.source)}</span>` : ""}
        </div>
      </section>
      <button class="civic-next-button" type="button" data-next-challenge>${result.preview_complete ? "Create Civic Identity" : "Next challenge"}</button>`);
    host.querySelector("[data-submit-answer]")?.remove();
    host.querySelector("[data-next-challenge]")?.addEventListener("click", () => {
      if (result.preview_complete) openIdentityDialog();
      else { state.mission += 1; loadChallenge(); }
    });
  }

  function dialogStep(name) {
    document.querySelectorAll("[data-identity-step]").forEach((element) => { element.hidden = element.dataset.identityStep !== name; });
    byId("civic-dialog-message").textContent = "";
  }

  function openIdentityDialog() {
    const dialog = byId("civic-identity-dialog");
    if (!dialog) return;
    const verified = state.session?.user?.is_anonymous === false;
    dialogStep(verified ? "profile" : "email");
    const title = byId("civic-dialog-title");
    const save = dialog.querySelector("[data-save-civic-identity]");
    const remove = dialog.querySelector("[data-delete-civic-account]");
    const note = dialog.querySelector("[data-civic-deletion-note]");
    if (state.profile) {
      title.textContent = "Manage your Civic Identity";
      dialog.querySelector("#civic-display-name").value = state.profile.display_name || "";
      dialog.querySelector("#civic-handle").value = state.profile.leaderboard_alias || "";
      dialog.querySelector("#civic-state").value = state.profile.state_code || "";
      dialog.querySelector("#civic-bio").value = state.profile.bio || "";
      dialog.querySelector("#civic-public").checked = state.profile.profile_is_public === true;
      save.textContent = "Save Civic Identity";
      remove.hidden = false;
      note.hidden = false;
    } else {
      title.textContent = "Save your progress privately";
      save.textContent = "Create Civic Identity";
      remove.hidden = true;
      note.hidden = true;
    }
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("owl-dialog-open");
  }

  function closeIdentityDialog() {
    const dialog = byId("civic-identity-dialog");
    if (dialog?.open) dialog.close();
    document.body.classList.remove("owl-dialog-open");
  }

  async function saveProfile(form) {
    const displayName = form.elements.displayName.value.trim();
    const handle = form.elements.handle.value.trim().replace(/^@/, "");
    if (displayName.length < 2) throw new Error("Enter the name you want shown on your Civic Identity.");
    if (!/^[A-Za-z0-9_]{3,24}$/.test(handle)) throw new Error("Use 3 to 24 letters, numbers, or underscores for your handle.");
    const existingHandle = String(state.profile?.leaderboard_alias || "").trim().toLowerCase();
    if (handle.toLowerCase() !== existingHandle) {
      const available = await state.client.rpc("civic_owl_handle_available", { p_handle: handle });
      if (available.error) throw available.error;
      if (available.data !== true) throw new Error("That handle is already in use. Choose another.");
    }
    const initialized = await state.client.rpc("civic_owl_initialize_profile", {
      p_display_name: displayName,
      p_state_code: form.elements.state.value || null
    });
    if (initialized.error) throw initialized.error;
    const updated = await state.client.rpc("civic_owl_update_profile", {
      p_display_name: displayName,
      p_bio: form.elements.bio.value.trim() || null,
      p_state_code: form.elements.state.value || null,
      p_leaderboard_alias: handle,
      p_profile_is_public: form.elements.isPublic.checked,
      p_avatar_path: null
    });
    if (updated.error) throw updated.error;
    await loadProfile();
    renderIdentity();
    closeIdentityDialog();
    state.mission = 1;
    await loadChallenge();
  }

  function setupDialog() {
    const dialog = byId("civic-identity-dialog");
    const form = byId("civic-identity-form");
    if (!dialog || !form || dialog.dataset.ready === "true") return;
    dialog.dataset.ready = "true";
    const stateSelect = byId("civic-state");
    states.forEach(([code, name]) => stateSelect.add(new Option(name, code)));
    dialog.querySelector(".civic-dialog-close")?.addEventListener("click", closeIdentityDialog);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeIdentityDialog(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeIdentityDialog(); });
    dialog.querySelector("[data-civic-restart]")?.addEventListener("click", () => dialogStep("email"));
    dialog.querySelector("[data-delete-civic-account]")?.addEventListener("click", async () => {
      if (!await window.StrategicOwlAccess.confirmAccountDeletion()) return;
      const message = byId("civic-dialog-message");
      const button = dialog.querySelector("[data-delete-civic-account]");
      button.disabled = true;
      button.textContent = "Deleting account";
      try {
        await window.StrategicOwlAccess.deleteAccountData();
        closeIdentityDialog();
        state.profile = null;
        state.session = null;
        window.location.replace("civic-owl.html?account=deleted");
      } catch (error) {
        message.textContent = error?.message || "Your account could not be deleted.";
        button.disabled = false;
        button.textContent = "Delete account and app data";
      }
    });
    byId("civic-code")?.addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = byId("civic-dialog-message");
      const step = [...form.querySelectorAll("[data-identity-step]")].find((element) => !element.hidden)?.dataset.identityStep;
      const submit = form.querySelector(`[data-identity-step="${step}"] button[type="submit"]`);
      if (submit) submit.disabled = true;
      try {
        if (step === "email") {
          const email = form.elements.email.value.trim().toLowerCase();
          message.textContent = "Sending your verification code.";
          const needed = await window.StrategicOwlAccess.beginEmailVerification(email, "civic_identity");
          if (needed) dialogStep("code");
          else { await loadProfile(); dialogStep(state.profile ? "profile" : "profile"); }
        } else if (step === "code") {
          message.textContent = "Confirming your email.";
          await window.StrategicOwlAccess.completeEmailVerification(form.elements.email.value.trim().toLowerCase(), form.elements.code.value);
          await loadProfile();
          if (state.profile) { renderIdentity(); closeIdentityDialog(); await loadChallenge(); }
          else dialogStep("profile");
        } else {
          message.textContent = "Creating your private Civic Identity.";
          await saveProfile(form);
        }
      } catch (error) {
        console.error("Civic Identity could not be saved", error);
        message.textContent = error?.message || "Civic Identity could not be saved.";
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  async function initialize() {
    if (document.body.dataset.page !== "civic-owl" || !byId("civic-challenge")) return;
    setupDialog();
    byId("civic-identity-action")?.addEventListener("click", openIdentityDialog);
    const accountNotice = byId("civic-account-notice");
    if (accountNotice && new URLSearchParams(window.location.search).get("account") === "deleted") {
      accountNotice.hidden = false;
      window.history.replaceState({}, "", "civic-owl.html");
    }
    try {
      await loadProfile();
      renderIdentity();
      await loadChallenge();
    } catch (error) {
      console.error("Civic Owl could not initialize", error);
      renderIdentity();
      const host = byId("civic-challenge");
      host.innerHTML = `<div class="civic-result-card" data-correct="false"><h2 class="civic-result-heading"><i>!</i>Civic Owl could not connect</h2><p>${escapeHtml(error?.message || "Try again shortly.")}</p></div>`;
    }
  }

  initialize();
  window.addEventListener("strategic-owl-view-change", initialize);
})();
