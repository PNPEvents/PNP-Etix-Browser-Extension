# Colour-blind enhancement calibration

Inspected in signed-in Chrome on 22 November 2026:

- `/ticket/admin/performanceAdmin/<id>/unassignedSeat.spa`
- `/ticket/admin/performanceAdmin/perfSeatingMap.vw`

The booking list is a virtualised MUI Data Grid. Its `color` cells contain `.MuiAvatar-root` swatches with backgrounds supplied by generated CSS classes, rather than inline styles. The enhancement reads the native computed colour before applying its own scoped styles. Recycled rows are rescanned after class/style/DOM changes.

Both maps expose `.canvas-container` with `canvas.lower-canvas` and `canvas.upper-canvas`. The upper layer must retain its pointer handlers. Each layer gets a separate non-interactive display copy; the source is visually hidden only after conversion succeeds. DOM seat assignments, native canvas pixels and application objects are never written. A single fallback notice and hover handler cover both layers, with transparent upper pixels allowing colour identification on the lower layer. The notice stays hidden when conversion succeeds so that it does not cover seat labels.

Tritanopia is the initial profile. It uses red/cyan/neutral hue families, retains each source colour's luminance, and adds five pattern variants to solid fills. Smaller colour edges are remapped without patterns. A colour's code encodes the original RGB value and remains stable across profiles and page changes. It is a colour identity, not a unique booking identifier or a seat-status interpretation. Matching colours can still be reused by Etix for different bookings.

The live inspection verified the Settings enhancement toggle and default profile, global control styling, booking swatches/codes, map layout and zoomed seat rendering. Automated fixtures cover original-pixel preservation, neutral text and alpha, colour identity, profile changes, restoration on disable, map updates, unreadable canvases, small coloured edges and both drawing layers. A representative 1488 × 760 pixel conversion took approximately 17 ms in a local smoke benchmark; this is not a browser performance guarantee.

The display copy is refreshed at most every 250 ms when visible. The four-million-pixel limit applies per layer. Canvas read failures retain the original source and show a fallback message. Unknown chart engines, cross-origin frames and images remain outside the calibrated map adapter. A broader site audit and feedback from colour-blind operators are still needed before claiming complete accessibility coverage.

Reference: [W3C Understanding Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
