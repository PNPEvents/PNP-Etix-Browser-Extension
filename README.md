# Etix Support Assistant

PNP Events staff helper. Source and downloads: [PNPEvents/PNP-Etix-Browser-Extension](https://github.com/PNPEvents/PNP-Etix-Browser-Extension).

An installable Chrome/Edge and Firefox Manifest V3 extension for safe, versioned Etix support workflows.

The current build provides:

- A browser side panel for the `issue carer discount` command.
- Local operator and Etix-account labels.
- Conservative matching for configurable carer-ticket aliases.
- Explicit `ready`, `needs_input`, `blocked`, `failed`, and `completed` outcomes.
- A redacted Etix page inspector for workflow calibration.
- Local job history and feedback records.
- A checkpointed Order Details → Change Price Code → Exchange → verification workflow.
- Automatic top-navigation order search and exact order-result opening from any `boxoffice.etix.com` page.
- Exact quantity handling for one or more eligible standard adult tickets.
- A reviewed mapping from `Adult (18+)` to `Adult (18+) 50% Off` with the `Carers Ticket` note.
- Original-payment refund and final ticket-count verification.
- Conditional acknowledgement of Etix's linked parking/protection ticket warning when it appears.
- Recovery from Etix's unfinished previous exchange/reclassification warning by selecting its specific Continue control.
- An Add Parking workflow with booking-number lookup, separate Parking / Disabled Parking / Parking Comp quantities, and one registration field per space.
- Parking venue and date matching, exact cart checks, Cash payment, registration-popup completion, and optional updated confirmation after purchase verification.
- A second workflow that searches for an order, verifies a recipient address, and invokes Etix's instant Resend Email action once.
- A 10-minute duplicate-send guard for the same order.
- Email-address lookup with current-year filtering, multi-booking traversal, and one resend per qualifying booking.
- A success modal containing a customer-service reply with booking numbers, ticket quantities, performance date/time, venue, and a Copy button.
- Automatic page refresh and up to two safe retries when an Etix content script is not yet available.
- Live submission disabled until the operator explicitly enables the reviewed profile.

It does **not** store Etix usernames, passwords, or cookies. Parking registration plates are held temporarily in browser session storage while a job runs, then removed when it settles; they are excluded from local job history and inspection input values. The extension operates only on an Etix tab where the user has already signed in.

## Install locally

### Chrome / Edge

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Microsoft Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project directory.
5. Pin **Etix Support Assistant**.
6. Open an Etix page and select the extension icon to open the side panel.

The extension requests access only to HTTPS pages on `etix.com` and its subdomains.

### Firefox

Requires **Firefox 142 or later on desktop**. The Firefox build uses the browser's native sidebar and shares the same workflows, settings and Etix enhancements as Chrome/Edge.

1. Run `npm run package:firefox`, or extract `release/etix-support-assistant-0.9.28-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Choose `release/firefox/manifest.json`, or `manifest.json` from the extracted Firefox ZIP. The project's root manifest is for Chrome/Edge.
5. Allow access to Etix when Firefox asks, then open or refresh an Etix tab.
6. Pin **Etix Support Assistant** to the toolbar if needed, then select its icon to open the sidebar. It is also available in Firefox's **View → Sidebar** menu.

Temporary add-ons are removed when Firefox restarts; load the same manifest again to continue testing. For a permanent install in standard Firefox, the Firefox package must first be [signed by Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), either for an Add-ons listing or private distribution. The generated ZIP is unsigned. See Mozilla's [temporary installation instructions](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

Settings and job history are local to each browser; configure Firefox separately. Firefox on Android is not supported by this sidebar build.

## First calibration session

1. Sign into Etix normally.
2. Open any page on `boxoffice.etix.com`; the extension can search for the requested order automatically.
3. Open the extension side panel. In Settings → Optional tools, enable **Show Inspect Etix page** and save.
4. Enter the order number and select **Preview current order**.
5. Select **Inspect and download**.
6. Review the JSON file before sharing it. The export excludes entered input values, URL query strings, and the page body; redacts common emails, phone numbers, long numbers, and known customer table columns; and includes only the table/control structure needed for calibration.
7. Repeat on any confirmation and success states that are separate pages or dialogs. Schema version 2 also records checkbox state, dropdown labels, submit-button labels, and table positions.

The supplied version-2 profile is based on the captured `boxoffice.etix.com` workflow. Preview the order before enabling live actions. The first live run should be watched against an authorised test or safely controlled order.

## Local settings

Select the cog in the side panel to configure:

- Operator name.
- Etix account label.
- Approved carer-ticket aliases.
- A reviewed workflow profile.
- The live-execution switch.

All of these values are kept in the browser's local extension storage in this version. They are not synchronised to a backend.

In Settings → Enabled workflows, independently enable or disable **Send confirmation email**, **Issue carer discount**, and **Add Parking**, then save. All three start enabled, including when upgrading. Disabling a workflow hides its card and blocks new previews and runs; existing jobs finish normally. Live-action permissions are saved separately and still apply when a workflow is enabled. Disabling Send confirmation email also disables the optional confirmation after adding parking. If every workflow is disabled, the panel shows a message directing you to Settings.

**Inspect Etix page** and the side-panel **Feedback** section are hidden by default. In Settings → Optional tools, turn on either section and save to display it. The feedback form in Settings is always available and saves suggestions locally. **Recent activity** starts collapsed; select its heading to open or close the activity drawer, with Refresh inside.

The connection indicator beside Settings shows a green tick when the active tab is an Etix page, or a red cross otherwise. Hover over it for connection details or an error message; the same status is available to screen readers.

**Etix Enhancements** in Settings contains independent on/off switches, disabled by default. Entries are declared in `EtixCore.ENHANCEMENTS` with `id`, `name`, and `description`; switches are generated automatically and saved locally under `settings.enhancements[id]` using **Save settings**.

### Colour-blind friendly mode

**Colour-blind friendly mode** starts unticked. Enable it under Etix Enhancements to reveal the colour-vision profile picker directly beneath its toggle, then choose a profile and save. **Tritanopia / Tritanomaly (blue–yellow)** is the preselected profile and prioritises red/cyan differences, patterns and contrast. Protanopia, Deuteranopia and Monochrome profiles are also available. Saving applies immediately to pages that have the enhancement script loaded; after updating the extension, refresh existing Etix tabs once.

Across Etix pages, the mode underlines links, strengthens keyboard focus and selected controls, and distinguishes supported success/error/warning controls with different borders as well as colour. The inspected Unassigned Seat page's booking swatches gain a pattern and a stable colour-group code. Hovering a coloured map area shows the same code for the same original RGB colour, even across profiles. Codes identify colours, not booking numbers or availability states; if Etix reuses a colour for several bookings, compare their native booking and seat details too.

The Unassigned Seat and SeatSuite Seat Management canvases receive local display copies of both drawing layers. Solid colour fills get patterns; smaller chromatic edges use the same adapted hue families. Original neutral text and native controls are retained. Original canvas pixels, seat assignments, saved colours and transactions are never changed. Copies refresh up to four times per second while visible; turning the enhancement off removes them and restores native styling. Maps larger than four million pixels per layer or blocked by browser canvas protections retain their original appearance and display an explanation. Other chart engines, photographs and cross-origin content are not guaranteed to be adapted. This is an accessibility aid, not a claim of full-site WCAG conformance.

The design follows [W3C's guidance on using cues in addition to colour](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

### Flash focused seats

Enable **Flash focused seats** under Settings → Etix Enhancements and save. On Unassigned Seat, clicking a booking's **Seating** link retains Etix's normal pan/zoom and square markers, scrolls the train into view, then adds black/white pulsing outlines around that booking's visible seats for up to 30 seconds. Clicking elsewhere, editing a form or pressing Escape ends the highlight; another seating click starts a fresh one. Scrolling to examine the train keeps it active. It works independently of colour-blind mode. Reduced-motion preferences replace the pulse with a steady outline.

The enhancement waits for Etix's focused booking to match the clicked row, so it does not flash seats from a previous booking while the new view loads. Another seating click cancels the old pulse. Turning the setting off, leaving the tab, or removing the booking row also stops it. The display overlay does not intercept clicks or modify seat assignments, native drawing objects or transactions. If Etix's calibrated map interface is unavailable, no guessed highlight is added. Refresh open Etix tabs after updating the extension.

The animation uses one pulse per second and follows [W3C's guidance on flash frequency](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).

### Search Unassigned Seat orders

Enable **Search Unassigned Seat orders** under Settings → Etix Enhancements and save. A search box appears beside **Unassigned / Assigned / All**. Enter an order number or part of a customer name to filter every page of the selected view. Matching ignores case and name accents, and first/last name words can be entered in either order. The result list returns to page one; clearing the box or pressing Escape restores the current view's full list.

The enhancement uses the native MUI grid's complete client-side row model and filter API before pagination, rather than hiding rendered rows. Native sorting, booking/seating links, pagination and existing filters are retained. Changing the assignment view retains the search and updates its result count. Turning the enhancement off restores native filters and layout. Search text is held only in the page and is not saved in extension history or settings. If a future Etix page switches to server pagination or changes its grid interface, the enhancement reports that search is unavailable instead of silently searching one page.

Search survives Etix refreshing its table columns, including when a seating link is clicked. If the list is still loading or temporarily unavailable, search reconnects automatically without discarding the query.

### Door-access request column

Enable **Door-access request column** under Settings → Etix Enhancements and save. On Unassigned Seat, a **♿** column appears beside the customer name. A row shows the same icon only when its order-level answer to the exact disability / closer-to-carriage-doors question is **Yes**. No, missing and unrelated answers leave the cell blank. The header and marked cells have explanatory accessible labels and hover text. This enhancement starts disabled and can be switched off independently.

The column reads the page's existing booking data across pagination and assignment views. It does not change bookings or seat assignments, save answers to extension storage, or include the added column in native exports.

## Validate and package

For automatic GitHub Releases, Firefox signing, an unlisted Chrome Web Store listing, and public-repository safeguards, see [Publishing and distribution](docs/publishing.md).

No dependencies are required.

```bash
npm test
npm run check
npm run package
npm run package:firefox
```

`npm run check` validates both browser manifests and the shared script syntax. `npm run package` writes `release/etix-support-assistant-0.9.28.zip` for Chrome/Edge. `npm run package:firefox` writes `release/etix-support-assistant-0.9.28-firefox.zip` and a ready-to-load directory at `release/firefox/`.

Both packages derive from the root manifest; Firefox replaces the service worker with ordered background scripts, replaces `side_panel` / `sidePanel` with `sidebar_action`, and adds a stable Gecko extension ID. Firefox 142 supports the existing MAIN-world enhancement scripts, session storage and current data-collection manifest metadata. The Firefox manifest declares no external data collection: settings, history and feedback stay local, and the extension has no telemetry or backend.

## Current scope

This is a supervised beta, not yet a production deployment. A production rollout still needs:

- Tests using representative, non-production or authorised test orders.
- A central identity, job, audit, and workflow-version service for multiple users.
- Idempotency enforced centrally and against Etix's existing discount state.
- Managed enterprise extension distribution.
- A ChatGPT MCP tool that submits narrowly scoped jobs to that central service.
- Written confirmation that the intended Etix automation is permitted.

## Supervised beta workflow

1. Open any `boxoffice.etix.com` page.
2. Enter the order number and quantity in the side panel.
3. Select **Find and preview order**. The extension searches Etix, opens the first exact order-ID result, verifies the final Order Details page, and reports the eligible/existing/expected counts.
4. In settings, verify the version-2 profile and enable live actions.
5. Select **Apply discount** and keep the Etix tab open while the workflow runs.
6. Do not retry a failed or unknown-outcome job until the order has been inspected manually.

To use a single-step carer form, enable **Skip carer discount preview** in settings. When live actions are enabled, the Preview button is hidden and **Apply carer discount** searches for the order and runs the fully checked workflow immediately. Turning the option off restores the separate Preview and Apply controls.

The beta only reclassifies exact `Adult (18+)` tickets. It stops instead of changing child, lap-infant, previously discounted, `COMP`, or other price codes.

## Order confirmation email

The side panel includes **Send confirmation email** and accepts either a booking number or customer email address. Preview automatically searches Etix, filters email search results by the current experience year, deduplicates booking numbers, visits each qualifying Order Details page, and collects the experience-ticket summary. Parking and ticket-protection rows are excluded.

The lookup field automatically follows the active tab: opening an Etix Order Details page fills it with the URL's `order_id`, ready for **Send confirmation**; navigating to any other page clears it. Switching tabs updates it too. You can still type a booking number or email address for a fresh search. After a workflow or form reset, the field returns to the currently open order, or stays empty if no order page is open.

The confirmation-email workflow appears first in the side panel. If Etix has finished navigation but the extension script is not available yet, the background worker reloads the same tab and retries up to twice. A connection that closes after a workflow step begins is not retried automatically because the email or transaction might already have been submitted.

Every new email-address lookup submits a fresh Etix search even when an earlier order or search result is still open. A booking-number lookup may reuse the open order only when its visible booking number exactly matches the new request.

Enable email sending separately in Settings before using **Send confirmation**. For email lookup, the workflow sends one confirmation for each qualifying current-year booking. It then displays a copyable reply containing the booking number(s), Adult/Child/Adult-with-lap-infant quantities, performance date and time, and venue.

Bookings whose tickets are all void are skipped without invoking Resend Email. Only issued experience tickets appear in the reply. An email-address search continues to any remaining eligible bookings and leaves skipped bookings out of the reply. If no eligible booking remains, the panel explains why nothing was sent and does not display the details modal.

Etix sends immediately when Resend Email is invoked and leaves no persistent page or history change. The extension verifies the exact order, requires a visible customer email address, invokes the control once, and watches four seconds for a transient success message. If Etix exposes no message, the result states that the send was invoked but delivery was not independently verified. A completed send blocks another send for the same order for 10 minutes.

See [docs/architecture.md](docs/architecture.md), [docs/calibration-findings.md](docs/calibration-findings.md), and [SECURITY.md](SECURITY.md).

## Add Parking

Reload the extension after updating to version 0.9.13. Enable **Add Parking purchases** in Settings; enable **confirmation email sending** too if needed.

1. In **Add Parking**, enter the booking number. The extension searches for that exact booking automatically.
2. Set **Parking**, **Disabled Parking**, and **Parking Comp** quantities (0–10 each). The registration area shows one labelled box per selected space.
3. Enter the registration plates. **Find and preview parking** can check the booking’s ticket venue and date without buying.
4. Optionally select **Send confirmation when completed**.
5. Select **Add Parking** and keep the Etix tab open.

The workflow opens the existing booking’s Add Tickets action, selects its matching parking venue, selects a parking performance on the same calendar date as the issued experience tickets, and adds the exact requested parking types and counts. Wensleydale tickets match Wensleydale parking; South Devon tickets match South Devon parking. Parking performance time can differ from the train time. Multiple matching venues or parking performances, or experience tickets spanning multiple venues/dates, stop for review.

Payment is recorded as **Cash**, as requested. The checked cart total must equal Etix’s purchase total before Cash Tender is filled and Purchase is clicked. The extension fills the subsequent registration popup in the cart’s actual ticket order, submits once, and verifies the added issued ticket counts on the same booking. Optional confirmation uses Resend Email only after verification; Etix’s checkout email checkbox is kept off to avoid an earlier or duplicate confirmation.

A local 10-minute guard stops a second purchase after a completed or potentially submitted parking transaction. Check the booking manually before retrying an uncertain result. The generated registration-field layout is based on the supplied single-ticket capture; the extension requires the matching repeated ticket indexes and exactly one field per requested space. Mixed quantities, venue/date matching, changed carts and totals, plate ordering, optional confirmation and temporary plate storage have automated fixture coverage. A supervised live Etix run is still required, especially for a multi-ticket registration popup and South Devon.
