const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { manifestForBrowser } = require("../scripts/extension-config.js");

const root = path.resolve(__dirname, "..");

function background(browser, initialSettings) {
  const listeners = {};
  const local = initialSettings ? { "etix.settings": initialSettings } : {};
  const calls = [];
  const api = {
    runtime: {
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onMessage: { addListener(listener) { listeners.message = listener; } }
    },
    tabs: { onUpdated: { addListener(listener) { listeners.updated = listener; } } },
    storage: { local: {
      async get(keys) {
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .filter((key) => key in local).map((key) => [key, structuredClone(local[key])]));
      },
      async set(values) { Object.assign(local, structuredClone(values)); }
    } }
  };
  const sandbox = { URL, setTimeout, clearTimeout };
  if (browser === "firefox") {
    sandbox.browser = api;
    // Firefox also exposes chrome; asynchronous APIs must use browser's promises.
    sandbox.chrome = new Proxy({}, { get() { throw new Error("Used Firefox's chrome namespace"); } });
    api.action = { onClicked: { addListener(listener) { listeners.clicked = listener; } } };
    api.sidebarAction = { open() { calls.push("sidebar-open"); return Promise.resolve(); } };
  } else {
    sandbox.chrome = api;
    api.sidePanel = { async setPanelBehavior(options) { calls.push(options); } };
    sandbox.importScripts = (file) => { calls.push(file); load(file); };
  }
  vm.createContext(sandbox);
  function load(file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
  }
  const manifest = manifestForBrowser(browser);
  for (const script of manifest.background.scripts || [manifest.background.service_worker]) load(script);
  return { sandbox, listeners, calls, local };
}

test("Firefox uses a background page and sidebar while preserving Etix hosts and MAIN scripts", () => {
  const chrome = manifestForBrowser("chrome");
  const firefox = manifestForBrowser("firefox");
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.equal(firefox.background.service_worker, undefined);
  assert.deepEqual(firefox.background.scripts, ["shared.js", "background.js"]);
  assert.equal(firefox.side_panel, undefined);
  assert.equal(firefox.permissions.includes("sidePanel"), false);
  assert.equal(firefox.sidebar_action.default_panel, "sidepanel.html");
  assert.deepEqual(firefox.host_permissions, chrome.host_permissions);
  assert.deepEqual(firefox.content_scripts, chrome.content_scripts);
  assert.equal(firefox.content_scripts.some((entry) => entry.world === "MAIN"), true);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, "142.0");
  // Building either variant must not alter later builds of the other browser.
  assert.deepEqual(manifestForBrowser("chrome"), chrome);
  assert.throws(() => manifestForBrowser("unknown"), /Unsupported browser/);
});

test("Firefox background loads shared code without importScripts and initializes safe defaults", async () => {
  const app = background("firefox");
  await app.listeners.installed();
  assert.equal(app.local["etix.settings"].liveExecutionEnabled, false);
  assert.equal(app.local["etix.settings"].emailExecutionEnabled, false);
  assert.equal(app.local["etix.settings"].parkingExecutionEnabled, false);
  assert.equal(typeof app.listeners.updated, "function");
  assert.equal(typeof app.listeners.message, "function");
  assert.deepEqual(app.calls, []);
});

test("Firefox opens the sidebar within the toolbar click, before asynchronous work", () => {
  const app = background("firefox");
  app.listeners.clicked();
  assert.deepEqual(app.calls, ["sidebar-open"]);
});

test("Firefox returns asynchronous runtime responses and preserves existing settings on update", async () => {
  const settings = { operatorName: "Operator", workflowProfile: { version: 2 }, liveExecutionEnabled: true };
  const app = background("firefox", settings);
  await app.listeners.installed();
  assert.deepEqual(app.local["etix.settings"], settings);
  const response = await new Promise((resolve) => {
    assert.equal(app.listeners.message({ type: "GET_STATE" }, {}, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.settings.operatorName, "Operator");
  assert.equal(response.settings.liveExecutionEnabled, true);
});

test("Chrome still imports shared code and opens its native side panel on toolbar clicks", async () => {
  const app = background("chrome");
  await app.listeners.installed();
  assert.equal(app.calls[0], "shared.js");
  assert.equal(app.calls[1].openPanelOnActionClick, true);
  assert.equal(app.listeners.clicked, undefined);
});
