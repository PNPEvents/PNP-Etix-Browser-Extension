# Browser releases and store setup

Repository: [PNPEvents/PNP-Etix-Browser-Extension](https://github.com/PNPEvents/PNP-Etix-Browser-Extension).

## Automated GitHub downloads

The **Build and publish extensions** workflow runs when a `vX.Y.Z` tag is pushed. It checks the public-file policy, scans Git history for secrets, verifies the tag matches both `package.json` and `manifest.json`, runs the tests and manifest checks, and builds both browsers on Ubuntu with Node.js 24.

It creates a draft GitHub Release, uploads only the current build's assets, and publishes after all required steps succeed. It never uploads the historical `release/` directory wholesale. Downloads are:

- `etix-support-assistant-X.Y.Z-chrome.zip`: Chrome/Edge unpacked installation or Chrome Web Store upload.
- `etix-support-assistant-X.Y.Z-firefox-unsigned.zip`: Firefox temporary testing.
- `etix-support-assistant-X.Y.Z-firefox.xpi`: permanent Firefox installation, included when Mozilla signing is configured.
- `SHA256SUMS.txt`: checksums of those downloads.

Installation instructions are included in each release. GitHub downloads are public; no credentials or customer records belong in source, release notes, workflow logs or attachments.

To publish the current version for the first time, commit the workflow and source, then from a Git checkout:

```bash
git tag v0.9.28
git push origin v0.9.28
```

For later releases, first increase `version` in both `manifest.json` and `package.json`, commit and push those changes, then tag that commit with the matching version. Do not reuse a tag for different code. Let the workflow create and publish the GitHub Release; do not manually publish it first, because the workflow refuses to replace published releases.

The workflow also has **Actions → Build and publish extensions → Run workflow** with a version tag input. Normally it checks out an existing tag. For the first release, select `main`, enter `v0.9.28`, and enable **Create a new tag at the selected branch commit**. This builds the exact selected commit, then creates the tag only after the security checks, tests and builds pass. Tag creation fails if the tag already exists; rerun with this option off to use an existing tag. No tag is ever moved or overwritten.

Enable **Stop rather than publish an unsigned Firefox build** when a permanent Firefox installer is required. Missing Mozilla credentials will then fail the release rather than publish only the unsigned ZIP. The workflow must be present on the default branch for the Run workflow button. A published release is not overwritten; publish a new version instead.

If the repository restricts Actions, allow the official `actions/checkout` and `actions/setup-node` actions and `contents: write` for the release job. Their commit SHAs are pinned. The normal secret-scan workflow has read-only permissions. Release publishing uses GitHub's built-in token; no personal access token is needed.

## Firefox signing for permanent installation

1. Sign in to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/), creating a Mozilla account if necessary. Complete the developer agreement yourself.
2. For a first manual submission, choose **Submit a New Add-on → On your own** (self-distribution). Upload the Firefox ZIP, not the Chrome ZIP. Alternatively, `web-ext sign` can create the initial unlisted submission automatically once the API secrets below are configured.
3. Generate API credentials at [Mozilla API keys](https://addons.mozilla.org/developers/addon/api/key/). The **JWT issuer** is the API key; the **JWT secret** is the API secret.
4. In [GitHub Actions secrets](https://github.com/PNPEvents/PNP-Etix-Browser-Extension/settings/secrets/actions), choose **New repository secret** and add:

   | Secret name | Mozilla value |
   | --- | --- |
   | `AMO_JWT_ISSUER` | JWT issuer |
   | `AMO_JWT_SECRET` | JWT secret |

   Enter these directly into GitHub's encrypted secrets UI. Do not paste values into this repository, documentation, issues, pull requests, release notes, chat, or plain Actions variables. The workflow passes them as environment variables only to the signing step; they are never copied into the extension.
5. Push the next matching version tag. The workflow runs pinned `web-ext@10.5.0` validation and `sign --channel unlisted`, waits up to 15 minutes for approval, and attaches Mozilla's signed XPI.

Keep the Firefox extension ID `etix-support-assistant@extensions.local` unchanged. Mozilla uses it to recognize updates. A first manual submission must use this same ID. The source package contains readable, unbundled JavaScript; if Mozilla requests reviewer information, provide safe test instructions through its private reviewer interface.

With neither secret configured, both ZIPs are still released and the Firefox ZIP is explicitly labelled unsigned. With only one secret, a signing/validation failure, or a signing timeout, publishing stops and the release stays draft. Mozilla review may require manual follow-up; automation does not bypass it.

A signed XPI persists after Firefox restarts. Install it through **about:addons → gear menu → Install Add-on From File**. Self-distribution here does **not** configure automatic Firefox updates: users must install each newer XPI manually. Automatic updates would require a public HTTPS update manifest and an `update_url` in the Firefox manifest before signing.

If a run fails after saving the signed XPI to its draft, rerunning reuses that file. If Mozilla accepted the version but the workflow timed out or failed before saving it, download the signed XPI from the Developer Hub and attach it to the draft with the exact filename above, then rerun. Do not repeatedly submit the same version. Alternatively, correct the issue and release a new version. The workflow verifies the XPI's version, extension ID and signature-file presence; Firefox performs the actual signature verification on install.

Official references: [Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [web-ext signing options](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign).

## Unlisted Chrome Web Store listing

1. Register through the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), pay the one-time developer registration fee, and complete account verification and two-step verification as requested.
2. Before uploading, add a **128×128 PNG extension icon** to the project, declare it under `icons` in `manifest.json`, and add its path to `extensionFiles` in `scripts/extension-config.js`. The current package has no icon. Prepare at least one screenshot using synthetic or fully redacted data. Google requires the icon and a screenshot.
3. Choose **Add new item** and upload the release's `-chrome.zip`.
4. Complete **Store listing**, **Privacy** and **Test instructions**. Explain the single purpose (Etix staff support workflows), justify `activeTab`, `sidePanel`, `storage`, `tabs` and access to `https://etix.com/*` and `https://*.etix.com/*`, and describe actual data handling. Local storage and operations on an authenticated Etix page still need accurate privacy disclosures. Use a public privacy-policy URL if required by Google's data policies. Keep test accounts and login information in Google's private reviewer fields only.
5. In **Distribution → Visibility**, select **Unlisted**, choose regions, and submit for review. Unlisted items undergo the same review and policy requirements as public listings.
6. Once approved, share the Chrome Web Store installation URL with staff. Chrome handles updates after later versions are uploaded to the **same** store item and approved.

**Unlisted means anyone who knows the URL can install it.** It does not enforce staff-only access. For restricted installation, use Private visibility with approved testers/groups or managed organization distribution.

This workflow publishes downloads to **GitHub Releases**. It does not upload or submit Chrome Web Store versions; upload each Chrome ZIP through the dashboard for now. Store API automation can be added after the initial listing and publisher/OAuth setup exist, with those credentials stored only as Actions secrets. Existing unpacked installations are separate from the store installation, so users should configure the store copy and remove the unpacked copy to avoid duplicate extensions.

Official references: [Registration](https://developer.chrome.com/docs/webstore/register), [Required images](https://developer.chrome.com/docs/webstore/images), [Publishing](https://developer.chrome.com/docs/webstore/publish/), [Unlisted visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## Keeping the public repository free of private data

- `.gitignore` excludes local environment files, common private-key formats, credentials, browser profiles, raw captures, exports, logs and generated packages. Never force-add them. This does not remove files already tracked.
- `npm run check:public` rejects prohibited paths even if force-added. Put synthetic test fixtures in source tests; keep real customer names, contact details, order numbers, registration plates, transactions, cookies, screenshots and HAR/inspection exports outside the repository. Raw CSV/TSV exports are prohibited.
- The **Secret scan** workflow scans Git history on pushes and pull requests with Gitleaks. The release workflow repeats the scan before building or signing. Output is redacted. CI detects problems after a push; it cannot prevent that push from making data public.
- In every new Git checkout, run `npm run setup:hooks` once to install the committed **pre-push** hook. It checks prohibited file paths and scans local Git history before pushing. The script downloads a checksum-verified scanner into a temporary directory and requires network access. A scanner/download failure blocks the push. Hooks can be bypassed, so they are an additional safeguard rather than an access-control boundary.
- In [repository Advanced Security settings](https://github.com/PNPEvents/PNP-Etix-Browser-Extension/settings/security_analysis), enable **Secret Protection / secret scanning** and **Push protection** if not already enabled. Push protection blocks supported secret patterns before publication. These settings require a signed-in repository administrator. They are not configured by the workflow. Optionally require the **Scan for secrets** check in a branch ruleset.
- Store Mozilla credentials and any future Chrome publishing credentials only as encrypted GitHub **Actions secrets**, never plain repository variables. They must never be embedded in extension JavaScript: users can inspect every distributed extension file.
- Scanning cannot identify every credential format or personal/business detail. Review diffs and screenshots before committing. If anything confidential is published, revoke exposed credentials immediately and arrange removal from Git history and release assets; deleting the latest file alone is insufficient.
