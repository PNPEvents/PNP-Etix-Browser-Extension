const { execFileSync } = require("node:child_process");

// Check the Git index as well as .gitignore: force-added files must fail too.
// Raw customer records do not belong in this public source repository.
const forbidden = [
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx|jks|har|zip|xpi|crx|csv|tsv|log)$/i,
  /(^|\/)(?:\.aws|\.ssh|\.codex|\.agents|captures|inspections|exports|private|local-data|browser-profile[^/]*)(\/|$)/i,
  /(^|\/)(?:credentials[^/]*|client_secret[^/]*|secrets)\.json$/i,
  /(^|\/)(?:\.npmrc|gitleaks-report\.[^/]+)$/i,
  /(^|\/)etix-(?:inspection|job|feedback)[^/]*\.json$/i
];

try {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const blocked = files.filter((file) => forbidden.some((pattern) => pattern.test(file)));
  if (blocked.length) {
    console.error("Private/local data paths must be removed from the Git index:");
    for (const file of blocked) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    console.log(`Public-file check passed (${files.length} tracked paths).`);
  }
} catch {
  console.error("Public-file check needs a Git checkout. Run it from the repository root.");
  process.exitCode = 1;
}
