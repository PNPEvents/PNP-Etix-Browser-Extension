const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { extensionFiles, manifestForBrowser } = require("./extension-config.js");

const root = path.resolve(__dirname, "..");
for (const browser of ["chrome", "firefox"]) {
  const manifest = manifestForBrowser(browser);
  const requiredFiles = new Set([
    ...(manifest.background.scripts || [manifest.background.service_worker]),
    manifest.side_panel?.default_path || manifest.sidebar_action?.default_panel,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])])
  ]);
  // HTML entry points also need their scripts and styles in the archive.
  for (const file of [...requiredFiles].filter((file) => file.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      requiredFiles.add(match[1]);
    }
  }
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Manifest file is missing: ${file}`);
    if (!extensionFiles.includes(file)) throw new Error(`Package file is missing: ${file}`);
  }
  if (manifest.manifest_version !== 3) throw new Error("Expected Manifest V3.");
  if (!manifest.host_permissions.every((value) => value.startsWith("https://"))) {
    throw new Error("All host permissions must require HTTPS.");
  }
  if (manifest.version !== require("../package.json").version) throw new Error("Package and manifest versions must match.");
  console.log(`${browser} manifest check passed (${requiredFiles.size} resources).`);
}

const scriptFiles = [
  "shared.js",
  "background.js",
  "content-script.js",
  "colourblind-core.js",
  "enhancements.js",
  "seat-focus.js",
  "seat-focus-main.js",
  "order-search.js",
  "order-search-main.js",
  "access-request.js",
  "access-request-main.js",
  "sidepanel.js",
  "options.js"
];

for (const file of scriptFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  new vm.Script(source, { filename: file });
}

console.log(`Script syntax check passed (${scriptFiles.length} scripts).`);
