const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

test("public-file check rejects force-added private files and permits synthetic tests", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "etix-public-check-"));
  const script = path.resolve(__dirname, "../scripts/check-public-files.js");
  const git = (...args) => execFileSync("git", args, { cwd: folder, stdio: "pipe" });
  const check = () => spawnSync(process.execPath, [script], { cwd: folder, encoding: "utf8" });
  try {
    git("init", "--quiet");
    fs.mkdirSync(path.join(folder, "tests"));
    fs.writeFileSync(path.join(folder, "tests/fixture.js"), 'const email = "customer@example.com";');
    fs.writeFileSync(path.join(folder, ".gitignore"), ".env\nexports/\n");
    git("add", ".gitignore", "tests/fixture.js");
    assert.equal(check().status, 0);
    fs.writeFileSync(path.join(folder, ".env"), "LOCAL_ONLY=value\n");
    fs.mkdirSync(path.join(folder, "exports"));
    fs.writeFileSync(path.join(folder, "exports/orders.json"), "[]");
    git("add", "--force", ".env", "exports/orders.json");
    const result = check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.env/);
    assert.match(result.stderr, /exports\/orders\.json/);
    assert.doesNotMatch(result.stderr, /LOCAL_ONLY|value/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
