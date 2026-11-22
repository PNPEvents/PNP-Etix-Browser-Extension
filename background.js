// Chrome uses a worker; Firefox loads shared.js first in its background page.
if (typeof importScripts === "function") importScripts("shared.js");

const extensionApi = globalThis.browser || globalThis.chrome;

const SETTINGS_KEY = "etix.settings";
const JOBS_KEY = "etix.jobs";
const FEEDBACK_KEY = "etix.feedback";
const ACTIVE_JOB_KEY = "etix.activeJob";
const MAX_JOBS = 100;
const MAX_FEEDBACK = 100;

extensionApi.runtime.onInstalled.addListener(async () => {
  const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await extensionApi.storage.local.set({ [SETTINGS_KEY]: EtixCore.DEFAULT_SETTINGS });
  } else if (!stored[SETTINGS_KEY].workflowProfile) {
    await extensionApi.storage.local.set({
      [SETTINGS_KEY]: {
        ...EtixCore.mergeSettings(stored[SETTINGS_KEY]),
        workflowProfile: EtixCore.DEFAULT_WORKFLOW_PROFILE,
        liveExecutionEnabled: false
      }
    });
  }
  if (extensionApi.sidePanel) {
    await extensionApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

if (extensionApi.sidebarAction) {
  // Keep this call synchronous with the click to preserve Firefox's user gesture.
  extensionApi.action.onClicked.addListener(() => extensionApi.sidebarAction.open());
}

extensionApi.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const stored = await extensionApi.storage.local.get(ACTIVE_JOB_KEY);
  const active = stored[ACTIVE_JOB_KEY];
  if (active && active.tabId === tabId) scheduleAdvance(active.id);
});

const pendingAdvances = new Map();

function scheduleAdvance(jobId, delay = 450) {
  if (pendingAdvances.has(jobId)) clearTimeout(pendingAdvances.get(jobId));
  pendingAdvances.set(jobId, setTimeout(() => {
    pendingAdvances.delete(jobId);
    advanceActiveJob(jobId).catch(() => {});
  }, delay));
}

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || "Unexpected extension error." });
  });
  return true;
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "GET_STATE":
      return getState();
    case "PREVIEW_CARER_DISCOUNT":
      return runJob("preview", message.payload);
    case "APPLY_CARER_DISCOUNT":
      return runJob("apply", message.payload);
    case "PREVIEW_ORDER_CONFIRMATION_EMAIL":
      return runEmailJob("preview", message.payload);
    case "SEND_ORDER_CONFIRMATION_EMAIL":
      return runEmailJob("apply", message.payload);
    case "PREVIEW_ADD_PARKING":
      return runParkingJob("preview", message.payload);
    case "ADD_PARKING":
      return runParkingJob("apply", message.payload);
    case "INSPECT_PAGE":
      return sendToActiveEtixTab({ type: "INSPECT_PAGE" });
    case "SAVE_FEEDBACK":
      return saveFeedback(message.payload);
    case "OPEN_OPTIONS":
      await extensionApi.runtime.openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: "Unknown extension request." };
  }
}

async function getState() {
  const stored = await extensionApi.storage.local.get([SETTINGS_KEY, JOBS_KEY, FEEDBACK_KEY]);
  return {
    ok: true,
    settings: EtixCore.mergeSettings(stored[SETTINGS_KEY]),
    jobs: stored[JOBS_KEY] || [],
    feedback: stored[FEEDBACK_KEY] || []
  };
}

async function runJob(mode, payload) {
  const orderCheck = EtixCore.validateOrderNumber(payload && payload.orderNumber);
  const quantityCheck = EtixCore.validateQuantity(payload && payload.quantity);
  if (!orderCheck.ok) return { ok: false, error: orderCheck.error };
  if (!quantityCheck.ok) return { ok: false, error: quantityCheck.error };

  const state = await getState();
  const settings = state.settings;
  if (!settings.carerWorkflowEnabled) {
    return { ok: false, error: "The Issue carer discount workflow is disabled in Settings." };
  }
  const job = {
    id: createId(),
    action: "issue_carer_discount",
    mode,
    orderNumber: orderCheck.value,
    quantity: quantityCheck.value,
    operatorName: settings.operatorName,
    accountLabel: settings.accountLabel,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveJob(job);

  if (mode === "apply") {
    const profileCheck = EtixCore.validateWorkflowProfile(settings.workflowProfile);
    if (!settings.liveExecutionEnabled || !profileCheck.ok) {
      const blocked = {
        status: "blocked",
        reason: profileCheck.ok
          ? "Live execution is disabled in extension settings."
          : profileCheck.error,
        stopCode: "calibration_required"
      };
      return finishJob(job, blocked);
    }
  }

  if (settings.workflowProfile && settings.workflowProfile.workflowKind === "etix_carer_reclass") {
    return startEtixBrowserJob(job, settings.workflowProfile);
  }

  let response;
  try {
    response = await sendToActiveEtixTab({
      type: mode === "apply" ? "APPLY_CARER_DISCOUNT" : "PREVIEW_CARER_DISCOUNT",
      payload: {
        orderNumber: orderCheck.value,
        quantity: quantityCheck.value,
        aliases: settings.ticketAliases,
        workflowProfile: settings.workflowProfile
      }
    });
  } catch (error) {
    response = { status: "failed", reason: error.message, stopCode: "extension_error" };
  }
  return finishJob(job, response);
}

async function runEmailJob(mode, payload) {
  const lookupCheck = EtixCore.validateOrderLookup(payload && payload.lookupValue);
  if (!lookupCheck.ok) return { ok: false, error: lookupCheck.error };
  const state = await getState();
  const duplicateWindowMs = 10 * 60 * 1000;
  if (!state.settings.emailWorkflowEnabled) {
    return { ok: false, error: "The Send confirmation email workflow is disabled in Settings." };
  }
  const recentCompletedEmailJobs = (state.jobs || []).filter((item) =>
    (item.action === "send_order_confirmation_email" || item.action === "add_parking" && item.result && item.result.emailSendInvoked) &&
    item.mode === "apply" &&
    item.status === "completed" &&
    Date.now() - new Date(item.updatedAt).getTime() < duplicateWindowMs
  );
  const recentSentBookingNumbers = Array.from(new Set(recentCompletedEmailJobs.flatMap((item) =>
    item.result && Array.isArray(item.result.bookingNumbers)
      ? item.result.bookingNumbers
      : item.orderNumber ? [item.orderNumber] : []
  )));
  const job = {
    id: createId(),
    action: "send_order_confirmation_email",
    mode,
    orderNumber: lookupCheck.type === "order" ? lookupCheck.value : null,
    lookupValue: lookupCheck.value,
    lookupType: lookupCheck.type,
    recentSentBookingNumbers,
    quantity: null,
    operatorName: state.settings.operatorName,
    accountLabel: state.settings.accountLabel,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveJob(job);
  if (mode === "apply") {
    if (!state.settings.emailExecutionEnabled) {
      return finishJob(job, {
        status: "blocked",
        reason: "Confirmation email sending is disabled in extension settings.",
        stopCode: "email_sending_disabled"
      });
    }
    const recentDuplicate = recentCompletedEmailJobs.find((item) =>
      item.lookupValue === lookupCheck.value ||
      (lookupCheck.type === "order" && recentSentBookingNumbers.includes(lookupCheck.value))
    );
    if (recentDuplicate) {
      return finishJob(job, {
        status: "blocked",
        reason: "A confirmation email was already sent for this order within the last 10 minutes.",
        stopCode: "duplicate_email_guard"
      });
    }
  }
  return startEtixBrowserJob(job, null);
}

async function startEtixBrowserJob(job, workflowProfile) {
  const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !EtixCore.isEtixUrl(tab.url)) {
    return finishJob(job, {
      status: "blocked",
      reason: "Open any boxoffice.etix.com page first so the extension can search for the order.",
      stopCode: "etix_tab_required"
    });
  }
  const existing = await extensionApi.storage.local.get(ACTIVE_JOB_KEY);
  if (existing[ACTIVE_JOB_KEY]) {
    return finishJob(job, {
      status: "blocked",
      reason: "Another Etix workflow is already running in this browser.",
      stopCode: "workflow_already_running"
    });
  }

  const active = {
    ...job,
    tabId: tab.id,
    workflowProfile,
    context: {
      recentSentBookingNumbers: job.recentSentBookingNumbers || []
    },
    result: {
      status: "running",
      reason: job.action === "send_order_confirmation_email"
        ? "Searching Etix for the order confirmation email action."
        : job.action === "add_parking" ? "Finding the order and matching its parking venue and date."
        : "The Etix carer reclassification workflow has started."
    }
  };
  await saveJob(active);
  await extensionApi.storage.local.set({ [ACTIVE_JOB_KEY]: active });
  await advanceActiveJob(active.id);
  const refreshed = await extensionApi.storage.local.get([ACTIVE_JOB_KEY, JOBS_KEY]);
  const current = refreshed[ACTIVE_JOB_KEY];
  const saved = (refreshed[JOBS_KEY] || []).find((item) => item.id === job.id);
  return { ok: true, job: current && current.id === job.id ? current : saved || active };
}

async function advanceActiveJob(jobId) {
  const stored = await extensionApi.storage.local.get(ACTIVE_JOB_KEY);
  const active = stored[ACTIVE_JOB_KEY];
  if (!active || active.id !== jobId || active.advancing) return;

  const tab = await extensionApi.tabs.get(active.tabId).catch(() => null);
  if (tab && tab.status === "loading") {
    scheduleAdvance(jobId, 750);
    return;
  }

  active.advancing = true;
  active.updatedAt = new Date().toISOString();
  await extensionApi.storage.local.set({ [ACTIVE_JOB_KEY]: active });

  let response;
  try {
    response = await extensionApi.tabs.sendMessage(active.tabId, {
      type: active.action === "send_order_confirmation_email"
        ? "RUN_ETIX_EMAIL_STEP"
        : active.action === "add_parking" ? "RUN_ETIX_PARKING_STEP"
        : "RUN_ETIX_RECLASS_STEP",
      payload: {
        jobId: active.id,
        orderNumber: active.orderNumber,
        lookupValue: active.lookupValue,
        lookupType: active.lookupType,
        quantity: active.quantity,
        quantities: active.quantities,
        sendConfirmation: active.sendConfirmation,
        registrations: active.action === "add_parking" && active.mode === "apply"
          ? (await extensionApi.storage.session.get(`parking.${active.id}`))[`parking.${active.id}`]
          : undefined,
        mode: active.mode,
        workflowProfile: active.workflowProfile,
        context: active.context
      }
    });
  } catch (error) {
    const message = String(error && error.message || error || "");
    const receiverWasUnavailable = /receiving end does not exist|could not establish connection/i.test(message);
    const retryCount = Number(active.context && active.context.pageReadyRetryCount || 0);
    if (receiverWasUnavailable && retryCount < 2) {
      const retrying = {
        ...active,
        advancing: false,
        context: {
          ...active.context,
          pageReadyRetryCount: retryCount + 1
        },
        status: "running",
        result: {
          status: "running",
          reason: `The Etix page was not ready. Refreshing and retrying automatically (${retryCount + 1}/2).`,
          stage: "refreshing_page"
        },
        updatedAt: new Date().toISOString()
      };
      await saveJob(retrying);
      await extensionApi.storage.local.set({ [ACTIVE_JOB_KEY]: retrying });
      try {
        await extensionApi.tabs.reload(active.tabId);
        return;
      } catch (_reloadError) {
        response = {
          status: "failed",
          reason: "The Etix tab could not be refreshed automatically.",
          stopCode: "page_reload_failed"
        };
      }
    } else {
      response = {
        status: "failed",
        reason: receiverWasUnavailable
          ? "The Etix page was still unavailable after two automatic refresh attempts."
          : "The Etix page connection closed after the workflow step began. It was not retried automatically to avoid a duplicate email or transaction.",
        stopCode: "page_not_ready"
      };
    }
  }

  const context = { ...active.context, ...(response.contextPatch || {}) };
  if (["ready", "completed", "blocked", "needs_input", "failed"].includes(response.status)) {
    const finalResult = { ...response };
    delete finalResult.contextPatch;
    await extensionApi.storage.local.remove(ACTIVE_JOB_KEY);
    await finishJob({ ...active, context, advancing: false }, finalResult);
    return;
  }

  const updated = {
    ...active,
    advancing: false,
    context,
    status: "running",
    result: {
      status: "running",
      reason: response.reason || "Continuing the Etix workflow.",
      stage: response.stage || null
    },
    updatedAt: new Date().toISOString()
  };
  await saveJob(updated);
  await extensionApi.storage.local.set({ [ACTIVE_JOB_KEY]: updated });
  if (response.status === "continue") scheduleAdvance(jobId);
  if (response.status === "navigating") scheduleAdvance(jobId, 1200);
}

async function finishJob(job, result) {
  if (job.action === "add_parking") await extensionApi.storage.session.remove(`parking.${job.id}`);
  const finished = {
    ...job,
    status: result.status || (result.ok === false ? "failed" : "completed"),
    result,
    updatedAt: new Date().toISOString()
  };
  await saveJob(finished);
  return { ok: true, job: finished };
}

async function runParkingJob(mode, payload) {
  const checked = EtixCore.validateParkingRequest(payload, mode === "apply");
  if (!checked.ok) return { ok: false, error: checked.error };
  const state = await getState();
  const { registrations, ...request } = checked.value;
  if (!state.settings.parkingWorkflowEnabled) {
    return { ok: false, error: "The Add Parking workflow is disabled in Settings." };
  }
  const job = {
    ...request,
    id: createId(), action: "add_parking", mode,
    sendConfirmation: payload.sendConfirmation === true,
    operatorName: state.settings.operatorName,
    accountLabel: state.settings.accountLabel,
    status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await saveJob(job);
  if (mode === "apply") {
    if (!state.settings.parkingExecutionEnabled) return finishJob(job, {
      status: "blocked", reason: "Add Parking is disabled in extension settings.", stopCode: "parking_disabled"
    });
    if (job.sendConfirmation && !state.settings.emailWorkflowEnabled) return finishJob(job, {
      status: "blocked", reason: "The Send confirmation email workflow is disabled in Settings. Enable it before selecting this option.", stopCode: "email_workflow_disabled"
    });
    if (job.sendConfirmation && !state.settings.emailExecutionEnabled) return finishJob(job, {
      status: "blocked", reason: "Enable confirmation email sending in settings before selecting this option.", stopCode: "email_sending_disabled"
    });
    const duplicate = state.jobs.find((item) => item.action === "add_parking" && item.mode === "apply" &&
      item.orderNumber === job.orderNumber && Date.now() - new Date(item.updatedAt).getTime() < 10 * 60 * 1000 &&
      (item.status === "completed" || item.context && item.context.purchaseAttempted));
    if (duplicate) return finishJob(job, {
      status: "blocked", reason: "Parking was purchased or submitted for this order in the last 10 minutes. Check the order before adding more.", stopCode: "duplicate_parking_guard"
    });
    // Plates are needed across page navigations but must never enter the audit history.
    await extensionApi.storage.session.set({ [`parking.${job.id}`]: registrations });
  }
  return startEtixBrowserJob(job, null);
}

async function saveJob(job) {
  const stored = await extensionApi.storage.local.get(JOBS_KEY);
  const jobs = stored[JOBS_KEY] || [];
  const existingIndex = jobs.findIndex((item) => item.id === job.id);
  if (existingIndex >= 0) jobs[existingIndex] = job;
  else jobs.unshift(job);
  await extensionApi.storage.local.set({ [JOBS_KEY]: jobs.slice(0, MAX_JOBS) });
}

async function saveFeedback(payload) {
  const text = String(payload && payload.text || "").trim();
  if (!text) return { ok: false, error: "Enter feedback before saving." };
  const stored = await extensionApi.storage.local.get(FEEDBACK_KEY);
  const feedback = stored[FEEDBACK_KEY] || [];
  feedback.unshift({
    id: createId(),
    jobId: payload && payload.jobId || null,
    text: EtixCore.redactText(text).slice(0, 2000),
    createdAt: new Date().toISOString()
  });
  await extensionApi.storage.local.set({ [FEEDBACK_KEY]: feedback.slice(0, MAX_FEEDBACK) });
  return { ok: true };
}

async function sendToActiveEtixTab(message) {
  const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !EtixCore.isEtixUrl(tab.url)) {
    throw new Error("Open the relevant Etix order in the active tab, then try again.");
  }
  try {
    return await extensionApi.tabs.sendMessage(tab.id, message);
  } catch (_error) {
    throw new Error("The Etix page is not ready. Reload it and try again.");
  }
}

function createId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
