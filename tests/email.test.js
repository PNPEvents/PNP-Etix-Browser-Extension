const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../shared.js");

class Element {
  constructor(tag, properties = {}, children = []) {
    this.tagName = tag.toUpperCase();
    Object.assign(this, properties);
    this.children = children;
  }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join(" "); }
  get innerText() { return this.textContent; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return descendants.filter((child) => selector.split(",").some((part) => {
      if (part.trim() === "*") return true;
      const match = part.trim().match(/^(\w+)?(?:\[([\w-]+)(\^=|=)'([^']*)'\])?$/);
      if (!match || match[1] && child.tagName !== match[1].toUpperCase()) return false;
      if (!match[2]) return true;
      const value = String(child[match[2]] || "");
      return match[3] === "^=" ? value.startsWith(match[4]) : value === match[4];
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  dispatchEvent() {}
  click() { this.onClick?.(); }
}
const el = (tag, properties, children) => new Element(tag, properties, children);
const year = new Date().getFullYear();
const ticket = (status = "ISSUED", priceCode = "Adult (18+)") =>
  [status, "12345", `11 December ${year} 12:25`, "THE POLAR EXPRESS Train Ride", "Wensleydale Railway", priceCode];
const request = (overrides = {}) => ({
  mode: "apply", lookupType: "order", lookupValue: "12345678", context: {}, ...overrides
});

function emailPage(bookings, { missingStatus = false, resendAvailable = true } = {}) {
  let listener;
  let body;
  const sent = [];
  const searched = [];
  const searchInput = el("input", { name: "order_id", value: "" });
  function open(bookingNumber) {
    let headers = ["Status", "Serial #", "Date", "Performance", "Venue", "Price Code"];
    let rows = bookings[bookingNumber];
    if (missingStatus) { headers = headers.slice(1); rows = rows.map((row) => row.slice(1)); }
    body = el("body", {}, [
      el("h1", { text: `Order Details: ${bookingNumber}` }),
      el("table", {}, [
        el("tr", {}, headers.map((text) => el("th", { text }))),
        ...rows.map((cells) => el("tr", {}, cells.map((text) => el("td", { text }))))
      ]),
      searchInput,
      el("button", { id: "top-nav-order-search-submit-button", onClick() {
        searched.push(searchInput.value);
        open(searchInput.value);
      } }),
      el("a", { href: "mailto:customer@example.com" }),
      ...(resendAvailable ? [el("a", { text: "Resend Email", onClick() { sent.push(bookingNumber); } })] : [])
    ]);
  }
  open(Object.keys(bookings)[0]);
  const document = {
    get body() { return body; }, documentElement: {},
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => body.querySelectorAll("*").find((node) => node.id === id) || null
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../content-script.js"), "utf8"), {
    EtixCore: core, document, Event: class {},
    location: { hostname: "boxoffice.etix.com", pathname: "/ticket/boxoffice/orderDetails.vw" },
    chrome: { runtime: { onMessage: { addListener(handler) { listener = handler; } } } },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback) => setTimeout(callback, 0), clearTimeout,
    setInterval: () => 0, clearInterval() {}
  });
  return {
    sent, searched,
    send: (payload) => new Promise((resolve) => listener({ type: "RUN_ETIX_EMAIL_STEP", payload }, null, resolve))
  };
}

test("all-void bookings stop before Resend Email in preview and send modes", async () => {
  for (const mode of ["preview", "apply"]) {
    for (const resendAvailable of [true, false]) {
      const page = emailPage({ "12345678": [ticket("VOID"), ticket("VOIDED", "Child (2-17)")] }, { resendAvailable });
      const result = await page.send(request({ mode }));
      assert.equal(result.status, "blocked");
      assert.equal(result.stopCode, "all_tickets_void");
      assert.equal(result.emailSendInvoked, false);
      assert.equal(result.replyText, undefined);
      assert.match(result.reason, /all tickets void/);
      assert.equal(page.sent.length, 0);
    }
  }
});

test("a partly void booking sends once and includes only issued experience tickets", async () => {
  const page = emailPage({ "12345678": [ticket(), ticket("VOID", "Child (2-17)"), ticket("REFUNDED", "Child (2-17)"), ticket("ISSUED", "Parking")] });
  const result = await page.send(request());
  assert.equal(result.status, "completed");
  assert.deepEqual(page.sent, ["12345678"]);
  assert.equal(JSON.stringify(result.bookings[0].attendance[0].tickets), JSON.stringify({ Adult: 1 }));
  assert.match(result.replyText, /Adult x1/);
  assert.doesNotMatch(result.replyText, /Child|Parking/);
});

test("email lookup skips void bookings anywhere in the queue and replies only for sent bookings", async () => {
  for (const statuses of [["VOID", "ISSUED"], ["ISSUED", "VOID"], ["VOID", "VOID"]]) {
    const numbers = ["12345678", "87654321"];
    const page = emailPage(Object.fromEntries(numbers.map((number, index) => [number, [ticket(statuses[index])]])));
    const payload = request({ lookupType: "email", lookupValue: "customer@example.com", context: {
      searchStarted: true, orderQueue: numbers, queueIndex: 0, processedBookings: []
    } });
    let result = await page.send(payload);
    assert.equal(result.status, "navigating");
    assert.deepEqual(page.searched, ["87654321"]);
    payload.context = { ...payload.context, ...result.contextPatch };
    result = await page.send(payload);
    const eligible = numbers.filter((_, index) => statuses[index] === "ISSUED");
    const skipped = numbers.filter((_, index) => statuses[index] === "VOID");
    assert.deepEqual(page.sent, eligible);
    assert.equal(JSON.stringify(result.skippedVoidBookingNumbers), JSON.stringify(skipped));
    assert.equal(result.status, eligible.length ? "completed" : "blocked");
    if (eligible.length) {
      assert.equal(JSON.stringify(result.bookingNumbers), JSON.stringify(eligible));
      assert.match(result.replyText, new RegExp(eligible[0]));
      assert.doesNotMatch(result.replyText, new RegExp(skipped[0]));
    } else {
      assert.equal(result.stopCode, "all_tickets_void");
      assert.equal(result.emailSendInvoked, false);
      assert.equal(result.replyText, undefined);
    }
  }
});

test("unreadable ticket status and bookings without issued experiences do not send", async () => {
  for (const [rows, options, stopCode] of [
    [[ticket()], { missingStatus: true }, "ticket_status_missing"],
    [[], {}, "ticket_status_missing"],
    [[ticket("REFUNDED")], {}, "no_current_year_orders"],
    [[ticket("VOID"), ticket("ISSUED", "Parking")], {}, "no_current_year_orders"]
  ]) {
    const page = emailPage({ "12345678": rows }, options);
    const result = await page.send(request());
    assert.equal(result.stopCode, stopCode);
    assert.equal(result.status, "blocked");
    assert.equal(page.sent.length, 0);
    assert.equal(result.replyText, undefined);
  }
});
