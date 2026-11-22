(function initialiseSidePanel() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;

  const elements = {
    emailWorkflowSection: document.querySelector("#emailWorkflowSection"),
    carerWorkflowSection: document.querySelector("#carerWorkflowSection"),
    parkingWorkflowSection: document.querySelector("#parkingWorkflowSection"),
    noWorkflowsMessage: document.querySelector("#noWorkflowsMessage"),
    form: document.querySelector("#commandForm"),
    emailForm: document.querySelector("#emailForm"),
    parkingForm: document.querySelector("#parkingForm"),
    parkingOrderNumber: document.querySelector("#parkingOrderNumber"),
    parkingRegistrations: document.querySelector("#parkingRegistrations"),
    parkingPreviewButton: document.querySelector("#parkingPreviewButton"),
    parkingPurchaseButton: document.querySelector("#parkingPurchaseButton"),
    parkingLiveBadge: document.querySelector("#parkingLiveBadge"),
    parkingLiveHelp: document.querySelector("#parkingLiveHelp"),
    parkingSendConfirmation: document.querySelector("#parkingSendConfirmation"),
    parkingEmailHelp: document.querySelector("#parkingEmailHelp"),
    orderNumber: document.querySelector("#orderNumber"),
    quantity: document.querySelector("#quantity"),
    previewButton: document.querySelector("#previewButton"),
    applyButton: document.querySelector("#applyButton"),
    emailOrderNumber: document.querySelector("#emailOrderNumber"),
    emailPreviewButton: document.querySelector("#emailPreviewButton"),
    emailSendButton: document.querySelector("#emailSendButton"),
    emailLiveBadge: document.querySelector("#emailLiveBadge"),
    emailLiveHelp: document.querySelector("#emailLiveHelp"),
    settingsButton: document.querySelector("#settingsButton"),
    liveBadge: document.querySelector("#liveBadge"),
    liveHelp: document.querySelector("#liveHelp"),
    connectionIndicator: document.querySelector("#connectionIndicator"),
    connectionSymbol: document.querySelector("#connectionSymbol"),
    connectionStatusText: document.querySelector("#connectionStatusText"),
    resultCard: document.querySelector("#resultCard"),
    resultTitle: document.querySelector("#resultTitle"),
    resultBadge: document.querySelector("#resultBadge"),
    resultMessage: document.querySelector("#resultMessage"),
    resultDetails: document.querySelector("#resultDetails"),
    inspectorSection: document.querySelector("#inspectorSection"),
    inspectButton: document.querySelector("#inspectButton"),
    inspectionStatus: document.querySelector("#inspectionStatus"),
    feedbackSection: document.querySelector("#feedbackSection"),
    feedbackText: document.querySelector("#feedbackText"),
    feedbackButton: document.querySelector("#feedbackButton"),
    feedbackStatus: document.querySelector("#feedbackStatus"),
    refreshButton: document.querySelector("#refreshButton"),
    historyList: document.querySelector("#historyList"),
    emailSuccessDialog: document.querySelector("#emailSuccessDialog"),
    emailDialogClose: document.querySelector("#emailDialogClose"),
    emailReplyText: document.querySelector("#emailReplyText"),
    copyEmailReplyButton: document.querySelector("#copyEmailReplyButton"),
    copyEmailReplyStatus: document.querySelector("#copyEmailReplyStatus")
  };

  let latestJobId = null;
  let settings = EtixCore.DEFAULT_SETTINGS;
  let emailModalJobId = null;
  let emailWorkflowStarting = false;
  let emailLookupTabKey = null;
  let activeTabCheckId = 0;
  let parkingWorkflowStarting = false;
  let parkingWorkflowBusy = false;
  const dismissedEmailJobIds = new Set();
  const clearedEmailJobIds = new Set();
  const clearedCarerOrderJobIds = new Set();
  const clearedParkingJobIds = new Set();
  const parkingPlateDrafts = { parking: [], disabled: [], comp: [] };
  const parkingQuantityInputs = Array.from(document.querySelectorAll("[data-parking-quantity]"));
  parkingQuantityInputs.forEach((input) => input.addEventListener("input", renderParkingRegistrations));
  elements.parkingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runParkingWorkflow("ADD_PARKING");
  });
  elements.parkingPreviewButton.addEventListener("click", () => runParkingWorkflow("PREVIEW_ADD_PARKING"));
  renderParkingRegistrations();
  const terminalEmailStatuses = new Set(["ready", "completed", "blocked", "needs_input", "failed"]);

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runWorkflow(isSkippingCarerPreview()
      ? "APPLY_CARER_DISCOUNT"
      : "PREVIEW_CARER_DISCOUNT");
  });
  elements.applyButton.addEventListener("click", () => runWorkflow("APPLY_CARER_DISCOUNT"));
  elements.emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runEmailWorkflow("PREVIEW_ORDER_CONFIRMATION_EMAIL");
  });
  elements.emailSendButton.addEventListener("click", () =>
    runEmailWorkflow("SEND_ORDER_CONFIRMATION_EMAIL")
  );
  elements.inspectButton.addEventListener("click", inspectPage);
  elements.feedbackButton.addEventListener("click", saveFeedback);
  elements.settingsButton.addEventListener("click", openOptions);
  elements.refreshButton.addEventListener("click", refreshState);
  elements.emailDialogClose.addEventListener("click", () => elements.emailSuccessDialog.close());
  elements.emailSuccessDialog.addEventListener("close", () => {
    const completedJobId = emailModalJobId;
    if (completedJobId) dismissedEmailJobIds.add(completedJobId);
    emailModalJobId = null;
    elements.emailReplyText.value = "";
    elements.copyEmailReplyStatus.textContent = "";
    if (completedJobId && latestJobId === completedJobId) {
      latestJobId = null;
      elements.resultCard.classList.add("hidden");
    }
    resetEmailLookup();
  });
  elements.copyEmailReplyButton.addEventListener("click", copyEmailReply);
  extensionApi.tabs.onActivated.addListener(checkActiveTab);
  extensionApi.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") checkActiveTab();
  });
  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes["etix.jobs"] || changes["etix.settings"])) refreshState();
  });

  refreshState();
  checkActiveTab();

  async function refreshState() {
    const state = await send({ type: "GET_STATE" });
    if (!state.ok) return showTransientError(state.error);
    settings = state.settings;
    parkingWorkflowBusy = parkingWorkflowStarting || (state.jobs || []).some((job) => job.action === "add_parking" && job.status === "running");
    renderSettings();
    renderHistory(state.jobs || []);
    if (latestJobId) {
      const latest = (state.jobs || []).find((job) => job.id === latestJobId);
      if (latest && latest.result) {
        showResult(latest.result);
        showEmailSuccessIfComplete(latest);
        clearEmailFlowIfSettled(latest);
        clearCarerOrderIfCompleted(latest);
        clearParkingIfCompleted(latest);
      }
    }
  }

  async function checkActiveTab() {
    const checkId = ++activeTabCheckId;
    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (checkId !== activeTabCheckId) return;
    const tab = tabs[0];
    const tabKey = JSON.stringify([tab?.id ?? null, tab?.url ?? ""]);
    // Only navigation (or an explicit form reset) replaces a manually entered lookup.
    if (tabKey !== emailLookupTabKey) {
      emailLookupTabKey = tabKey;
      elements.emailOrderNumber.value = orderNumberFromTabUrl(tab?.url);
    }
    const connected = Boolean(tab && EtixCore.isEtixUrl(tab.url));
    renderConnectionStatus(connected, connected
      ? `Connected to ${new URL(tab.url).hostname}`
      : "Open an Etix page in this window to inspect or run a workflow.");
    elements.previewButton.disabled = !connected || !settings.carerWorkflowEnabled;
    elements.inspectButton.disabled = !connected;
    elements.applyButton.disabled = !connected || !canRunLive();
    elements.emailPreviewButton.disabled = !connected || !settings.emailWorkflowEnabled;
    elements.emailSendButton.disabled = !connected || !canSendConfirmation();
    elements.parkingPreviewButton.disabled = !connected || parkingWorkflowBusy || !settings.parkingWorkflowEnabled;
    elements.parkingPurchaseButton.disabled = !connected || parkingWorkflowBusy || !settings.parkingWorkflowEnabled || !settings.parkingExecutionEnabled;
    for (const input of elements.parkingForm.querySelectorAll("input")) input.disabled = parkingWorkflowBusy;
    elements.parkingSendConfirmation.disabled = parkingWorkflowBusy || !canSendConfirmation();
  }

  function orderNumberFromTabUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "boxoffice.etix.com" ||
          url.pathname !== "/ticket/boxoffice/orderDetails.vw" ||
          url.searchParams.getAll("order_id").length !== 1) return "";
      const order = EtixCore.validateOrderNumber(url.searchParams.get("order_id"));
      return order.ok ? order.value : "";
    } catch (_error) {
      return "";
    }
  }

  function renderSettings() {
    elements.emailWorkflowSection.hidden = !settings.emailWorkflowEnabled;
    elements.carerWorkflowSection.hidden = !settings.carerWorkflowEnabled;
    elements.parkingWorkflowSection.hidden = !settings.parkingWorkflowEnabled;
    elements.noWorkflowsMessage.hidden = settings.emailWorkflowEnabled || settings.carerWorkflowEnabled || settings.parkingWorkflowEnabled;
    elements.inspectorSection.hidden = !settings.showPageInspector;
    elements.feedbackSection.hidden = !settings.showFeedback;
    const profile = EtixCore.validateWorkflowProfile(settings.workflowProfile);
    const live = settings.liveExecutionEnabled && profile.ok;
    const skipPreview = live && settings.skipCarerPreview;
    elements.liveBadge.textContent = live ? "Live enabled" : "Preview only";
    elements.liveBadge.className = live ? "badge badge-blocked" : "badge badge-safe";
    elements.liveHelp.textContent = live && skipPreview
      ? "Direct apply is enabled. Enter the order and ticket quantity to run the checked carer workflow immediately."
      : live
        ? "Live actions are enabled for the reviewed carer workflow. Preview remains available before applying."
      : "Live submission stays locked until it is enabled in settings.";
    elements.previewButton.classList.toggle("hidden", skipPreview);
    elements.applyButton.textContent = skipPreview ? "Apply carer discount" : "Apply discount";
    const emailLive = Boolean(settings.emailExecutionEnabled);
    elements.emailLiveBadge.textContent = emailLive ? "Live enabled" : "Preview only";
    elements.emailLiveBadge.className = emailLive ? "badge badge-blocked" : "badge badge-safe";
    elements.emailLiveHelp.textContent = emailLive
      ? "Email sending is enabled. Resend Email acts immediately and the extension will invoke it only once per job."
      : "Sending is disabled in settings. Etix sends immediately when Resend Email is clicked.";
    elements.parkingLiveBadge.textContent = settings.parkingExecutionEnabled ? "Live enabled" : "Preview only";
    elements.parkingLiveBadge.className = settings.parkingExecutionEnabled ? "badge badge-blocked" : "badge badge-safe";
    elements.parkingLiveHelp.textContent = settings.parkingExecutionEnabled
      ? "Uses the tickets’ venue and date, records payment as Cash, and fills Etix’s registration popup."
      : "Preview matches the tickets’ venue and date. Enable Add Parking purchases in settings to buy parking using Cash.";
    elements.parkingSendConfirmation.disabled = !canSendConfirmation();
    if (!canSendConfirmation()) elements.parkingSendConfirmation.checked = false;
    elements.parkingEmailHelp.textContent = !settings.emailWorkflowEnabled
      ? "Enable the Send confirmation email workflow in Settings to use this option."
      : settings.emailExecutionEnabled
        ? "Sends Etix’s updated order confirmation after the parking is verified."
        : "Enable confirmation email sending in settings to use this option.";
    checkActiveTab();
  }

  function canRunLive() {
    return settings.carerWorkflowEnabled && settings.liveExecutionEnabled && EtixCore.validateWorkflowProfile(settings.workflowProfile).ok;
  }

  function canSendConfirmation() {
    return settings.emailWorkflowEnabled && settings.emailExecutionEnabled;
  }

  function renderParkingRegistrations() {
    for (const input of elements.parkingRegistrations.querySelectorAll("input")) {
      parkingPlateDrafts[input.dataset.parkingType][Number(input.dataset.plateIndex)] = input.value;
    }
    elements.parkingRegistrations.replaceChildren();
    for (const type of EtixCore.PARKING_TYPES) {
      const quantity = Number(parkingQuantityInputs.find((input) => input.dataset.parkingQuantity === type.key).value);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10) continue;
      parkingPlateDrafts[type.key].length = quantity;
      for (let index = 0; index < quantity; index += 1) {
        const input = document.createElement("input");
        input.id = `parkingPlate-${type.key}-${index}`;
        input.type = "text";
        input.required = true;
        input.maxLength = 20;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.dataset.parkingType = type.key;
        input.dataset.plateIndex = String(index);
        input.value = parkingPlateDrafts[type.key][index] || "";
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.textContent = `${type.label} ${index + 1} reg plate`;
        elements.parkingRegistrations.append(label, input);
      }
    }
    if (!elements.parkingRegistrations.childElementCount) {
      const hint = document.createElement("p");
      hint.className = "help-text";
      hint.textContent = "Select parking quantities to enter a reg plate for each space.";
      elements.parkingRegistrations.append(hint);
    }
  }

  async function runParkingWorkflow(type) {
    const quantities = Object.fromEntries(parkingQuantityInputs.map((input) => [input.dataset.parkingQuantity, input.value]));
    const registrations = Object.fromEntries(EtixCore.PARKING_TYPES.map((item) => [item.key,
      Array.from(elements.parkingRegistrations.querySelectorAll("input"))
        .filter((input) => input.dataset.parkingType === item.key).map((input) => input.value)
    ]));
    const checked = EtixCore.validateParkingRequest({ orderNumber: elements.parkingOrderNumber.value, quantities, registrations }, type === "ADD_PARKING");
    if (!checked.ok) return showResult({ status: "blocked", reason: checked.error, stopCode: "invalid_input" });
    parkingWorkflowStarting = true;
    parkingWorkflowBusy = true;
    checkActiveTab();
    const response = await send({ type, payload: { ...checked.value, sendConfirmation: elements.parkingSendConfirmation.checked } });
    parkingWorkflowStarting = false;
    if (!response.ok) showResult({ status: "failed", reason: response.error, stopCode: "extension_error" });
    else {
      latestJobId = response.job.id;
      showResult(response.job.result);
      clearParkingIfCompleted(response.job);
    }
    await refreshState();
  }

  function clearParkingIfCompleted(job) {
    if (job.action !== "add_parking" || job.status !== "completed" || clearedParkingJobIds.has(job.id)) return;
    clearedParkingJobIds.add(job.id);
    elements.parkingRegistrations.replaceChildren();
    for (const type of EtixCore.PARKING_TYPES) parkingPlateDrafts[type.key] = [];
    elements.parkingForm.reset();
    renderParkingRegistrations();
  }

  function isSkippingCarerPreview() {
    return canRunLive() && Boolean(settings.skipCarerPreview);
  }

  async function runWorkflow(type) {
    const orderCheck = EtixCore.validateOrderNumber(elements.orderNumber.value);
    const quantityCheck = EtixCore.validateQuantity(elements.quantity.value);
    if (!orderCheck.ok || !quantityCheck.ok) {
      showResult({
        status: "blocked",
        reason: orderCheck.error || quantityCheck.error,
        stopCode: "invalid_input"
      });
      return;
    }

    setBusy(true);
    const response = await send({
      type,
      payload: { orderNumber: orderCheck.value, quantity: quantityCheck.value }
    });
    setBusy(false);

    if (!response.ok) {
      showResult({ status: "failed", reason: response.error, stopCode: "extension_error" });
      return;
    }
    latestJobId = response.job.id;
    showResult(response.job.result);
    clearCarerOrderIfCompleted(response.job);
    refreshState();
  }

  function clearCarerOrderIfCompleted(job) {
    if (!job || job.action !== "issue_carer_discount" || job.mode !== "apply" ||
        job.status !== "completed" || clearedCarerOrderJobIds.has(job.id)) return;
    clearedCarerOrderJobIds.add(job.id);
    elements.orderNumber.value = "";
    elements.quantity.value = "1";
    elements.orderNumber.focus();
  }

  async function runEmailWorkflow(type) {
    const lookupCheck = EtixCore.validateOrderLookup(elements.emailOrderNumber.value);
    if (!lookupCheck.ok) {
      showResult({ status: "blocked", reason: lookupCheck.error, stopCode: "invalid_input" });
      return;
    }
    const sending = type === "SEND_ORDER_CONFIRMATION_EMAIL";
    closePreviousEmailSuccess();
    latestJobId = null;
    elements.resultCard.classList.add("hidden");
    emailWorkflowStarting = true;
    elements.emailPreviewButton.disabled = true;
    elements.emailSendButton.disabled = true;
    if (sending) elements.emailSendButton.textContent = "Sending once…";
    else elements.emailPreviewButton.textContent = "Finding order in Etix…";
    const response = await send({
      type,
      payload: { lookupValue: lookupCheck.value }
    });
    elements.emailPreviewButton.disabled = false;
    elements.emailSendButton.disabled = !canSendConfirmation();
    elements.emailPreviewButton.textContent = "Find and preview email";
    elements.emailSendButton.textContent = "Send confirmation";
    if (!response.ok) {
      emailWorkflowStarting = false;
      showResult({ status: "failed", reason: response.error, stopCode: "extension_error" });
      resetEmailLookup();
      return;
    }
    latestJobId = response.job.id;
    emailWorkflowStarting = false;
    showResult(response.job.result);
    showEmailSuccessIfComplete(response.job);
    clearEmailFlowIfSettled(response.job);
    refreshState();
  }

  function clearEmailFlowIfSettled(job) {
    if (!job || job.action !== "send_order_confirmation_email" ||
        !terminalEmailStatuses.has(job.status) || clearedEmailJobIds.has(job.id)) return;
    clearedEmailJobIds.add(job.id);
    resetEmailLookup();
  }

  function resetEmailLookup() {
    elements.emailForm.reset();
    emailLookupTabKey = null;
    elements.emailPreviewButton.textContent = "Find and preview email";
    elements.emailSendButton.textContent = "Send confirmation";
    checkActiveTab();
    if (!elements.emailSuccessDialog.open) elements.emailOrderNumber.focus();
  }

  function closePreviousEmailSuccess() {
    if (elements.emailSuccessDialog.open) elements.emailSuccessDialog.close();
    elements.emailReplyText.value = "";
    elements.copyEmailReplyStatus.textContent = "";
  }

  async function inspectPage() {
    elements.inspectButton.disabled = true;
    elements.inspectionStatus.textContent = "Inspecting visible controls…";
    const response = await send({ type: "INSPECT_PAGE" });
    elements.inspectButton.disabled = false;
    if (!response.ok || !response.inspection) {
      elements.inspectionStatus.textContent = response.error || "Inspection failed.";
      return;
    }

    const json = JSON.stringify(response.inspection, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `etix-page-inspection-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    elements.inspectionStatus.textContent =
      `Downloaded ${response.inspection.controls.length} redacted control descriptions. Review before sharing.`;
  }

  async function saveFeedback() {
    const text = elements.feedbackText.value.trim();
    if (!text) {
      elements.feedbackStatus.textContent = "Enter feedback first.";
      return;
    }
    const response = await send({
      type: "SAVE_FEEDBACK",
      payload: { jobId: latestJobId, text }
    });
    if (!response.ok) {
      elements.feedbackStatus.textContent = response.error;
      return;
    }
    elements.feedbackText.value = "";
    elements.feedbackStatus.textContent = "Feedback saved locally for review.";
  }

  function showResult(result) {
    const status = result.status || "failed";
    elements.resultCard.classList.remove("hidden");
    elements.resultTitle.textContent = titleForStatus(status);
    elements.resultBadge.textContent = status.replace("_", " ");
    elements.resultBadge.className = `badge badge-${status}`;
    elements.resultMessage.textContent = result.reason || "No result details were returned.";
    elements.resultDetails.replaceChildren();

    const details = [
      ["Stop code", result.stopCode],
      ["Order", result.orderNumber],
      ["Quantity", result.quantity],
      ["Parking venue", result.parkingVenue || result.ticketVenue],
      ["Parking date", result.parkingDate],
      ["Payment", result.paymentMethod],
      ["Parking total", result.parkingTotal === undefined ? null : `£${Number(result.parkingTotal).toFixed(2)}`],
      ["Ticket", result.selectedTicket && result.selectedTicket.text],
      ["Confidence", result.selectedTicket && result.selectedTicket.score],
      ["Eligible tickets", result.eligibleTickets],
      ["Existing carer tickets", result.existingCarerTickets],
      ["Expected carer tickets", result.expectedCarerTickets],
      ["Final carer tickets", result.finalCarerTickets],
      ["Refund", result.refundAmount === undefined ? null : `£${Math.abs(Number(result.refundAmount)).toFixed(2)}`],
      ["Stage", result.stage],
      ["Email action", result.emailActionAvailable ? "Available" : null],
      ["Send invoked", result.emailSendInvoked ? "Yes" : null],
      ["Etix confirmation", result.deliveryVerified === undefined ? null : result.deliveryVerified ? "Observed" : "Not exposed"],
      ["Profile", result.calibratedProfile === undefined ? null : result.calibratedProfile ? "Calibrated" : "Discovery only"]
    ];
    for (const [label, value] of details) {
      if (value === null || value === undefined || value === "") continue;
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = String(value);
      elements.resultDetails.append(term, description);
    }
  }

  function renderHistory(jobs) {
    elements.historyList.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No workflow activity yet.";
      elements.historyList.append(empty);
      return;
    }
    for (const job of jobs.slice(0, 10)) {
      const item = document.createElement("li");
      item.className = "history-item";
      const dot = document.createElement("span");
      dot.className = `history-dot ${job.status}`;
      const content = document.createElement("div");
      content.className = "history-main";
      const title = document.createElement("strong");
      title.textContent = job.action === "send_order_confirmation_email"
        ? `${job.mode === "apply" ? "Send" : "Preview"} confirmation email`
        : job.action === "add_parking" ? `${job.mode === "apply" ? "Add" : "Preview"} parking`
        : `${job.mode === "apply" ? "Apply" : "Preview"} carer discount`;
      const meta = document.createElement("span");
      meta.className = "history-meta";
      meta.textContent = `${maskLookup(job.lookupValue || job.orderNumber)} · ${formatDate(job.updatedAt)}`;
      content.append(title, meta);
      const badge = document.createElement("span");
      badge.className = `badge badge-${job.status}`;
      badge.textContent = job.status.replace("_", " ");
      item.append(dot, content, badge);
      elements.historyList.append(item);
    }
  }

  function setBusy(busy) {
    elements.previewButton.disabled = busy;
    elements.applyButton.disabled = busy || !canRunLive();
    elements.previewButton.textContent = busy ? "Finding order in Etix…" : "Find and preview order";
    elements.applyButton.textContent = busy
      ? "Applying carer discount…"
      : isSkippingCarerPreview() ? "Apply carer discount" : "Apply discount";
  }

  function titleForStatus(status) {
    return {
      ready: "Ready for review",
      completed: "Workflow completed",
      running: "Workflow running",
      blocked: "Stopped safely",
      needs_input: "Your input is needed",
      failed: "Could not verify outcome"
    }[status] || "Workflow result";
  }

  function maskIdentifier(value) {
    const stringValue = String(value || "");
    if (stringValue.length <= 4) return "••••";
    return `${"•".repeat(Math.min(8, stringValue.length - 4))}${stringValue.slice(-4)}`;
  }

  function maskLookup(value) {
    const stringValue = String(value || "");
    if (stringValue.includes("@")) {
      const [local, domain] = stringValue.split("@");
      return `${local.slice(0, 1)}•••@${domain}`;
    }
    return maskIdentifier(stringValue);
  }

  function showEmailSuccessIfComplete(job) {
    if (emailWorkflowStarting || !job || dismissedEmailJobIds.has(job.id) ||
        job.action !== "send_order_confirmation_email" ||
        job.status !== "completed" || !job.result || !job.result.emailSendInvoked || !job.result.replyText) return;
    if (emailModalJobId === job.id && elements.emailSuccessDialog.open) return;
    emailModalJobId = job.id;
    elements.emailReplyText.value = job.result.replyText;
    elements.copyEmailReplyStatus.textContent = "";
    if (!elements.emailSuccessDialog.open) elements.emailSuccessDialog.showModal();
  }

  async function copyEmailReply() {
    try {
      await navigator.clipboard.writeText(elements.emailReplyText.value);
    } catch (_error) {
      elements.emailReplyText.select();
      document.execCommand("copy");
    }
    if (elements.emailSuccessDialog.open) elements.emailSuccessDialog.close();
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
      }).format(new Date(value));
    } catch (_error) {
      return "Unknown time";
    }
  }

  async function openOptions() {
    await send({ type: "OPEN_OPTIONS" });
  }

  function renderConnectionStatus(connected, message) {
    elements.connectionIndicator.className = `connection-indicator ${connected ? "connection-connected" : "connection-disconnected"}`;
    elements.connectionIndicator.title = message;
    elements.connectionSymbol.textContent = connected ? "✓" : "✕";
    elements.connectionStatusText.textContent = message;
  }

  function showTransientError(message) {
    renderConnectionStatus(false, message);
  }

  function send(message) {
    return extensionApi.runtime.sendMessage(message).catch((error) => ({
      ok: false,
      error: error.message || "The extension background service is unavailable."
    }));
  }
})();
