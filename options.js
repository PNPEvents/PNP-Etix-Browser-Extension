(function initialiseOptions() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;

  const SETTINGS_KEY = "etix.settings";
  const form = document.querySelector("#settingsForm");
  const operatorName = document.querySelector("#operatorName");
  const accountLabel = document.querySelector("#accountLabel");
  const ticketAliases = document.querySelector("#ticketAliases");
  const workflowProfile = document.querySelector("#workflowProfile");
  const liveExecutionEnabled = document.querySelector("#liveExecutionEnabled");
  const skipCarerPreview = document.querySelector("#skipCarerPreview");
  const emailExecutionEnabled = document.querySelector("#emailExecutionEnabled");
  const parkingExecutionEnabled = document.querySelector("#parkingExecutionEnabled");
  const emailWorkflowEnabled = document.querySelector("#emailWorkflowEnabled");
  const carerWorkflowEnabled = document.querySelector("#carerWorkflowEnabled");
  const parkingWorkflowEnabled = document.querySelector("#parkingWorkflowEnabled");
  const showPageInspector = document.querySelector("#showPageInspector");
  const showFeedback = document.querySelector("#showFeedback");
  const enhancementOptions = document.querySelector("#enhancementOptions");
  const enhancementsEmpty = document.querySelector("#enhancementsEmpty");
  const colourBlindOptions = document.querySelector("#colourBlindOptions");
  const colourBlindMode = document.querySelector("#colourBlindMode");
  const enhancementInputs = new Map();
  let enhancementSettings = {};
  const feedbackForm = document.querySelector("#feedbackForm");
  const feedbackText = document.querySelector("#feedbackText");
  const feedbackButton = document.querySelector("#feedbackButton");
  const feedbackStatus = document.querySelector("#feedbackStatus");
  const sampleButton = document.querySelector("#sampleButton");
  const status = document.querySelector("#status");

  load();
  form.addEventListener("submit", save);
  sampleButton.addEventListener("click", insertSample);
  feedbackForm.addEventListener("submit", saveFeedback);

  async function load() {
    const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
    const settings = EtixCore.mergeSettings(stored[SETTINGS_KEY]);
    operatorName.value = settings.operatorName;
    accountLabel.value = settings.accountLabel;
    ticketAliases.value = settings.ticketAliases.join("\n");
    workflowProfile.value = settings.workflowProfile
      ? JSON.stringify(settings.workflowProfile, null, 2)
      : "";
    liveExecutionEnabled.checked = settings.liveExecutionEnabled;
    skipCarerPreview.checked = settings.skipCarerPreview;
    emailExecutionEnabled.checked = settings.emailExecutionEnabled;
    parkingExecutionEnabled.checked = settings.parkingExecutionEnabled;
    emailWorkflowEnabled.checked = settings.emailWorkflowEnabled;
    carerWorkflowEnabled.checked = settings.carerWorkflowEnabled;
    parkingWorkflowEnabled.checked = settings.parkingWorkflowEnabled;
    showPageInspector.checked = settings.showPageInspector;
    showFeedback.checked = settings.showFeedback;
    enhancementSettings = { ...settings.enhancements };
    colourBlindMode.replaceChildren();
    for (const mode of EtixCore.COLOUR_BLIND_MODES) {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.label;
      colourBlindMode.append(option);
    }
    colourBlindMode.value = settings.colourBlindMode;
    renderEnhancements();
  }

  function renderEnhancements() {
    enhancementOptions.replaceChildren();
    enhancementInputs.clear();
    enhancementsEmpty.hidden = EtixCore.ENHANCEMENTS.length > 0;
    for (const enhancement of EtixCore.ENHANCEMENTS) {
      const input = document.createElement("input");
      input.id = `enhancement-${enhancement.id}`;
      input.type = "checkbox";
      input.checked = enhancementSettings[enhancement.id] === true;
      if (enhancement.id === "colourBlindMode") {
        colourBlindOptions.hidden = !input.checked;
        input.addEventListener("change", () => { colourBlindOptions.hidden = !input.checked; });
      }
      enhancementInputs.set(enhancement.id, input);
      const title = document.createElement("strong");
      title.textContent = enhancement.name;
      const description = document.createElement("small");
      description.textContent = enhancement.description || "";
      const text = document.createElement("span");
      text.append(title, description);
      const label = document.createElement("label");
      label.className = "checkbox-row";
      label.htmlFor = input.id;
      label.append(input, text);
      enhancementOptions.append(label);
      if (enhancement.id === "colourBlindMode") enhancementOptions.append(colourBlindOptions);
    }
  }

  async function save(event) {
    event.preventDefault();
    setStatus("", false);

    const aliases = ticketAliases.value
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!aliases.length) {
      setStatus("Add at least one carer ticket alias.", true);
      return;
    }

    let profile = null;
    if (workflowProfile.value.trim()) {
      try {
        profile = JSON.parse(workflowProfile.value);
      } catch (_error) {
        setStatus("Workflow profile is not valid JSON.", true);
        return;
      }
      const check = EtixCore.validateWorkflowProfile(profile);
      if (!check.ok) {
        setStatus(check.error, true);
        return;
      }
    }

    if (liveExecutionEnabled.checked && !profile) {
      setStatus("Install a valid workflow profile before enabling live actions.", true);
      return;
    }

    const settings = {
      operatorName: operatorName.value.trim().slice(0, 120),
      accountLabel: accountLabel.value.trim().slice(0, 120),
      ticketAliases: aliases.slice(0, 100),
      liveExecutionEnabled: liveExecutionEnabled.checked,
      skipCarerPreview: skipCarerPreview.checked,
      emailExecutionEnabled: emailExecutionEnabled.checked,
      parkingExecutionEnabled: parkingExecutionEnabled.checked,
      emailWorkflowEnabled: emailWorkflowEnabled.checked,
      carerWorkflowEnabled: carerWorkflowEnabled.checked,
      parkingWorkflowEnabled: parkingWorkflowEnabled.checked,
      showPageInspector: showPageInspector.checked,
      showFeedback: showFeedback.checked,
      enhancements: {
        ...enhancementSettings,
        ...Object.fromEntries(Array.from(enhancementInputs, ([id, input]) => [id, input.checked]))
      },
      colourBlindMode: colourBlindMode.value,
      workflowProfile: profile
    };
    await extensionApi.storage.local.set({ [SETTINGS_KEY]: settings });
    setStatus("Settings saved locally.", false);
  }

  function insertSample() {
    const sample = EtixCore.DEFAULT_WORKFLOW_PROFILE;
    workflowProfile.value = JSON.stringify(sample, null, 2);
    liveExecutionEnabled.checked = false;
    setStatus("The reviewed Etix carer workflow profile was restored. Live actions remain disabled.", false);
  }

  async function saveFeedback(event) {
    event.preventDefault();
    const text = feedbackText.value.trim();
    if (!text) {
      feedbackStatus.textContent = "Enter feedback first.";
      feedbackStatus.className = "error";
      return;
    }
    feedbackButton.disabled = true;
    feedbackStatus.textContent = "Saving feedback…";
    feedbackStatus.className = "";
    try {
      const response = await extensionApi.runtime.sendMessage({ type: "SAVE_FEEDBACK", payload: { text } });
      if (!response.ok) throw new Error(response.error || "Feedback could not be saved.");
      if (feedbackText.value.trim() === text) feedbackText.value = "";
      feedbackStatus.textContent = "Feedback saved locally for review.";
    } catch (error) {
      feedbackStatus.textContent = error.message || "Feedback could not be saved.";
      feedbackStatus.className = "error";
    } finally {
      feedbackButton.disabled = false;
    }
  }

  function setStatus(message, error) {
    status.textContent = message;
    status.className = error ? "error" : "";
  }
})();
