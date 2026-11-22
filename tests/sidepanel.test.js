const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../shared.js");

const orderUrl = (id) => `https://boxoffice.etix.com/ticket/boxoffice/orderDetails.vw?order_id=${id}`;
const searchUrl = "https://boxoffice.etix.com/ticket/boxoffice/orderSearch.vw";
const settle = () => new Promise(setImmediate);

function panel(initialTab, emailResult = { status: "ready", reason: "Found order" }, namespace = "chrome") {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const listeners = {};
      elements.set(selector, {
        value: "", textContent: "", disabled: false, open: false,
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, listener) { listeners[type] = listener; },
        emit(type) { listeners[type]({ preventDefault() {} }); },
        querySelectorAll: () => [],
        replaceChildren() {}, append() {}, focus() {},
        reset() { element("#emailOrderNumber").value = ""; },
        showModal() { this.open = true; },
        close() { this.open = false; listeners.close?.(); }
      });
    }
    return elements.get(selector);
  }
  let activeTab = initialTab;
  let query = async () => activeTab ? [{ ...activeTab }] : [];
  let onUpdated;
  let onActivated;
  let onStorageChanged;
  const messages = [];
  const parkingInputs = core.PARKING_TYPES.map(({ key }) => {
    const input = element(`[data-parking-quantity="${key}"]`);
    input.dataset = { parkingQuantity: key };
    input.value = "0";
    return input;
  });
  const sandbox = {
    EtixCore: core, URL,
    document: {
      querySelector: element,
      querySelectorAll: (selector) => selector === "[data-parking-quantity]" ? parkingInputs : [],
      createElement: () => element(Symbol())
    },
    [namespace]: {
      tabs: {
        query: () => query(),
        onUpdated: { addListener(listener) { onUpdated = listener; } },
        onActivated: { addListener(listener) { onActivated = listener; } }
      },
      storage: { onChanged: { addListener(listener) { onStorageChanged = listener; } } },
      runtime: { sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "GET_STATE") {
          return { ok: true, settings: { ...core.DEFAULT_SETTINGS, emailExecutionEnabled: true }, jobs: [] };
        }
        return { ok: true, job: {
          id: "email-job", action: "send_order_confirmation_email", status: emailResult.status,
          result: emailResult
        } };
      } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sidepanel.js"), "utf8"), sandbox);
  return {
    element, messages,
    navigate(url, status = "loading") {
      activeTab = { id: activeTab.id, url };
      onUpdated(activeTab.id, { url, status });
    },
    activate(tab) { activeTab = tab; onActivated({ tabId: tab?.id }); },
    completeOtherTab() { onUpdated(99, { status: "complete" }); },
    refreshSettings() { onStorageChanged({ "etix.settings": {} }, "local"); },
    setQuery(value) { query = value; }
  };
}

test("Firefox sidebar connects and previews through the browser promise API", async () => {
  const app = panel({ id: 1, url: orderUrl("12345678") }, undefined, "browser");
  await settle();
  assert.equal(app.element("#emailOrderNumber").value, "12345678");
  app.element("#emailForm").emit("submit");
  await settle();
  assert.equal(app.messages.some((message) => message.type === "PREVIEW_ORDER_CONFIRMATION_EMAIL"), true);
});

test("email lookup follows manual search navigation and switching order tabs", async () => {
  const app = panel({ id: 1, url: searchUrl });
  await settle();
  const input = app.element("#emailOrderNumber");
  input.value = "customer@example.com";
  app.navigate(orderUrl("100000001"));
  await settle();
  assert.equal(input.value, "100000001");
  assert.equal(app.element("#emailSendButton").disabled, false);
  app.navigate(searchUrl);
  await settle();
  assert.equal(input.value, "");
  input.value = "100000002";
  app.navigate(orderUrl("100000002"));
  await settle();
  assert.equal(input.value, "100000002");
  app.activate({ id: 2, url: orderUrl("100000003") });
  await settle();
  assert.equal(input.value, "100000003");
  app.activate({ id: 3, url: "https://example.com/" });
  await settle();
  assert.equal(input.value, "");
});

test("initial opening fills only a valid Etix Order Details URL", async () => {
  const cases = [
    [orderUrl("100000001") + "&other=value#details", "100000001"],
    [searchUrl + "?order_id=100000001", ""],
    [orderUrl(""), ""],
    [orderUrl("12"), ""],
    [orderUrl("%3Cscript%3E"), ""],
    [orderUrl("100000001") + "&order_id=100000002", ""],
    [orderUrl("100000001").replace("https:", "http:"), ""],
    [orderUrl("100000001").replace("boxoffice.etix.com", "boxoffice.etix.com.evil.example"), ""],
    ["chrome://newtab/", ""],
    [undefined, ""]
  ];
  for (const [url, expected] of cases) {
    const app = panel({ id: 1, url });
    await settle();
    assert.equal(app.element("#emailOrderNumber").value, expected, String(url));
  }
});

test("settings refresh and unrelated tab updates preserve a typed email lookup", async () => {
  const app = panel({ id: 1, url: orderUrl("100000001") });
  await settle();
  app.element("#emailOrderNumber").value = "customer@example.com";
  app.refreshSettings();
  app.completeOtherTab();
  await settle();
  assert.equal(app.element("#emailOrderNumber").value, "customer@example.com");
});

test("preview reset restores the currently open order ready to send", async () => {
  const app = panel({ id: 1, url: orderUrl("100000001") });
  await settle();
  app.element("#emailOrderNumber").value = "customer@example.com";
  app.element("#emailForm").emit("submit");
  await settle();
  assert.equal(app.messages.find((message) => message.type === "PREVIEW_ORDER_CONFIRMATION_EMAIL").payload.lookupValue, "customer@example.com");
  assert.equal(app.element("#emailOrderNumber").value, "100000001");
  app.element("#emailSendButton").emit("click");
  await settle();
  assert.equal(app.messages.find((message) => message.type === "SEND_ORDER_CONFIRMATION_EMAIL").payload.lookupValue, "100000001");
});

test("workflow reset clears a lookup when no order page is open", async () => {
  const app = panel({ id: 1, url: searchUrl });
  await settle();
  app.element("#emailOrderNumber").value = "customer@example.com";
  app.element("#emailForm").emit("submit");
  await settle();
  assert.equal(app.element("#emailOrderNumber").value, "");
});

test("a late tab query cannot overwrite a newer navigation", async () => {
  const app = panel({ id: 1, url: orderUrl("100000001") });
  await settle();
  let resolveOldQuery;
  app.setQuery(() => new Promise((resolve) => { resolveOldQuery = resolve; }));
  app.completeOtherTab();
  app.setQuery(async () => [{ id: 1, url: searchUrl }]);
  app.navigate(searchUrl);
  await settle();
  resolveOldQuery([{ id: 1, url: orderUrl("100000001") }]);
  await settle();
  assert.equal(app.element("#emailOrderNumber").value, "");
});

test("email details modal opens only after a confirmation was invoked", async () => {
  for (const result of [
    { status: "blocked", stopCode: "all_tickets_void", emailSendInvoked: false },
    { status: "completed", emailSendInvoked: false, replyText: "No confirmation was sent" },
    { status: "completed", emailSendInvoked: true, replyText: "Booking 100000001: Adult x1" }
  ]) {
    const app = panel({ id: 1, url: orderUrl("100000001") }, result);
    await settle();
    app.element("#emailSendButton").emit("click");
    await settle();
    assert.equal(app.element("#emailSuccessDialog").open, Boolean(result.emailSendInvoked));
  }
});
