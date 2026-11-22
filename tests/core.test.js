const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared.js");

test("validates order numbers conservatively", () => {
  assert.equal(core.validateOrderNumber("ABC-12345").ok, true);
  assert.equal(core.validateOrderNumber("12").ok, false);
  assert.equal(core.validateOrderNumber("1234<script>").ok, false);
});

test("redacts likely personal identifiers", () => {
  const redacted = core.redactText("alex@example.com 07123 456 789 order 12345678");
  assert.equal(redacted.includes("alex@example.com"), false);
  assert.equal(redacted.includes("07123 456 789"), false);
  assert.equal(redacted.includes("12345678"), false);
});

test("scores exact and partial carer ticket names", () => {
  const aliases = ["essential companion", "carer"];
  assert.equal(core.scoreTicketCandidate("Essential Companion", aliases), 1);
  assert.ok(core.scoreTicketCandidate("Adult - Carer Discount", aliases) >= 0.8);
  assert.equal(core.scoreTicketCandidate("Standard Adult", aliases), 0);
});

test("recognises Adult 50% or carer ticket names", () => {
  assert.equal(core.isCarerTicketName("Adult (18+) 50% Off"), true);
  assert.equal(core.isCarerTicketName("Adult Carer"), true);
  assert.equal(core.isCarerTicketName("Carers Ticket"), true);
  assert.equal(core.isCarerTicketName("Child (2-17) 50% Off"), false);
  assert.equal(core.isCarerTicketName("Adult (18+) 25% Off"), false);
});

test("prefers an exact Adult 50% price code and stops on ambiguous fallbacks", () => {
  const exact = core.chooseCarerPriceCode(
    ["Adult (18+) 50% Off", "Carer"],
    "Adult (18+)",
    "50% Off"
  );
  assert.equal(exact.status, "matched");
  assert.equal(exact.value, "Adult (18+) 50% Off");
  assert.equal(core.chooseCarerPriceCode(["Carer"], "Adult (18+)", "50% Off").value, "Carer");
  assert.equal(core.chooseCarerPriceCode(["Adult Carer", "Carer"], "Adult", "50% Off").status, "needs_input");
});

test("stops when two ticket candidates are ambiguous", () => {
  const result = core.chooseTicketCandidate([
    { id: "a", text: "Carer" },
    { id: "b", text: "Carer ticket" }
  ], ["carer"]);
  assert.equal(result.status, "needs_input");
});

test("chooses one unambiguous candidate", () => {
  const result = core.chooseTicketCandidate([
    { id: "a", text: "Standard Adult" },
    { id: "b", text: "Essential Companion" }
  ], ["essential companion"]);
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.id, "b");
});

test("requires all destructive workflow selectors", () => {
  const invalid = core.validateWorkflowProfile({ version: 1, hosts: ["admin.etix.com"] });
  assert.equal(invalid.ok, false);

  const valid = core.validateWorkflowProfile({
    version: 1,
    hosts: ["admin.etix.com"],
    orderEvidenceSelector: "#order",
    ticketRowSelector: ".ticket",
    ticketNameSelector: ".name",
    discountButtonSelector: ".discount",
    confirmationButtonSelector: ".confirm",
    successSelector: ".success"
  });
  assert.equal(valid.ok, true);
});

test("only accepts HTTPS Etix URLs", () => {
  assert.equal(core.isEtixUrl("https://admin.etix.com/orders"), true);
  assert.equal(core.isEtixUrl("http://admin.etix.com/orders"), false);
  assert.equal(core.isEtixUrl("https://etix.com.evil.example/orders"), false);
});

test("routes every order workflow to the requested order before acting", () => {
  assert.equal(core.orderRoutingDecision("order_details", "1111", "2222", false), "search");
  assert.equal(core.orderRoutingDecision("order_details", "2222", "2222", false), "ready");
  assert.equal(core.orderRoutingDecision("order_search_results", null, "2222", false), "search");
  assert.equal(core.orderRoutingDecision("order_search_results", null, "2222", true), "open_search_result");
});

test("workflow hosts cannot use lookalike domains", () => {
  const base = {
    version: 1,
    orderEvidenceSelector: "#order",
    ticketRowSelector: ".ticket",
    ticketNameSelector: ".name",
    discountButtonSelector: ".discount",
    confirmationButtonSelector: ".confirm",
    successSelector: ".success"
  };
  assert.equal(core.validateWorkflowProfile({ ...base, hosts: ["admin.etix.com"] }).ok, true);
  assert.equal(core.validateWorkflowProfile({ ...base, hosts: ["notetix.com"] }).ok, false);
});

test("accepts the calibrated Etix carer reclassification profile", () => {
  const result = core.validateWorkflowProfile(core.DEFAULT_WORKFLOW_PROFILE);
  assert.equal(result.ok, true);
  assert.equal(result.value.targetSuffix, "50% Off");
  assert.equal(result.value.dependentTicketAcknowledgementName, "exchanges:j_idt144");
});

test("confirmation email sending is opt-in by default", () => {
  assert.equal(core.DEFAULT_SETTINGS.emailExecutionEnabled, false);
  assert.equal(core.mergeSettings({ operatorName: "Tester" }).emailExecutionEnabled, false);
});

test("skipping the carer preview is optional and disabled by default", () => {
  assert.equal(core.DEFAULT_SETTINGS.skipCarerPreview, false);
  assert.equal(core.mergeSettings({ skipCarerPreview: true }).skipCarerPreview, true);
});

test("accepts either an order number or email address for email lookup", () => {
  assert.deepEqual(core.validateOrderLookup("ABC-1234"), { ok: true, value: "ABC-1234", type: "order" });
  assert.deepEqual(core.validateOrderLookup("Customer@Example.com"), {
    ok: true,
    value: "customer@example.com",
    type: "email"
  });
  assert.equal(core.validateOrderLookup("not-an-email@").ok, false);
});

test("parses Etix performance date formats", () => {
  assert.deepEqual(core.parsePerformanceDateTime("06/12/26 17:20"), {
    year: 2026,
    date: "6 December 2026",
    time: "17:20"
  });
  assert.deepEqual(core.parsePerformanceDateTime("15 November 2026 13:00"), {
    year: 2026,
    date: "15 November 2026",
    time: "13:00"
  });
});

test("groups Etix price-code names into customer-facing ticket labels", () => {
  assert.equal(core.ticketTypeLabel("Adult (18+) 50% Off"), "Adult");
  assert.equal(core.ticketTypeLabel("Adult (18+) with Lap Infant (Under 2)"), "Adult with lap infant");
  assert.equal(core.ticketTypeLabel("Child (2-17)"), "Child");
});

test("formats a copyable reply for multiple bookings", () => {
  const reply = core.formatCustomerReply([
    {
      bookingNumber: "1001",
      attendance: [{
        performanceDate: "6 December 2026",
        performanceTime: "17:20",
        venue: "Euston Station",
        tickets: { Adult: 2, Child: 1 }
      }]
    },
    {
      bookingNumber: "1002",
      attendance: [{
        performanceDate: "15 December 2026",
        performanceTime: "13:00",
        venue: "Spa Valley Railway",
        tickets: { "Adult with lap infant": 1 }
      }]
    }
  ]);
  assert.match(reply, /multiple booking numbers this year: 1001 and 1002/);
  assert.match(reply, /Adult x2, Child x1/);
  assert.match(reply, /Adult with lap infant x1/);
  assert.match(reply, /Look for an email from Etix\.com/);
});
