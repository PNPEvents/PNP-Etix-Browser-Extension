const sourceManifest = require("../manifest.json");

const extensionFiles = [
  "manifest.json",
  "shared.js",
  "background.js",
  "content-script.js",
  "colourblind-core.js",
  "enhancements.js",
  "enhancements.css",
  "seat-focus.js",
  "seat-focus-main.js",
  "order-search.js",
  "order-search-main.js",
  "access-request.js",
  "access-request-main.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "options.html",
  "options.css",
  "options.js"
];

function manifestForBrowser(browser = "chrome") {
  if (!["chrome", "firefox"].includes(browser)) {
    throw new Error(`Unsupported browser: ${browser}. Choose chrome or firefox.`);
  }
  const manifest = structuredClone(sourceManifest);
  if (browser === "firefox") {
    delete manifest.minimum_chrome_version;
    delete manifest.side_panel;
    manifest.permissions = manifest.permissions.filter((permission) => permission !== "sidePanel");
    manifest.background = { scripts: ["shared.js", "background.js"] };
    manifest.sidebar_action = {
      default_title: manifest.action.default_title,
      default_panel: "sidepanel.html",
      open_at_install: false
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: "etix-support-assistant@extensions.local",
        strict_min_version: "142.0",
        data_collection_permissions: { required: ["none"] }
      }
    };
  }
  return manifest;
}

module.exports = { extensionFiles, manifestForBrowser };
