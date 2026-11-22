const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { extensionFiles, manifestForBrowser } = require("./extension-config.js");

const root = path.resolve(__dirname, "..");
const release = path.join(root, "release");
const browser = process.argv[2] || "chrome";
const manifest = manifestForBrowser(browser);
const suffix = browser === "firefox" ? "-firefox" : "";
const output = path.join(release, `etix-support-assistant-${manifest.version}${suffix}.zip`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "etix-extension-"));

fs.mkdirSync(release, { recursive: true });
try {
  for (const file of extensionFiles) {
    if (file === "manifest.json") {
      fs.writeFileSync(path.join(staging, file), `${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      fs.copyFileSync(path.join(root, file), path.join(staging, file));
    }
  }
  // Zip a clean staging directory so old files cannot survive a rebuild.
  const archive = path.join(staging, "extension.zip");
  const result = spawnSync("zip", ["-q", archive, ...extensionFiles], {
    cwd: staging,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "Could not create extension package.");
  fs.copyFileSync(archive, output);
  console.log(output);

  if (browser === "firefox") {
    const unpacked = path.join(release, "firefox");
    fs.rmSync(unpacked, { recursive: true, force: true });
    fs.mkdirSync(unpacked, { recursive: true });
    for (const file of extensionFiles) {
      fs.copyFileSync(path.join(staging, file), path.join(unpacked, file));
    }
    console.log(`Temporary Firefox add-on: ${path.join(unpacked, "manifest.json")}`);
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
