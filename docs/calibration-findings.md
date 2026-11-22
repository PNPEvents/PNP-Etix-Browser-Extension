# Etix carer-discount calibration findings

Analysis date: 3 November 2026

Source: six schema-version-1 redacted inspections supplied by the operator. Source files remain outside the project and were not copied because they may contain residual order information.

## Observed workflow

The requested “carer discount” is implemented by Etix as a price-code reclassification rather than a generic discount control.

```text
Order search
  → optional multiple-venue search results
  → Order Details
  → Change Price Codes (Reclass)
  → select one eligible ticket
  → select the carer price code
  → Exchange review/refund handling
  → submit Exchange
  → Order Details with Reclassed evidence and changed total
```

## Stable evidence observed

- Host: `boxoffice.etix.com`.
- Order search input: `input[name="order_id"]`.
- Order search submit: `#top-nav-order-search-submit-button`.
- Order details path: `/ticket/boxoffice/orderDetails.vw`.
- Reclassification route label: `Change Price Codes (Reclass)`.
- Change-price-code path: `/ticket/boxoffice/exchange/exchanges.vw`.
- Ticket-row checkbox IDs follow `exchanges:performanceTable:<row>:j_idt101`.
- Price-code select IDs follow `exchanges:performanceTable:<row>:priceCodeSelector`.
- The price-code select becomes enabled when its ticket checkbox is selected.
- Exchange review path: `/ticket/sale3z/boxoffice/singleExchange.vw`.
- Final exchange submit: `#singlePage\\:exchange`.
- Successful return is the Order Details page containing `Reclassed`, with a changed order total.

## Safety gaps in the original captures

Schema version 1 did not include:

- Table cell context for each eligible ticket.
- Dropdown option labels or current selections.
- Checkbox checked state.
- The displayed value of `<input type="submit">` controls.
- The relationship between controls and table rows.

Those omissions prevent a safe rule for choosing which ticket to reclass, selecting the exact carer price code, handling the exchange/refund review, and verifying the exact resulting price code.

## Required schema-version-2 captures

After reloading the updated extension, capture these states without completing another unwanted transaction:

1. Multiple-venue search results for a representative order.
2. Change Price Code before selecting a ticket.
3. Change Price Code after selecting the intended ticket but before continuing.
4. Change Price Code after selecting the carer price code but before continuing.
5. Exchange review immediately before the final Exchange submission.
6. Order Details after a known successful reclassification.

Review every export before sharing. Customer-identifying table columns are redacted by schema version 2, but unexpected page fields can still contain personal data.

## Live-execution gate

Do not enable live execution until the following rules are explicit and tested:

- How to choose between multiple venue rows for the same order number.
- Which existing ticket price codes are eligible to become a carer ticket.
- The exact carer price-code labels used across events.
- Whether an order with an existing carer price code should stop or add another.
- How price differences and refund methods must be handled.
- Which final facts prove that exactly one ticket was reclassified.

## Quantity-two run

A later schema-version-2 run established the first concrete mapping:

- Starting order: four `Adult (18+)` and two `Child (2-17)` tickets; no 50%-off tickets.
- Requested quantity: two.
- Selected rows: the first two exact `Adult (18+)` rows.
- Target price code: `Adult (18+) 50% Off` for both rows. The available `COMP` option was not used.
- Required exchange note: `Carers Ticket`.
- Exchange review: the displayed refund matched the difference between the original and reclassified ticket prices; actual transaction amounts are omitted from this public document.
- Refund destination: one checked original credit-card payment method.
- Upsell: ticket protection was declined before final submission.
- Final evidence: two rows marked `Reclassed`, both with `Adult (18+) 50% Off`; the order total decreased by the verified refund; transaction history contained the `Carers Ticket` note.

Version 0.3.0 implements this exact mapping as a checkpointed, opt-in supervised beta. It deliberately refuses other source price codes rather than guessing.

## Linked parking/protection acknowledgement

A later Wensleydale order contained a `Disabled Parking` ticket. After one adult ticket was selected and changed to `Adult (18+) 50% Off`, Etix kept Continue disabled and presented an additional unchecked checkbox named `exchanges:j_idt144`. The operator identified its statement as confirmation that the customer had been informed some Y tickets may be automatically refunded based on the new X tickets.

On another order, Continue remained disabled even after the selected tickets, price codes, note, and any linked-ticket acknowledgement were valid. Manually deselecting and reselecting the chosen ticket refreshed Etix's Continue state. The extension now performs that recovery once, restores and revalidates every target price code and the note, and stops if Continue remains disabled.

Etix later changed the generated exchange-review price-code select suffix from `j_idt233` to `j_idt234`. Review ticket discovery now uses the `Price Code` table column and the stable `singlePage:shoppingCart:` prefix instead of a generated suffix.

Version 0.5.0 checks this acknowledgement only when it appears. It does not change the distinct `exchanges:yToggle` choice labelled “Do you wish to reclass the Y ticket(s) of this order?”.

## Unfinished exchange recovery

Etix can interrupt a new search with a warning that the previous exchange or reclassification was not finished and ask whether to cancel it and start a new one. The recovery page exposes Continue as `exchanges:start-new-btn` and Cancel as `exchanges:cancel-btn`.

Version 0.6.0 selects Continue only when the specific two-part warning text is also present, then resumes automatic order search. This discards only the prior unsubmitted exchange state; it does not reverse a submitted transaction.

## Add Parking inspections (19 November 2026)

Six readable schema-version-2 captures show an existing booking’s Add Tickets page, venue/performance selection, Parking / Disabled Parking / Parking Comp quantity controls, a one-ticket cart, Cash payment fields, the registration popup and the updated order. Source JSON remains outside the project.

- Add Tickets: `orderDetails:j_idt76`; sale path: `/ticket/sale3z/boxoffice/singlePage.vw`.
- Existing-order marker: `singlePage:addingTickets`; venue: `singlePage:venueSelect`; performances: `singlePage:switchEventSelect`.
- Venue choices include Wensleydale Railway - Parking (Leeming Bar service area) and South Devon Railway - Parking. The captured selected performance is Wensleydale parking on the train-ticket calendar day at 00:05.
- Quantity inputs have the three parking labels; the adapter matches those labels rather than generated quantity IDs.
- Add Seats: `singlePage:addSeats`; cart price-code selects use the `singlePage:shoppingCart:` prefix.
- Cash is identified by its payment radio label. The captured page includes `singlePage:processorFeeOnCash`, `singlePage:cash_tender` and `singlePage:totalOrderPrice`; the adapter requires a single visible Cash Tender input and agreement between cart and purchase totals.
- Purchase is identified by its exact submit value, avoiding Purchase & Print.
- Registration field captured: `singlePage:j_idt1236:0:j_idt1281:j_idt1282:0:j_idt1285:1:j_idt1293`; Submit: `singlePage:collectMiscBtn`. Repeated contiguous `j_idt1282` ticket indexes are required for multiple spaces. Only a single-ticket popup was supplied, so this repetition must still be checked in a supervised multi-ticket run.
- The final Order Details inspection contains the newly issued Parking ticket alongside the original train tickets on the same date.
- All supplied checkout email checkboxes were unchecked; the adapter also clears a checked state so optional confirmation happens once after verification.

South Devon venue selection, mixed-type quantities and popup mapping are covered by simulated DOM tests; the supplied live purchase capture is for one Wensleydale Parking ticket.
