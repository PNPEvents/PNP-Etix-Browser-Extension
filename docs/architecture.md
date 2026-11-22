# Architecture

## Current extension

```text
Side panel
   │
   ▼
MV3 background controller ── Browser local storage
   │                         jobs, settings, feedback
   ▼
Etix content script
   │
   ├── redacted page inspection
   ├── conservative ticket matching
   └── calibrated live workflow adapter
```

The background worker owns job creation and local audit records. The content script is the only component that reads or operates the Etix DOM. The side panel displays results and never receives page HTML.

Chrome/Edge run the controller in a service worker and display `sidepanel.html` through `sidePanel`. Firefox 142+ runs the same controller in an event page, with `shared.js` loaded first, and displays the same UI through `sidebarAction`. Its toolbar listener calls `sidebarAction.open()` directly within the click handler, preserving Firefox's user-gesture requirement. Extension scripts prefer Firefox's promise-based `browser` namespace and fall back to `chrome` on Chromium. `scripts/extension-config.js` derives both manifests and owns the package file list; the root `manifest.json` remains directly loadable in Chrome/Edge. The Etix host restrictions and MAIN-world content scripts are identical in both variants.

## Proposed production system

```text
Browser side panel ─┐
                    │
ChatGPT MCP tool ───┼── Central job API ── PostgreSQL audit/workflows
                    │         │
Admin dashboard ────┘         │ authenticated outbound polling
                              ▼
                    User's browser extension
                              │
                              ▼
                    Existing Etix session
```

The extension should make an authenticated outbound connection to the central service and claim only jobs belonging to the signed-in operator and linked Etix profile. ChatGPT must never receive Etix credentials or raw customer-order data beyond the minimum tool result.

## Workflow contract

The initial command is intentionally narrow:

```json
{
  "action": "issue_carer_discount",
  "orderNumber": "12345678",
  "quantity": 1,
  "requestId": "unique-id",
  "etixProfileId": "linked-profile-id"
}
```

Terminal outcomes are:

- `completed`: the action was submitted and calibrated success evidence was observed.
- `needs_input`: a human must resolve a bounded ambiguity.
- `blocked`: a precondition failed before confirmation.
- `failed`: an action may have started but its final state was not verified; the operator must inspect the order before retrying.

Production idempotency should use `(etixProfileId, action, orderNumber, requestId)` plus a pre-action check for an existing equivalent discount.

## Workflow profile version 2

The calibrated carer workflow uses these fields:

```json
{
  "version": 2,
  "workflowKind": "etix_carer_reclass",
  "hosts": ["boxoffice.etix.com"],
  "sourcePriceCodes": ["Adult (18+)"],
  "targetSuffix": "50% Off",
  "note": "Carers Ticket",
  "dependentTicketAcknowledgementName": "exchanges:j_idt144"
}
```

The background worker checkpoints context between page navigations. The content script revalidates the host, order, exact source and target price codes, ticket quantity, negative refund, single original payment method, final target count, reclassification evidence, transaction note, and changed order total.

A carer target price code is recognised when its name contains both `Adult` and `50%`, or contains the word `carer` (including `Carers`). The exact configured `Adult (18+) 50% Off` mapping is preferred when present; an ambiguous set of fallback matches stops for operator review.

Orders containing linked parking or protection tickets can display a required acknowledgement that the customer was informed some Y tickets may be automatically refunded based on the new X tickets. The workflow checks the calibrated acknowledgement when present. It deliberately leaves the separate `exchanges:yToggle` automatic-reclassification choice unchanged.

If Etix reports that a previous exchange or reclassification was not finished, the workflow confirms the exact warning text and selects `#exchanges\\:start-new-btn` (Continue). It then waits for Etix to clear the stale exchange before searching for and reopening the requested order.

Both Preview and Apply can begin on any `boxoffice.etix.com` page. The content script fills the top-navigation order search, follows an exact order-number result, and verifies that the opened Order Details page contains the requested number before previewing or mutating it. Multi-venue search results may contain several identical order links; the extension opens the first exact match and relies on the subsequent order and ticket checks before proceeding.

All present and future order-number workflows must pass through the shared `routeToRequestedOrder` precondition before workflow-specific inspection or mutation. A mismatched open Order Details page triggers a fresh top-navigation search; a stale search-results page is not trusted until the current job has initiated its own search.

The confirmation-email workflow reuses the same checkpointed search and order verification. Etix's `Resend Email` action sends immediately and produced no persistent before/after DOM difference in the calibration run. Version 0.8.0 requires a visible recipient address, invokes the exact action once, observes transient status/alert regions for four seconds, and records whether confirmation was observed. A local 10-minute guard blocks a repeated completed send for the same order.

Version 0.9.0 accepts an email address as the lookup key. Search-result tables are filtered by Performance Date Time for the current year, booking IDs are deduplicated, and each booking is opened and revalidated before sending. Order Details ticket rows are grouped by performance/date/time/venue; parking and protection are excluded and price codes are mapped to customer-facing Adult, Child, Adult with lap infant, or Carer/Companion categories. The completed result carries a plain-text reply rendered in a copyable side-panel modal.

## Add Parking (0.9.13)

`PREVIEW_ADD_PARKING` and `ADD_PARKING` create `add_parking` jobs. `RUN_ETIX_PARKING_STEP` reuses the existing exact-order search precondition and checkpoints venue/performance selection, quantities, cart validation, Cash Tender, Purchase, registration collection/submission, and final order verification. `sendConfirmation` requests Resend Email only after the purchase is verified.

Persistent jobs contain quantities and before/after facts, with no registration values. Plates are stored under `parking.<jobId>` in the browser's `storage.session`, sent only to the active job’s content script, and deleted when the job settles. Preview does not require plates. Purchase intent is persisted before clicking Purchase; a recent completed or potentially submitted same-order parking job blocks a new purchase. Generated popup ticket indexes map registrations to the recorded cart row types, with exact field-count and contiguous-index requirements.
