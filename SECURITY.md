# Security model

## Present controls

- Host access is restricted to HTTPS Etix domains.
- The active tab must be an Etix URL before inspection or automation starts.
- The extension does not request browser-history, cookies, password, clipboard, download-history, or all-sites permissions.
- Etix credentials and session cookies are neither read nor stored.
- Inspection exports exclude entered input values, URL queries, and complete page HTML/body text.
- Likely emails, telephone numbers, and long numeric identifiers are redacted from exported labels and text.
- Known customer-identifying table columns such as name, address, postal code, email, and phone are replaced wholesale.
- Live execution is disabled by default.
- Carer live execution requires a complete workflow profile, the exact approved host, matching order evidence, sufficient exact source price codes, the original-payment refund selection, and final success evidence.
- The built-in workflow changes only exact `Adult (18+)` rows to exact `Adult (18+) 50% Off` options.
- The workflow records the starting and expected 50%-off ticket counts and requires an exact final count.
- The workflow checks the linked-ticket acknowledgement only when Etix presents the calibrated `exchanges:j_idt144` checkbox. It does not enable Etix's separate automatic Y-ticket reclassification toggle.
- The unfinished-exchange recovery clicks `exchanges:start-new-btn` only when the page also contains both parts of Etix's specific previous-exchange warning. This cancels an unsubmitted prior exchange before restarting the requested job.
- Add Parking has its own opt-in setting. It requires issued experience tickets with one venue/date, an exact existing-order Add Tickets context, a unique matching parking venue/performance, an exact cart, Cash payment, matching purchase/cart totals, and final issued ticket-count verification.
- Parking purchase intent is checkpointed before Purchase; recent potentially submitted purchases are guarded against retries. Registration plates live only in browser session storage during a job and are removed on terminal outcomes. They are never written to the persistent job history. A browser restart clears session storage and a job with missing plates stops.
- Optional parking confirmation requires the separate email setting and runs only after parking verification. The Etix checkout email checkbox is cleared to avoid an early or duplicate send.
- A missing or mismatched condition stops the workflow.

## Known limitations

- Redaction is defensive, not a guarantee. Names or addresses can appear in unexpected columns or labels, so operators must review inspection JSON before sharing it.
- Browser local extension storage is not a central audit system and is not suitable as the sole production record.
- The generic discovery preview can identify likely controls but never authorises live clicking.
- The checkpointed workflow depends on the observed Etix paths and JSF control identifiers; any mismatch stops the job.
- The current version does not yet check a central idempotency key or Etix's complete historical discount state.
- A failed final verification can mean Etix accepted a transaction whose outcome is unknown. Operators must inspect the order before retrying.
- Resend Email is an immediate external communication. It has a separate opt-in setting, verifies the order and presence of a recipient address, disables the UI during invocation, and applies a 10-minute same-order duplicate guard.
- Etix exposes no persistent email-send evidence in the observed workflow. The extension watches briefly for transient success text and distinguishes “invoked” from “delivery independently verified”.
- Email-address searches process only orders whose experience date is in the browser's current year. Booking numbers are deduplicated before sending; parking and ticket-protection lines are excluded from customer-facing attendance summaries.

## Production requirements

- Use enterprise identity and role-based access.
- Store approved workflow versions and audit events centrally with encryption and retention policies.
- Sign every job with a unique request ID and reject replays.
- Keep before/after facts sufficient to prove exactly one intended mutation without retaining unnecessary customer data.
- Run an authorised test suite before enabling each workflow version.
- Distribute Chrome/Edge builds through an approved store listing or managed browser policy, and Firefox builds through Mozilla signing for public or private distribution.
- Add server-side revocation so live execution can be disabled immediately across all users.

Do not report security issues with real customer or credential data attached.

## Public repository and publishing credentials

This repository and its release assets are public. Never commit credentials, real customer/order records, browser profiles, inspection exports, HAR files, unredacted screenshots or transaction captures. Use synthetic fixtures in tests. Store Mozilla signing credentials and any future Chrome publisher credentials only as encrypted GitHub Actions secrets; the extension must never contain publisher keys.

The public-file check rejects prohibited tracked paths, a pre-push hook is available for local checkouts, and CI scans history with Gitleaks before release publishing. Enable GitHub push protection as a separate server-side safeguard. CI runs after a push, and scanners cannot identify every secret or personal detail. See [publishing safeguards and setup](docs/publishing.md#keeping-the-public-repository-free-of-private-data).
