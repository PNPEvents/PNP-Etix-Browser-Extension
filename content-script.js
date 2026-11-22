(function initialiseEtixContentScript() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    Promise.resolve(handleMessage(message)).then(sendResponse).catch((error) => {
      sendResponse({
        status: "failed",
        reason: error.message || "Unexpected page automation error.",
        stopCode: "page_error"
      });
    });
    return true;
  });

  async function handleMessage(message) {
    if (message.type === "INSPECT_PAGE") return inspectPage();
    if (message.type === "PREVIEW_CARER_DISCOUNT") return previewWorkflow(message.payload);
    if (message.type === "APPLY_CARER_DISCOUNT") return applyWorkflow(message.payload);
    if (message.type === "RUN_ETIX_RECLASS_STEP") return runEtixReclassStep(message.payload);
    if (message.type === "RUN_ETIX_EMAIL_STEP") return runEtixEmailStep(message.payload);
    if (message.type === "RUN_ETIX_PARKING_STEP") return runEtixParkingStep(message.payload);
    return { status: "failed", reason: "Unknown page request." };
  }

  function inspectPage() {
    const tables = inspectTables();
    const controls = Array.from(document.querySelectorAll(
      "button, input, select, textarea, a[href], [role='button'], [role='link'], [role='tab']"
    )).slice(0, 300).map((element, index) => describeElement(element, index));

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
      .slice(0, 50)
      .map((element) => EtixCore.redactText(element.textContent).slice(0, 160))
      .filter(Boolean);

    return {
      ok: true,
      inspection: {
        schemaVersion: 2,
        capturedAt: new Date().toISOString(),
        page: {
          origin: location.origin,
          pathname: redactPathname(location.pathname),
          title: EtixCore.redactText(document.title).slice(0, 160),
          workflowStage: detectWorkflowStage()
        },
        headings,
        controls,
        tables,
        counts: {
          forms: document.forms.length,
          controls: controls.length,
          frames: document.querySelectorAll("iframe").length,
          tables: tables.length
        },
        privacy: {
          inputValuesIncluded: false,
          queryStringIncluded: false,
          pageBodyIncluded: false,
          knownCustomerColumnsRedacted: true,
          reviewBeforeSharing: true
        }
      }
    };
  }

  function describeElement(element, index) {
    const label = findLabel(element);
    const text = element.matches("input, textarea, select")
      ? ""
      : EtixCore.redactText(element.textContent).slice(0, 160);
    return {
      index,
      tag: element.tagName.toLowerCase(),
      type: safeAttribute(element, "type"),
      role: safeAttribute(element, "role"),
      id: redactAttribute(element, "id"),
      name: redactAttribute(element, "name"),
      ariaLabel: redactAttribute(element, "aria-label"),
      placeholder: redactAttribute(element, "placeholder"),
      label: EtixCore.redactText(label).slice(0, 160),
      text,
      buttonValue: safeButtonValue(element),
      checked: element.matches("input[type='checkbox'], input[type='radio']")
        ? Boolean(element.checked)
        : null,
      selectedOption: element.matches("select")
        ? EtixCore.redactText(element.selectedOptions[0] && element.selectedOptions[0].textContent).slice(0, 160)
        : "",
      options: element.matches("select")
        ? Array.from(element.options).slice(0, 100).map((option) =>
          EtixCore.redactText(option.textContent).slice(0, 160)
        )
        : [],
      tablePosition: tablePosition(element),
      selectorHint: selectorHint(element),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true")
    };
  }

  function inspectTables() {
    return Array.from(document.querySelectorAll("table")).slice(0, 30).map((table, tableIndex) => {
      const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"));
      const headerRow = rows.find((row) => row.querySelector("th"));
      const headers = headerRow
        ? Array.from(headerRow.children).map((cell) => sanitizeCell(cell.textContent))
        : [];
      const dataRows = rows.filter((row) => row !== headerRow && row.querySelector("td"));
      return {
        tableIndex,
        id: redactValue(table.id),
        headers,
        rows: dataRows.slice(0, 100).map((row, rowIndex) => ({
          rowIndex,
          cells: Array.from(row.children).slice(0, 30).map((cell, cellIndex) => {
            const header = headers[cellIndex] || "";
            return isSensitiveColumn(header)
              ? "[REDACTED FIELD]"
              : sanitizeCell(cell.textContent);
          })
        }))
      };
    }).filter((table) => table.headers.length || table.rows.length);
  }

  function sanitizeCell(value) {
    return EtixCore.redactText(value).slice(0, 260);
  }

  function isSensitiveColumn(header) {
    return /customer|first name|last name|address|postal|zip|email|phone|billing|shipping/i.test(header);
  }

  function tablePosition(element) {
    const table = element.closest("table");
    const row = element.closest("tr");
    if (!table || !row) return null;
    const tables = Array.from(document.querySelectorAll("table"));
    const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"))
      .filter((candidate) => candidate.querySelector("td"));
    return { tableIndex: tables.indexOf(table), rowIndex: rows.indexOf(row) };
  }

  function safeButtonValue(element) {
    if (!element.matches("input[type='submit'], input[type='button'], input[type='reset']")) return "";
    return EtixCore.redactText(element.value).slice(0, 120);
  }

  function redactValue(value) {
    return EtixCore.redactText(value).slice(0, 160);
  }

  function detectWorkflowStage() {
    const path = location.pathname;
    if (path.includes("/searchOrder/")) return "order_search_results";
    if (path.endsWith("/orderDetails.vw")) {
      return document.body && /reclassed/i.test(document.body.innerText)
        ? "order_details_after_reclass"
        : "order_details";
    }
    if (path.endsWith("/exchange/exchanges.vw")) return "change_price_code";
    if (path.endsWith("/singleExchange.vw")) return "exchange_review";
    return "unknown";
  }

  function previewWorkflow(payload) {
    const profileCheck = EtixCore.validateWorkflowProfile(payload.workflowProfile);
    if (profileCheck.ok && profileCheck.value.workflowKind === "etix_carer_reclass") {
      return previewEtixReclass(payload, profileCheck.value);
    }
    const orderNumber = payload.orderNumber;
    const pageText = document.body ? document.body.innerText : "";
    const orderVisible = pageText.includes(orderNumber) || findOrderEvidence(orderNumber, payload.workflowProfile);

    if (!orderVisible) {
      return {
        status: "blocked",
        reason: "The requested order number is not visible on this page. Open that order in Etix first.",
        stopCode: "order_not_visible",
        page: safePageSummary()
      };
    }

    const candidates = profileCheck.ok
      ? candidatesFromProfile(payload.workflowProfile)
      : discoverCandidateControls(payload.aliases);
    const match = EtixCore.chooseTicketCandidate(candidates, payload.aliases);

    if (match.status !== "matched") {
      return {
        status: match.status,
        reason: match.reason,
        stopCode: match.status === "needs_input" ? "ambiguous_ticket" : "ticket_not_found",
        candidates: match.ranked.slice(0, 10).map(publicCandidate),
        calibratedProfile: profileCheck.ok,
        page: safePageSummary()
      };
    }

    return {
      status: "ready",
      reason: profileCheck.ok
        ? "A calibrated workflow found one carer-ticket match."
        : "A likely carer-related control was found, but the page is not calibrated for live actions.",
      stopCode: profileCheck.ok ? null : "calibration_required",
      orderNumber: maskIdentifier(orderNumber),
      quantity: payload.quantity,
      selectedTicket: publicCandidate(match.candidate),
      candidates: match.ranked.slice(0, 10).map(publicCandidate),
      calibratedProfile: profileCheck.ok,
      page: safePageSummary()
    };
  }

  function parkingStop(reason, stopCode = "parking_page_changed", status = "blocked") {
    return { status, reason, stopCode };
  }

  function parkingNext(parkingPhase, reason, patch = {}) {
    return { status: "continue", stage: parkingPhase, reason, contextPatch: { parkingPhase, parkingWaits: 0, ...patch } };
  }

  function parkingWait(context, reason) {
    const waits = Number(context.parkingWaits || 0);
    return waits >= 12
      ? parkingStop(`${reason} Check Etix before retrying.`, "parking_update_timeout", "failed")
      : { status: "navigating", stage: context.parkingPhase, reason, contextPatch: { parkingWaits: waits + 1 } };
  }

  function readParkingOrder() {
    const table = findTableByHeader("Serial #");
    if (!table) return [];
    const model = modelTable(table);
    if (["Status", "Date", "Performance", "Venue", "Price Code"].some((header) => !model.headers.includes(header))) return [];
    return model.rows.map((row) => Object.fromEntries([
      ["status", "Status"], ["date", "Date"], ["performance", "Performance"], ["venue", "Venue"], ["priceCode", "Price Code"]
    ].map(([key, header]) => [key, cleanText(row.cells[model.headers.indexOf(header)])])));
  }

  function parkingSelected(select) {
    return select && cleanText(select.selectedOptions[0] && select.selectedOptions[0].textContent);
  }

  function parkingSaleMatches(context) {
    return parkingSelected(document.getElementById("singlePage:venueSelect")) === context.parkingVenue &&
      parkingSelected(document.getElementById("singlePage:switchEventSelect")) === context.parkingPerformance;
  }

  function parkingQuantityControl(type) {
    const controls = Array.from(document.querySelectorAll("input[type='number']")).filter((input) =>
      isVisible(input) && EtixCore.normalizeText(findLabel(input)) === EtixCore.normalizeText(type.label));
    return controls.length === 1 ? controls[0] : null;
  }

  function parkingCart() {
    const table = Array.from(document.querySelectorAll("table")).find((candidate) =>
      modelTable(candidate).headers.includes("Name") && modelTable(candidate).headers.includes("Price Code"));
    if (!table) return [];
    const model = modelTable(table);
    return model.rows.filter((row) => row.cells.length >= model.headers.length).map((row) => {
      const price = parkingSelected(row.element.querySelector("select[id^='singlePage:shoppingCart:']"));
      const type = EtixCore.PARKING_TYPES.find((item) => item.label === price);
      const money = cleanText(row.cells[model.headers.indexOf("Total")]).match(/^£\s*([\d,]+\.\d{2})$/);
      return { type: type && type.key, name: cleanText(row.cells[model.headers.indexOf("Name")]), total: money ? Number(money[1].replace(/,/g, "")) : null };
    });
  }

  function validateParkingCart(payload, context) {
    const rows = parkingCart();
    // Every cart row must be represented, including any row lacking a price-code dropdown.
    const table = findTableByHeader("Name");
    const cartRows = table ? modelTable(table).rows.filter((row) => row.element.querySelector("[id*='shoppingCart']")) : [];
    if (rows.length !== payload.quantity || rows.length !== cartRows.length || rows.some((row) =>
      !row.type || row.name !== context.parkingPerformance || row.total === null)) return null;
    if (EtixCore.PARKING_TYPES.some((type) => rows.filter((row) => row.type === type.key).length !== payload.quantities[type.key])) return null;
    return { rows, total: Math.round(rows.reduce((sum, row) => sum + row.total, 0) * 100) / 100 };
  }

  function parkingCashRadio() {
    return Array.from(document.getElementsByName("singlePage:paymentMethod"))
      .find((input) => input.type === "radio" && /^cash$/i.test(cleanText(findLabel(input))) && isVisible(input));
  }

  function parkingTenderInput() {
    const inputs = [document.getElementById("singlePage:processorFeeOnCash"), document.getElementById("singlePage:cash_tender")]
      .filter((input) => input && !input.disabled && isVisible(input));
    const labelled = inputs.filter((input) => /^cash tender$/i.test(cleanText(findLabel(input))));
    return labelled.length === 1 ? labelled[0] : inputs.length === 1 ? inputs[0] : null;
  }

  function parkingAutomaticEmail() {
    return Array.from(document.getElementsByName("singlePage:j_idt900"))
      .find((input) => input.type === "checkbox" && /send confirmation email/i.test(findLabel(input)));
  }

  function parkingRegistrationFields(quantity) {
    const submit = document.getElementById("singlePage:collectMiscBtn");
    if (!submit || !isVisible(submit) || submit.disabled) return null;
    const fields = Array.from(document.querySelectorAll("input[type='text']")).filter((input) =>
      isVisible(input) && !input.disabled && /^singlePage:j_idt1236:\d+:j_idt1281:j_idt1282:\d+:j_idt1285:1:j_idt1293$/.test(input.id));
    if (fields.length !== quantity) return null;
    const groups = new Set(fields.map((input) => input.id.match(/j_idt1236:(\d+):/)[1]));
    if (groups.size !== 1) return null;
    fields.sort((left, right) => Number(left.id.match(/j_idt1282:(\d+):/)[1]) - Number(right.id.match(/j_idt1282:(\d+):/)[1]));
    if (fields.some((input, index) => Number(input.id.match(/j_idt1282:(\d+):/)[1]) !== index)) return null;
    return { fields, submit };
  }

  function parkingPlatesInCartOrder(payload, context) {
    const offsets = { parking: 0, disabled: 0, comp: 0 };
    return context.cartTypes.map((type) => payload.registrations[type][offsets[type]++]);
  }

  function parkingCompletedResult(payload, context) {
    return {
      status: "completed", reason: `Added and verified ${payload.quantity} parking space(s) on the requested booking.`,
      orderNumber: maskIdentifier(payload.orderNumber), quantity: payload.quantity,
      parkingVenue: context.parkingVenue, parkingDate: context.target.date,
      paymentMethod: "Cash", parkingTotal: context.parkingTotal
    };
  }

  async function runEtixParkingStep(payload) {
    if (location.hostname !== "boxoffice.etix.com") return parkingStop("Add Parking requires boxoffice.etix.com.", "parking_host_required");
    const checked = EtixCore.validateParkingRequest(payload, payload.mode === "apply");
    if (!checked.ok) return parkingStop(checked.error, "invalid_parking_input");
    payload = { ...payload, ...checked.value };
    const context = payload.context || {};
    const phase = context.parkingPhase;
    const stage = detectWorkflowStage();
    const onOrder = stage === "order_details" || stage === "order_details_after_reclass";

    if (!context.target) {
      const route = routeToRequestedOrder(payload, stage);
      if (route) return route;
      const summary = EtixCore.parkingOrderTarget(readParkingOrder());
      if (summary.status !== "matched") return summary;
      if (payload.mode === "preview") return {
        status: "ready", reason: `Ready to match ${payload.quantity} parking space(s) to this booking’s venue and date.`,
        orderNumber: maskIdentifier(payload.orderNumber), quantity: payload.quantity,
        ticketVenue: summary.target.venue, parkingDate: summary.target.date, paymentMethod: "Cash"
      };
      return parkingNext("open_parking_sale", "Opening Add Tickets for the verified booking.", {
        target: summary.target, initialCounts: summary.counts,
        initialExperienceCount: summary.experienceCount, initialTicketCount: summary.ticketCount
      });
    }

    if (onOrder) {
      if (readBookingNumber() !== payload.orderNumber) return parkingStop("The open booking changed during Add Parking.", "order_mismatch");
      if (phase === "open_parking_sale") {
        const summary = EtixCore.parkingOrderTarget(readParkingOrder());
        if (summary.status !== "matched" || JSON.stringify(summary.target) !== JSON.stringify(context.target) ||
            summary.ticketCount !== context.initialTicketCount) return parkingStop("The booking’s tickets changed before Add Tickets opened.");
        const add = document.getElementById("orderDetails:j_idt76");
        if (!add || cleanText(add.textContent) !== "Add Tickets") return parkingStop("Add Tickets is unavailable for this booking.", "add_tickets_missing");
        add.click();
        return parkingNext("select_parking_venue", "Selecting the matching parking venue.");
      }
      if (["verify_parking", "send_parking_confirmation"].includes(phase)) {
        const summary = EtixCore.parkingOrderTarget(readParkingOrder());
        const correct = summary.status === "matched" && JSON.stringify(summary.target) === JSON.stringify(context.target) &&
          summary.experienceCount === context.initialExperienceCount && summary.ticketCount === context.initialTicketCount + payload.quantity &&
          EtixCore.PARKING_TYPES.every((type) => summary.counts[type.key] === context.initialCounts[type.key] + payload.quantities[type.key]);
        if (!correct || !context.registrationSubmitted) return parkingStop("The updated parking ticket counts could not be verified. Check the booking before retrying.", "parking_verification_failed", "failed");
        const result = parkingCompletedResult(payload, context);
        if (!payload.sendConfirmation) return result;
        if (phase === "verify_parking") return parkingNext("send_parking_confirmation", "Parking is verified. Sending the updated order confirmation.", { confirmationAttempted: true });
        const resend = Array.from(document.querySelectorAll("a")).find((anchor) => EtixCore.normalizeText(anchor.textContent) === "resend email");
        const recipient = document.querySelector("a[href^='mailto:']");
        if (!resend || !recipient) return { ...result, reason: `${result.reason} The confirmation could not be sent because Etix did not expose an email recipient or Resend Email action.`, emailSendInvoked: false };
        const deliveryVerified = await invokeResendEmailOnce(resend);
        return { ...result, reason: `${result.reason} Etix’s updated confirmation was invoked once.${deliveryVerified ? " Etix displayed confirmation." : " Delivery was not independently verified."}`, emailSendInvoked: true, deliveryVerified };
      }
      return parkingWait(context, "Waiting for the Add Tickets page.");
    }

    if (!location.pathname.endsWith("/singlePage.vw")) return parkingStop("Etix left the expected Add Tickets workflow.");
    const adding = document.getElementById("singlePage:addingTickets");
    if (!adding || !/^(true|1)$/i.test(adding.value)) return parkingStop("Etix is not adding tickets to the existing booking.", "parking_existing_order_required");

    if (phase === "select_parking_venue") {
      if (parkingCart().length) return parkingStop("The Add Tickets cart already contains tickets. Review it in Etix before continuing.", "parking_cart_not_empty");
      const venue = document.getElementById("singlePage:venueSelect");
      if (!venue || venue.disabled) return parkingWait(context, "Waiting for the venue selector.");
      const match = EtixCore.chooseParkingOption(Array.from(venue.options).filter((option) => !option.disabled).map((option) => cleanText(option.textContent)),
        (name) => EtixCore.parkingVenueMatches(context.target.venue, name), "parking venue");
      if (match.status !== "matched") return match;
      if (parkingSelected(venue) !== match.value) setInputValue(venue, Array.from(venue.options).find((option) => cleanText(option.textContent) === match.value).value);
      return parkingNext("select_parking_performance", "Matching the parking performance to the ticket date.", { parkingVenue: match.value });
    }

    if (phase === "select_parking_performance") {
      const venue = document.getElementById("singlePage:venueSelect");
      const performance = document.getElementById("singlePage:switchEventSelect");
      if (parkingSelected(venue) !== context.parkingVenue || !performance || performance.disabled) return parkingWait(context, "Waiting for parking performances to load.");
      const names = Array.from(performance.options).filter((option) => !option.disabled).map((option) => cleanText(option.textContent));
      if (!names.some((name) => /parking/i.test(name))) return parkingWait(context, "Waiting for parking performances to load.");
      const match = EtixCore.chooseParkingOption(names, (name) => EtixCore.parkingVenueMatches(context.target.venue, name) && EtixCore.parkingDateKey(name) === context.target.date, "parking performance on the ticket date");
      if (match.status !== "matched") return match;
      if (parkingSelected(performance) !== match.value) setInputValue(performance, Array.from(performance.options).find((option) => cleanText(option.textContent) === match.value).value);
      return parkingNext("configure_parking_quantities", "Setting the requested parking quantities.", { parkingPerformance: match.value });
    }

    if (phase !== "verify_parking" && !parkingSaleMatches(context)) {
      if (phase === "configure_parking_quantities") return parkingWait(context, "Waiting for the selected parking performance.");
      return parkingStop("The parking venue or performance changed during the workflow.", "parking_selection_changed");
    }
    if (phase === "configure_parking_quantities") {
      const bestAvailable = Array.from(document.getElementsByName("singlePage:sellMethodBtnGroup"))
        .find((input) => /^best available$/i.test(cleanText(findLabel(input))) && isVisible(input));
      if (bestAvailable && !bestAvailable.checked) {
        bestAvailable.click();
        return parkingWait(context, "Waiting for Best Available parking quantities.");
      }
      for (const type of EtixCore.PARKING_TYPES) {
        const input = parkingQuantityControl(type);
        if (!input && payload.quantities[type.key] === 0) continue;
        if (!input || input.disabled) return parkingWait(context, `Waiting for the ${type.label} quantity control.`);
        if (Number(input.value) !== payload.quantities[type.key]) {
          setInputValue(input, String(payload.quantities[type.key]));
          await pause(350);
          const retained = await waitForCondition(() => {
            const current = parkingQuantityControl(type);
            return current && Number(current.value) === payload.quantities[type.key];
          }, 3000);
          if (!retained) return parkingStop(`Etix did not retain the ${type.label} quantity.`);
        }
      }
      return parkingNext("add_parking_seats", "Adding the selected parking spaces to the cart.");
    }

    if (phase === "add_parking_seats") {
      if (parkingCart().length) return parkingStop("The cart changed before Add Seats.", "parking_cart_not_empty");
      if (EtixCore.PARKING_TYPES.some((type) => {
        const input = parkingQuantityControl(type);
        return input ? Number(input.value) !== payload.quantities[type.key] : payload.quantities[type.key] !== 0;
      })) return parkingStop("The parking quantities changed before Add Seats.");
      const add = document.getElementById("singlePage:addSeats");
      if (!add || add.disabled) return parkingWait(context, "Waiting for Add Seats to become available.");
      add.click();
      return parkingNext("select_parking_cash", "Checking the cart before selecting Cash payment.");
    }

    if (phase === "select_parking_cash") {
      if (!parkingCart().length) return parkingWait(context, "Waiting for the parking cart.");
      const cart = validateParkingCart(payload, context);
      if (!cart) return parkingStop("The cart does not exactly match the requested parking types, quantities and date.", "parking_cart_mismatch");
      const cash = parkingCashRadio();
      if (!cash || cash.disabled) return parkingStop("Cash payment is unavailable.", "parking_cash_unavailable");
      if (!cash.checked) cash.click();
      return parkingNext("prepare_parking_purchase", "Preparing Cash payment for the checked parking cart.", { cartTypes: cart.rows.map((row) => row.type), parkingTotal: cart.total });
    }

    if (phase === "prepare_parking_purchase" || phase === "purchase_parking") {
      const cart = validateParkingCart(payload, context);
      if (!cart || cart.total !== context.parkingTotal || JSON.stringify(cart.rows.map((row) => row.type)) !== JSON.stringify(context.cartTypes)) return parkingStop("The parking cart or amount changed before purchase.", "parking_cart_mismatch");
      const cash = parkingCashRadio();
      if (!cash || !cash.checked) return parkingStop("Cash payment is no longer selected.", "parking_payment_changed");
      const totalInput = document.getElementById("singlePage:totalOrderPrice");
      const total = totalInput && Number(String(totalInput.value).replace(/[£,\s]/g, ""));
      if (!totalInput || !String(totalInput.value).trim() || !Number.isFinite(total) || Math.abs(total - cart.total) > 0.001) return parkingStop("Etix’s purchase total does not match the checked parking cart.", "parking_total_mismatch");
      const tender = parkingTenderInput();
      if (cart.total > 0 && !tender) return parkingStop("The Cash Tender field is unavailable.", "parking_cash_tender_missing");
      if (phase === "prepare_parking_purchase") {
        const automaticEmail = parkingAutomaticEmail();
        if (automaticEmail && automaticEmail.checked) automaticEmail.click();
        if (tender) setInputValue(tender, cart.total.toFixed(2));
        // This checkpoint is saved before Purchase can submit anything.
        return parkingNext("purchase_parking", "Purchasing the checked parking spaces using Cash.", { purchaseAttempted: true });
      }
      if (parkingAutomaticEmail() && parkingAutomaticEmail().checked) return parkingStop("Etix’s automatic confirmation is selected. Confirmation must wait until parking is verified.", "parking_automatic_email_selected");
      if (tender && Number(tender.value) !== cart.total) return parkingStop("The Cash Tender amount changed.", "parking_cash_tender_changed");
      const purchase = Array.from(document.querySelectorAll("input[type='submit']")).filter((input) => input.value === "Purchase" && isVisible(input) && !input.disabled);
      if (purchase.length !== 1) return parkingStop("The exact Purchase control is unavailable.", "parking_purchase_missing");
      purchase[0].click();
      return parkingNext("fill_parking_registrations", "Waiting for Etix’s registration plate popup.");
    }

    if (phase === "fill_parking_registrations" || phase === "submit_parking_registrations") {
      const modal = parkingRegistrationFields(payload.quantity);
      if (!modal) return parkingWait(context, "Waiting for one registration field per parking ticket in Etix’s popup.");
      const plates = parkingPlatesInCartOrder(payload, context);
      if (phase === "fill_parking_registrations") {
        modal.fields.forEach((input, index) => setInputValue(input, plates[index]));
        return parkingNext("submit_parking_registrations", "Submitting the registration plates in parking-ticket order.");
      }
      if (modal.fields.some((input, index) => input.value !== plates[index])) return parkingStop("A registration plate changed before submission.", "parking_registration_changed");
      modal.submit.click();
      return parkingNext("verify_parking", "Verifying the updated booking’s parking tickets.", { registrationSubmitted: true });
    }

    if (phase === "verify_parking") {
      const popup = document.getElementById("singlePage:collectMiscBtn");
      if (popup && isVisible(popup)) return parkingWait(context, "Waiting for Etix to accept the registration plates.");
      const link = Array.from(document.querySelectorAll("a[href]")).find((anchor) => cleanText(anchor.textContent) === payload.orderNumber && isVisible(anchor));
      if (!link) return parkingWait(context, "Waiting for the completed booking link.");
      link.click();
      return parkingWait(context, "Opening the updated booking to verify parking.");
    }
    return parkingStop("The parking workflow reached an unexpected step.");
  }

  function previewEtixReclass(payload, profile) {
    if (location.hostname !== "boxoffice.etix.com" || !location.pathname.endsWith("/orderDetails.vw")) {
      return {
        status: "blocked",
        reason: "Open the requested order's Order Details page on boxoffice.etix.com.",
        stopCode: "order_page_required",
        page: safePageSummary()
      };
    }
    if (readBookingNumber() !== payload.orderNumber) {
      return {
        status: "blocked",
        reason: "The requested order number is not visible on this Order Details page.",
        stopCode: "order_mismatch",
        page: safePageSummary()
      };
    }
    const summary = summarizeOrderTickets(profile);
    if (!summary.ok) return summary;
    if (summary.eligible.length < payload.quantity) {
      return {
        status: "blocked",
        reason: `Only ${summary.eligible.length} eligible standard adult ticket(s) are available; ${payload.quantity} requested.`,
        stopCode: "insufficient_eligible_tickets",
        eligibleTickets: summary.eligible.length,
        existingCarerTickets: summary.targetCount
      };
    }
    return {
      status: "ready",
      reason: `${payload.quantity} standard adult ticket(s) can be changed to ${profile.targetSuffix}.`,
      orderNumber: maskIdentifier(payload.orderNumber),
      quantity: payload.quantity,
      eligibleTickets: summary.eligible.length,
      existingCarerTickets: summary.targetCount,
      expectedCarerTickets: summary.targetCount + payload.quantity,
      targetPriceCodes: summary.eligible.slice(0, payload.quantity)
        .map((ticket) => `${ticket.priceCode} ${profile.targetSuffix}`)
    };
  }

  async function runEtixReclassStep(payload) {
    const profileCheck = EtixCore.validateWorkflowProfile(payload.workflowProfile);
    if (!profileCheck.ok || profileCheck.value.workflowKind !== "etix_carer_reclass") {
      return { status: "blocked", reason: profileCheck.error || "Unsupported workflow.", stopCode: "profile_invalid" };
    }
    const profile = profileCheck.value;
    if (!profile.hosts.includes(location.hostname)) {
      return { status: "blocked", reason: "This Etix host is not approved for the carer workflow.", stopCode: "host_not_approved" };
    }

    const unfinishedRecovery = recoverUnfinishedExchange(payload);
    if (unfinishedRecovery) return unfinishedRecovery;

    const stage = detectWorkflowStage();
    const workflowStarted = payload.context && payload.context.expectedFinalTargetCount !== undefined;
    if (!workflowStarted) {
      const routing = routeToRequestedOrder(payload, stage);
      if (routing) return routing;
    }
    if (stage === "order_details" || stage === "order_details_after_reclass") {
      if (payload.mode === "preview" && !(payload.context && payload.context.exchangeSubmitted)) {
        return previewEtixReclass(payload, profile);
      }
      return payload.context && payload.context.exchangeSubmitted
        ? verifyEtixReclass(payload, profile)
        : startEtixReclass(payload, profile);
    }
    if (stage === "change_price_code") return configureEtixReclass(payload, profile);
    if (stage === "exchange_review") return submitEtixExchange(payload, profile);
    return {
      status: "blocked",
      reason: "The workflow reached an unrecognised Etix page. No further action was taken.",
      stopCode: "unexpected_page",
      stage
    };
  }

  async function runEtixEmailStep(payload) {
    if (location.hostname !== "boxoffice.etix.com") {
      return {
        status: "blocked",
        reason: "Order confirmation email is only calibrated for boxoffice.etix.com.",
        stopCode: "host_not_approved"
      };
    }
    const unfinishedRecovery = recoverUnfinishedExchange(payload);
    if (unfinishedRecovery) return unfinishedRecovery;

    const stage = detectWorkflowStage();
    const searchStarted = Boolean(payload.context && payload.context.searchStarted);
    if (payload.lookupType === "order") {
      const routing = routeToRequestedOrder({
        ...payload,
        orderNumber: payload.lookupValue
      }, stage);
      if (routing) return routing;
    }
    if (!searchStarted && payload.lookupType === "email") {
      return startEmailLookup(payload);
    }
    if (stage === "order_search_results") return handleEmailSearchResults(payload);
    if (stage !== "order_details" && stage !== "order_details_after_reclass") {
      return startEmailLookup(payload);
    }

    const bookingNumber = readBookingNumber();
    if (!bookingNumber) {
      return { status: "blocked", reason: "The booking number could not be read from Order Details.", stopCode: "booking_number_missing" };
    }
    const queue = Array.isArray(payload.context && payload.context.orderQueue)
      ? payload.context.orderQueue
      : [bookingNumber];
    const queueIndex = Number(payload.context && payload.context.queueIndex || 0);
    const expectedBooking = queue[queueIndex];
    if ((expectedBooking && expectedBooking !== bookingNumber) ||
        (payload.lookupType === "order" && bookingNumber !== payload.lookupValue)) {
      return {
        status: "blocked",
        reason: "The opened Order Details page does not match the booking selected for this email workflow.",
        stopCode: "order_mismatch"
      };
    }
    const recentlySent = payload.mode === "apply" &&
      Array.isArray(payload.context && payload.context.recentSentBookingNumbers) &&
      payload.context.recentSentBookingNumbers.includes(bookingNumber);
    if (recentlySent) {
      const processed = Array.isArray(payload.context && payload.context.processedBookings)
        ? payload.context.processedBookings
        : [];
      const next = advanceEmailQueue(payload, queue, queueIndex, processed, {
        skippedRecentlySent: [
          ...(payload.context && payload.context.skippedRecentlySent || []),
          bookingNumber
        ]
      }, "Skipping a booking whose confirmation was sent within the last 10 minutes.");
      return next || (processed.length
        ? finalizeEmailWorkflow(payload, processed)
        : {
          status: "blocked",
          reason: "All matching bookings were already emailed within the last 10 minutes.",
          stopCode: "duplicate_email_guard"
        });
    }

    const ticketTable = findTableByHeader("Price Code");
    const ticketModel = ticketTable && modelTable(ticketTable);
    const statusIndex = ticketModel ? ticketModel.headers.indexOf("Status") : -1;
    if (statusIndex < 0 || !ticketModel.rows.length) {
      return {
        status: "blocked",
        reason: "Ticket statuses could not be read. No confirmation email was sent.",
        stopCode: "ticket_status_missing",
        emailSendInvoked: false
      };
    }
    if (ticketModel.rows.every((row) => /^VOID(?:ED)?$/i.test(cleanText(row.cells[statusIndex])))) {
      const processed = payload.context && payload.context.processedBookings || [];
      const skippedVoidBookingNumbers = [
        ...(payload.context && payload.context.skippedVoidBookingNumbers || []),
        bookingNumber
      ];
      const patch = { skippedVoidBookingNumbers };
      const next = advanceEmailQueue(payload, queue, queueIndex, processed, patch,
        "Skipping a booking because all its tickets are void. No confirmation was sent for it.");
      return next || finalizeEmailWorkflow(payload, processed, patch);
    }

    const currentYear = new Date().getFullYear();
    const attendance = extractExperienceAttendance(currentYear);
    if (!attendance.length) {
      const processed = Array.isArray(payload.context && payload.context.processedBookings)
        ? payload.context.processedBookings
        : [];
      const next = advanceEmailQueue(payload, queue, queueIndex, processed, {
        skippedBookingNumbers: [
          ...(payload.context && payload.context.skippedBookingNumbers || []),
          bookingNumber
        ]
      }, "Skipping an order with no experiences this year.");
      return next || finalizeEmailWorkflow(payload, processed);
    }

    const resendEmail = Array.from(document.querySelectorAll("a"))
      .find((anchor) => EtixCore.normalizeText(anchor.textContent) === "resend email");
    if (!resendEmail) {
      return {
        status: "blocked",
        reason: "The Resend Email action is unavailable for this order.",
        stopCode: "resend_email_unavailable"
      };
    }
    let deliveryVerified = null;
    if (payload.mode === "apply") {
      const recipientPresent = Boolean(document.querySelector("a[href^='mailto:']")) ||
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(document.body.innerText);
      if (!recipientPresent) {
        return {
          status: "blocked",
          reason: "No customer email address is visible on this Order Details page.",
          stopCode: "recipient_email_missing"
        };
      }
      deliveryVerified = await invokeResendEmailOnce(resendEmail);
    }

    const processed = [
      ...(payload.context && payload.context.processedBookings || []),
      {
        bookingNumber,
        attendance,
        emailActionAvailable: true,
        emailSendInvoked: payload.mode === "apply",
        deliveryVerified
      }
    ];
    const next = advanceEmailQueue(
      payload,
      queue,
      queueIndex,
      processed,
      {},
      payload.mode === "apply" ? "Moving to the next current-year booking." : "Previewing the next current-year booking."
    );
    if (next) return next;

    return finalizeEmailWorkflow(payload, processed);
  }

  function finalizeEmailWorkflow(payload, processed, extraPatch = {}) {
    const skippedVoidBookingNumbers = extraPatch.skippedVoidBookingNumbers ||
      payload.context && payload.context.skippedVoidBookingNumbers || [];
    if (!processed.length) {
      return {
        status: "blocked",
        reason: skippedVoidBookingNumbers.length
          ? "No confirmation email was sent. Bookings with all tickets void were skipped; no eligible bookings remain."
          : `No bookings containing issued ${new Date().getFullYear()} experiences were available to email.`,
        stopCode: skippedVoidBookingNumbers.length ? "all_tickets_void" : "no_current_year_orders",
        skippedVoidBookingNumbers,
        emailSendInvoked: false
      };
    }
    const bookingNumbers = processed.map((booking) => booking.bookingNumber);
    const allVerified = payload.mode === "apply" && processed.every((booking) => booking.deliveryVerified === true);
    return {
      status: payload.mode === "apply" ? "completed" : "ready",
      reason: payload.mode === "apply"
        ? `Etix invoked Resend Email once for ${processed.length} current-year booking(s).${allVerified ? " Transient confirmation was observed for every send." : " Etix did not expose confirmation for every send."}${skippedVoidBookingNumbers.length ? ` Skipped ${skippedVoidBookingNumbers.length} booking(s) with all tickets void.` : ""}`
        : `Found ${processed.length} current-year booking(s) with confirmation email actions available.${skippedVoidBookingNumbers.length ? ` Skipped ${skippedVoidBookingNumbers.length} booking(s) with all tickets void.` : ""}`,
      orderNumber: bookingNumbers.length === 1 ? maskIdentifier(bookingNumbers[0]) : null,
      bookingNumbers,
      bookings: processed,
      skippedVoidBookingNumbers,
      emailActionAvailable: true,
      emailSendInvoked: payload.mode === "apply",
      deliveryVerified: payload.mode === "apply" ? allVerified : undefined,
      replyText: payload.mode === "apply" ? formatCustomerReply(processed) : null,
      verifiedAt: allVerified ? new Date().toISOString() : null
    };
  }

  function startEmailLookup(payload) {
    const searchInput = document.querySelector("input[name='order_id']");
    const searchButton = document.getElementById("top-nav-order-search-submit-button");
    if (!searchInput || !searchButton || searchButton.disabled) {
      return {
        status: "blocked",
        reason: "The Etix order-search controls are unavailable on this page.",
        stopCode: "order_search_unavailable"
      };
    }
    setInputValue(searchInput, payload.lookupValue);
    searchButton.click();
    return {
      status: "navigating",
      stage: "searching_for_email_or_order",
      reason: payload.lookupType === "email"
        ? "Searching Etix for current-year bookings under this email address."
        : "Searching Etix for the requested booking number.",
      contextPatch: { searchStarted: true, searchYear: new Date().getFullYear() }
    };
  }

  function handleEmailSearchResults(payload) {
    if (Array.isArray(payload.context && payload.context.orderQueue)) {
      const queue = payload.context.orderQueue;
      const index = Number(payload.context.queueIndex || 0);
      return openExactSearchResult(queue[index], {
        orderQueue: queue,
        queueIndex: index
      });
    }
    if (payload.lookupType === "order") return openExactSearchResult(payload.lookupValue, {});

    const year = Number(payload.context && payload.context.searchYear || new Date().getFullYear());
    const orderNumbers = currentYearOrderNumbersFromResults(year);
    const recent = payload.mode === "apply" && Array.isArray(payload.context && payload.context.recentSentBookingNumbers)
      ? payload.context.recentSentBookingNumbers
      : [];
    const eligibleOrderNumbers = orderNumbers.filter((bookingNumber) => !recent.includes(bookingNumber));
    if (!orderNumbers.length) {
      dismissOrderSearchNotice();
      return {
        status: "blocked",
        reason: `No bookings containing ${year} experiences were found for this email address.`,
        stopCode: "no_current_year_orders"
      };
    }
    if (!eligibleOrderNumbers.length) {
      return {
        status: "blocked",
        reason: "All matching current-year bookings were already emailed within the last 10 minutes.",
        stopCode: "duplicate_email_guard"
      };
    }
    return openExactSearchResult(eligibleOrderNumbers[0], {
      orderQueue: eligibleOrderNumbers,
      queueIndex: 0,
      processedBookings: [],
      searchYear: year
    });
  }

  function openExactSearchResult(bookingNumber, contextPatch) {
    const links = Array.from(document.querySelectorAll("a[href]"))
      .filter((anchor) => cleanText(anchor.textContent) === bookingNumber && isVisible(anchor));
    if (!links.length) {
      dismissOrderSearchNotice();
      return {
        status: "blocked",
        reason: `Etix search results did not contain booking ${bookingNumber}.`,
        stopCode: "order_not_found"
      };
    }
    links[0].click();
    return {
      status: "navigating",
      stage: "opening_email_order_details",
      reason: `Opening booking ${bookingNumber} for verification.`,
      contextPatch: { ...contextPatch, searchResultCount: links.length }
    };
  }

  function dismissOrderSearchNotice() {
    if (!location.pathname.includes("/searchOrder/")) return false;
    const okButton = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit']"))
      .find((control) => {
        const text = cleanText(control.textContent || control.value);
        return /^ok$/i.test(text) && isVisible(control) && !control.disabled;
      });
    if (!okButton) return false;
    okButton.click();
    return true;
  }

  function currentYearOrderNumbersFromResults(year) {
    const found = [];
    for (const table of document.querySelectorAll("table")) {
      const model = modelTable(table);
      const orderIndex = model.headers.findIndex((header) => /^Order ID$/i.test(header));
      const dateIndex = model.headers.findIndex((header) => /Performance Date Time|Date Time|Performance Date/i.test(header));
      if (orderIndex < 0 || dateIndex < 0) continue;
      for (const row of model.rows) {
        const date = parsePerformanceDateTime(row.cells[dateIndex]);
        if (!date || date.year !== year) continue;
        const orderCell = row.element.children[orderIndex];
        const link = orderCell && Array.from(orderCell.querySelectorAll("a[href]"))
          .find((anchor) => /^[A-Za-z0-9-]{4,40}$/.test(cleanText(anchor.textContent)));
        const bookingNumber = link ? cleanText(link.textContent) : cleanText(row.cells[orderIndex]);
        if (/^[A-Za-z0-9-]{4,40}$/.test(bookingNumber) && !found.includes(bookingNumber)) {
          found.push(bookingNumber);
        }
      }
    }
    return found;
  }

  function advanceEmailQueue(payload, queue, queueIndex, processedBookings, extraPatch, reason) {
    const nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (!processedBookings.length) {
        return finalizeEmailWorkflow(payload, processedBookings, extraPatch);
      }
      return null;
    }
    const searchInput = document.querySelector("input[name='order_id']");
    const searchButton = document.getElementById("top-nav-order-search-submit-button");
    if (!searchInput || !searchButton || searchButton.disabled) {
      return {
        status: "failed",
        reason: "The next booking could not be opened because Etix order search became unavailable.",
        stopCode: "next_order_search_unavailable"
      };
    }
    setInputValue(searchInput, queue[nextIndex]);
    searchButton.click();
    return {
      status: "navigating",
      stage: "opening_next_email_booking",
      reason,
      contextPatch: {
        ...extraPatch,
        orderQueue: queue,
        queueIndex: nextIndex,
        processedBookings
      }
    };
  }

  function readBookingNumber() {
    const heading = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
      .map((element) => cleanText(element.textContent))
      .find((text) => /^Order Details:/i.test(text));
    const match = heading && heading.match(/^Order Details:\s*([A-Za-z0-9-]{4,40})/i);
    return match ? match[1] : null;
  }

  function extractExperienceAttendance(year) {
    const table = findTableByHeader("Price Code");
    if (!table) return [];
    const model = modelTable(table);
    const dateIndex = model.headers.indexOf("Date");
    const performanceIndex = model.headers.indexOf("Performance");
    const venueIndex = model.headers.indexOf("Venue");
    const priceCodeIndex = model.headers.indexOf("Price Code");
    const statusIndex = model.headers.indexOf("Status");
    if ([dateIndex, performanceIndex, venueIndex, priceCodeIndex, statusIndex].some((index) => index < 0)) return [];

    const groups = new Map();
    for (const row of model.rows) {
      if (!/^ISSUED$/i.test(cleanText(row.cells[statusIndex]))) continue;
      const date = parsePerformanceDateTime(row.cells[dateIndex]);
      const performance = cleanText(row.cells[performanceIndex]);
      const venue = cleanText(row.cells[venueIndex]);
      const priceCode = cleanText(row.cells[priceCodeIndex]);
      if (!date || date.year !== year) continue;
      if (/parking|protection/i.test(`${performance} ${venue} ${priceCode}`)) continue;
      const ticketType = ticketTypeLabel(priceCode);
      const key = `${performance}|${date.date}|${date.time}|${venue}`;
      if (!groups.has(key)) {
        groups.set(key, { performance, performanceDate: date.date, performanceTime: date.time, venue, tickets: {} });
      }
      const group = groups.get(key);
      group.tickets[ticketType] = (group.tickets[ticketType] || 0) + 1;
    }
    return Array.from(groups.values());
  }

  function ticketTypeLabel(priceCode) {
    return EtixCore.ticketTypeLabel(priceCode);
  }

  function parsePerformanceDateTime(value) {
    return EtixCore.parsePerformanceDateTime(value);
  }

  function formatCustomerReply(bookings) {
    return EtixCore.formatCustomerReply(bookings);
  }

  function invokeResendEmailOnce(resendEmail) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(value);
      };
      const successPattern = /(?:email|confirmation).{0,80}(?:sent|resent|success)|(?:sent|resent|success).{0,80}(?:email|confirmation)/i;
      const inspectText = (value) => {
        if (successPattern.test(cleanText(value))) finish(true);
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") inspectText(mutation.target.textContent);
          for (const node of mutation.addedNodes || []) inspectText(node.textContent);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
      const poll = setInterval(() => {
        const messages = Array.from(document.querySelectorAll(
          "[role='status'], [role='alert'], .alert-success, .alert-info, .ui-messages-info, .ui-growl-message"
        ));
        for (const message of messages) inspectText(message.textContent);
      }, 100);
      const timeout = setTimeout(() => finish(false), 4000);
      try {
        resendEmail.click();
      } catch (_error) {
        finish(false);
      }
    });
  }

  function recoverUnfinishedExchange(payload) {
    const continueButton = document.getElementById("exchanges:start-new-btn");
    const pageText = document.body ? cleanText(document.body.innerText) : "";
    const warningVisible = /haven['’]t finished the previous exchange or re-class/i.test(pageText) &&
      /cancel the previous exchange or re-class and start a new one/i.test(pageText);
    if (!continueButton || !warningVisible) return null;

    const waits = Number(payload.context && payload.context.unfinishedExchangeWaits || 0);
    if (payload.context && payload.context.unfinishedExchangeContinueClicked) {
      if (waits >= 10) {
        return {
          status: "failed",
          reason: "Etix did not clear the unfinished exchange after Continue was selected.",
          stopCode: "unfinished_exchange_not_cleared"
        };
      }
      return {
        status: "continue",
        stage: "clearing_previous_exchange",
        reason: "Waiting for Etix to cancel the previous unfinished exchange.",
        contextPatch: { unfinishedExchangeWaits: waits + 1 }
      };
    }

    continueButton.click();
    return {
      status: "continue",
      stage: "clearing_previous_exchange",
      reason: "Cancelling the previous unfinished exchange before starting the requested order.",
      contextPatch: {
        unfinishedExchangeContinueClicked: true,
        unfinishedExchangeWaits: 0
      }
    };
  }

  function locateEtixOrder(payload, stage) {
    const searchStarted = Boolean(payload.context && payload.context.searchStarted);
    const routingDecision = EtixCore.orderRoutingDecision(
      stage,
      readBookingNumber(),
      payload.orderNumber,
      searchStarted
    );
    if (routingDecision === "open_search_result") {
      const exactLinks = Array.from(document.querySelectorAll("a[href]"))
        .filter((anchor) => cleanText(anchor.textContent) === payload.orderNumber && isVisible(anchor));
      if (!exactLinks.length) {
        dismissOrderSearchNotice();
        return {
          status: "blocked",
          reason: "Etix search results did not contain an exact link for the requested order number.",
          stopCode: "order_not_found"
        };
      }
      exactLinks[0].click();
      return {
        status: "navigating",
        stage: "opening_order_details",
        reason: exactLinks.length > 1
          ? `Etix returned ${exactLinks.length} venue rows for this order; opening the first exact order match for verification.`
          : "Opening the matching Etix order.",
        contextPatch: {
          searchStarted: true,
          searchResultCount: exactLinks.length
        }
      };
    }

    const searchInput = document.querySelector("input[name='order_id']");
    const searchButton = document.getElementById("top-nav-order-search-submit-button");
    if (!searchInput || !searchButton || searchButton.disabled) {
      return {
        status: "blocked",
        reason: "The Etix order-search controls are unavailable on this page.",
        stopCode: "order_search_unavailable",
        stage
      };
    }
    setInputValue(searchInput, payload.orderNumber);
    searchButton.click();
    return {
      status: "navigating",
      stage: "searching_for_order",
      reason: "Searching Etix for the requested order number.",
      contextPatch: { searchStarted: true }
    };
  }

  function routeToRequestedOrder(payload, stage) {
    // Shared precondition for every order-number workflow: resolve the requested
    // order before any workflow-specific inspection or mutation is allowed.
    const routingDecision = EtixCore.orderRoutingDecision(
      stage,
      readBookingNumber(),
      payload.orderNumber,
      Boolean(payload.context && payload.context.searchStarted)
    );
    if (routingDecision === "not_applicable" || routingDecision === "ready") return null;
    return locateEtixOrder(payload, stage);
  }

  function startEtixReclass(payload, profile) {
    if (readBookingNumber() !== payload.orderNumber) {
      return {
        status: "blocked",
        reason: "The open Order Details page does not match the requested order number.",
        stopCode: "order_mismatch"
      };
    }
    const summary = summarizeOrderTickets(profile);
    if (!summary.ok) return summary;
    if (summary.eligible.length < payload.quantity) {
      return {
        status: "blocked",
        reason: `Only ${summary.eligible.length} eligible standard adult ticket(s) remain; ${payload.quantity} requested.`,
        stopCode: "insufficient_eligible_tickets"
      };
    }
    const route = Array.from(document.querySelectorAll("a"))
      .find((anchor) => EtixCore.normalizeText(anchor.textContent) === "change price codes reclass");
    if (!route) {
      return {
        status: "blocked",
        reason: "The Change Price Codes (Reclass) action is unavailable for this order.",
        stopCode: "reclass_unavailable"
      };
    }

    const selected = summary.eligible.slice(0, payload.quantity);
    route.click();
    return {
      status: "navigating",
      stage: "opening_change_price_code",
      reason: "Opening Change Price Codes.",
      contextPatch: {
        initialTargetCount: summary.targetCount,
        expectedFinalTargetCount: summary.targetCount + payload.quantity,
        initialGrandTotal: summary.grandTotal,
        plannedPriceCodes: selected.map((ticket) => `${ticket.priceCode} ${profile.targetSuffix}`)
      }
    };
  }

  async function configureEtixReclass(payload, profile) {
    const table = findTableByHeader("Price Code");
    if (!table) {
      return { status: "blocked", reason: "The Etix ticket table was not found.", stopCode: "ticket_table_missing" };
    }
    const model = modelTable(table);
    const priceCodeIndex = model.headers.indexOf("Price Code");
    const seatIndex = model.headers.indexOf("Seat Info");
    const candidates = model.rows.filter((row) => {
      const checkbox = row.element.querySelector("input[type='checkbox'][id*='performanceTable']");
      const priceCode = cleanText(row.cells[priceCodeIndex]);
      return checkbox && profile.sourcePriceCodes.includes(priceCode);
    }).map((row) => ({
      checkboxId: row.element.querySelector("input[type='checkbox'][id*='performanceTable']").id,
      sourcePriceCode: cleanText(row.cells[priceCodeIndex]),
      seat: seatIndex >= 0 ? cleanText(row.cells[seatIndex]) : ""
    }));
    if (candidates.length < payload.quantity) {
      return {
        status: "blocked",
        reason: `The Change Price Code page contains only ${candidates.length} eligible standard adult ticket(s).`,
        stopCode: "eligible_rows_changed"
      };
    }

    const selectedTickets = [];
    for (const candidate of candidates.slice(0, payload.quantity)) {
      const checkboxId = candidate.checkboxId;
      let checkbox = document.getElementById(checkboxId);
      if (!checkbox) {
        return {
          status: "failed",
          reason: "An eligible ticket row changed while Etix was updating the page.",
          stopCode: "ticket_row_changed"
        };
      }
      const sourcePriceCode = candidate.sourcePriceCode;
      if (!checkbox.checked) checkbox.click();

      const enabled = await waitForCondition(() => {
        const currentCheckbox = document.getElementById(checkboxId);
        const currentRow = currentCheckbox && currentCheckbox.closest("tr");
        const select = currentRow && currentRow.querySelector("select[id*='priceCodeSelector']");
        return select && !select.disabled ? select : null;
      }, 5000);
      if (!enabled) {
        return {
          status: "failed",
          reason: "Etix did not enable a selected ticket's price-code control.",
          stopCode: "price_code_control_not_enabled"
        };
      }

      const targetChoice = EtixCore.chooseCarerPriceCode(
        Array.from(enabled.options).map((item) => cleanText(item.textContent)),
        sourcePriceCode,
        profile.targetSuffix
      );
      if (targetChoice.status !== "matched") {
        return {
          status: targetChoice.status,
          reason: targetChoice.reason,
          stopCode: targetChoice.status === "needs_input"
            ? "target_price_code_ambiguous"
            : "target_price_code_missing",
          matchingPriceCodes: targetChoice.matches
        };
      }
      const targetPriceCode = targetChoice.value;
      const option = Array.from(enabled.options)
        .find((item) => cleanText(item.textContent) === targetPriceCode);
      setInputValue(enabled, option.value);
      const selected = await waitForCondition(() => {
        const currentCheckbox = document.getElementById(checkboxId);
        const currentRow = currentCheckbox && currentCheckbox.closest("tr");
        const select = currentRow && currentRow.querySelector("select[id*='priceCodeSelector']");
        return select && cleanText(select.selectedOptions[0] && select.selectedOptions[0].textContent) === targetPriceCode;
      }, 5000);
      if (!selected) {
        return {
          status: "failed",
          reason: "Etix did not retain the requested 50%-off price code.",
          stopCode: "price_code_not_retained"
        };
      }
      selectedTickets.push({
        checkboxId,
        seat: candidate.seat,
        sourcePriceCode,
        targetPriceCode
      });
      await pause(300);
    }

    const note = document.getElementById("exchanges:exchange-note");
    if (!note) {
      return { status: "blocked", reason: "The required exchange note field is missing.", stopCode: "note_field_missing" };
    }
    setInputValue(note, profile.note);
    note.blur();

    let dependentTicketAcknowledged = false;
    if (profile.dependentTicketAcknowledgementName) {
      const acknowledgement = Array.from(document.getElementsByName(
        profile.dependentTicketAcknowledgementName
      )).find((element) => element.matches("input[type='checkbox']"));
      if (acknowledgement) {
        if (!acknowledgement.checked) acknowledgement.click();
        const accepted = await waitForCondition(() => {
          const current = Array.from(document.getElementsByName(
            profile.dependentTicketAcknowledgementName
          )).find((element) => element.matches("input[type='checkbox']"));
          return current && current.checked;
        }, 3000);
        if (!accepted) {
          return {
            status: "failed",
            reason: "Etix did not accept the linked parking/protection ticket acknowledgement.",
            stopCode: "dependent_ticket_acknowledgement_failed"
          };
        }
        dependentTicketAcknowledged = true;
      }
    }

    let continueButton = await waitForCondition(() => {
      const button = document.getElementById("exchanges:j_idt148");
      return button && !button.disabled ? button : null;
    }, 6000);
    let continueRecoveredByReselect = false;
    if (!continueButton) {
      const recovery = await reselectConfiguredTickets(selectedTickets, profile);
      if (!recovery.ok) return recovery;
      dependentTicketAcknowledged = recovery.dependentTicketAcknowledged;
      continueButton = await waitForCondition(() => {
        const button = document.getElementById("exchanges:j_idt148");
        return button && !button.disabled ? button : null;
      }, 6000);
      continueRecoveredByReselect = Boolean(continueButton);
    }
    if (!continueButton) {
      return {
        status: "failed",
        reason: "Etix did not enable Continue after the selected tickets were safely deselected, reselected, and revalidated.",
        stopCode: "continue_not_enabled"
      };
    }
    continueButton.click();
    return {
      status: "navigating",
      stage: "opening_exchange_review",
      reason: continueRecoveredByReselect
        ? `Reselected and revalidated ${payload.quantity} carer ticket(s); opening the exchange review.`
        : `Configured ${payload.quantity} carer ticket(s); opening the exchange review.`,
      contextPatch: { selectedTickets, dependentTicketAcknowledged, continueRecoveredByReselect }
    };
  }

  async function reselectConfiguredTickets(selectedTickets, profile) {
    for (const ticket of selectedTickets) {
      let checkbox = document.getElementById(ticket.checkboxId);
      if (!checkbox) {
        return {
          status: "failed",
          reason: "A selected ticket row disappeared before Continue could be refreshed.",
          stopCode: "continue_recovery_ticket_missing",
          ok: false
        };
      }
      if (checkbox.checked) checkbox.click();
      const deselected = await waitForCondition(() => {
        const currentCheckbox = document.getElementById(ticket.checkboxId);
        const currentRow = currentCheckbox && currentCheckbox.closest("tr");
        const select = currentRow && currentRow.querySelector("select[id*='priceCodeSelector']");
        return currentCheckbox && !currentCheckbox.checked && (!select || select.disabled)
          ? currentCheckbox
          : null;
      }, 4000);
      if (!deselected) {
        return {
          status: "failed",
          reason: "Etix did not safely deselect a ticket while refreshing Continue.",
          stopCode: "continue_recovery_deselect_failed",
          ok: false
        };
      }

      await pause(250);
      checkbox = document.getElementById(ticket.checkboxId);
      if (!checkbox) {
        return {
          status: "failed",
          reason: "A ticket row changed while Continue was being refreshed.",
          stopCode: "continue_recovery_ticket_changed",
          ok: false
        };
      }
      if (!checkbox.checked) checkbox.click();
      const enabled = await waitForCondition(() => {
        const currentCheckbox = document.getElementById(ticket.checkboxId);
        const currentRow = currentCheckbox && currentCheckbox.closest("tr");
        const select = currentRow && currentRow.querySelector("select[id*='priceCodeSelector']");
        return currentCheckbox && currentCheckbox.checked && select && !select.disabled ? select : null;
      }, 5000);
      if (!enabled) {
        return {
          status: "failed",
          reason: "Etix did not re-enable a ticket's price-code control after reselection.",
          stopCode: "continue_recovery_reselect_failed",
          ok: false
        };
      }
      const option = Array.from(enabled.options)
        .find((item) => cleanText(item.textContent) === ticket.targetPriceCode);
      if (!option) {
        return {
          status: "blocked",
          reason: `The exact price code “${ticket.targetPriceCode}” disappeared during Continue recovery.`,
          stopCode: "continue_recovery_price_code_missing",
          ok: false
        };
      }
      setInputValue(enabled, option.value);
      const retained = await waitForCondition(() => {
        const currentCheckbox = document.getElementById(ticket.checkboxId);
        const currentRow = currentCheckbox && currentCheckbox.closest("tr");
        const select = currentRow && currentRow.querySelector("select[id*='priceCodeSelector']");
        return select && cleanText(select.selectedOptions[0] && select.selectedOptions[0].textContent) === ticket.targetPriceCode;
      }, 5000);
      if (!retained) {
        return {
          status: "failed",
          reason: "Etix did not retain the 50%-off price code after ticket reselection.",
          stopCode: "continue_recovery_price_code_not_retained",
          ok: false
        };
      }
      await pause(300);
    }

    const note = document.getElementById("exchanges:exchange-note");
    if (!note) {
      return {
        status: "blocked",
        reason: "The exchange note disappeared during Continue recovery.",
        stopCode: "continue_recovery_note_missing",
        ok: false
      };
    }
    setInputValue(note, profile.note);
    note.blur();
    const noteRetained = await waitForCondition(() => {
      const current = document.getElementById("exchanges:exchange-note");
      return current && cleanText(current.value) === cleanText(profile.note);
    }, 3000);
    if (!noteRetained) {
      return {
        status: "failed",
        reason: "Etix did not retain the exchange note after ticket reselection.",
        stopCode: "continue_recovery_note_not_retained",
        ok: false
      };
    }

    let dependentTicketAcknowledged = false;
    if (profile.dependentTicketAcknowledgementName) {
      const acknowledgement = Array.from(document.getElementsByName(
        profile.dependentTicketAcknowledgementName
      )).find((element) => element.matches("input[type='checkbox']"));
      if (acknowledgement) {
        if (!acknowledgement.checked) acknowledgement.click();
        const accepted = await waitForCondition(() => {
          const current = Array.from(document.getElementsByName(
            profile.dependentTicketAcknowledgementName
          )).find((element) => element.matches("input[type='checkbox']"));
          return current && current.checked;
        }, 3000);
        if (!accepted) {
          return {
            status: "failed",
            reason: "Etix did not retain the linked-ticket acknowledgement after ticket reselection.",
            stopCode: "continue_recovery_acknowledgement_failed",
            ok: false
          };
        }
        dependentTicketAcknowledged = true;
      }
    }
    return { ok: true, dependentTicketAcknowledged };
  }

  async function submitEtixExchange(payload, profile) {
    const ticketTable = findTableByHeader("Price Code");
    const ticketSelects = ticketTable
      ? (() => {
        const model = modelTable(ticketTable);
        const priceCodeIndex = model.headers.indexOf("Price Code");
        if (priceCodeIndex < 0) return [];
        return model.rows.map((row) => {
          const priceCodeCell = row.element.children[priceCodeIndex];
          return priceCodeCell && priceCodeCell.querySelector(
            "select[id^='singlePage:shoppingCart:']"
          );
        }).filter(Boolean);
      })()
      : [];
    if (ticketSelects.length !== payload.quantity) {
      return {
        status: "blocked",
        reason: `Exchange review contains ${ticketSelects.length} ticket(s), but ${payload.quantity} were requested.`,
        stopCode: "exchange_quantity_mismatch"
      };
    }
    const selectedPriceCodes = ticketSelects.map((select) => cleanText(select.selectedOptions[0] && select.selectedOptions[0].textContent));
    if (selectedPriceCodes.some((code) => !EtixCore.isCarerTicketName(code))) {
      return {
        status: "blocked",
        reason: "At least one exchange ticket is not an Adult 50% or carer price code.",
        stopCode: "exchange_price_code_mismatch"
      };
    }

    const refundAmount = readMoneySummary("Refund Amount");
    if (refundAmount === null || refundAmount >= 0) {
      return {
        status: "needs_input",
        reason: "The exchange does not show a negative refund amount. Review it manually.",
        stopCode: "refund_not_confirmed"
      };
    }
    const checkedPaymentMethods = Array.from(document.querySelectorAll(
      "input[type='checkbox'][name^='singlePage:original-pay-methods:']:checked"
    ));
    if (checkedPaymentMethods.length !== 1) {
      return {
        status: "needs_input",
        reason: "Etix has not selected exactly one original payment method for the refund.",
        stopCode: "refund_method_ambiguous"
      };
    }

    const declineRewards = document.getElementById("singlePage:declineRewards");
    if (declineRewards) {
      if (payload.context && payload.context.ticketProtectionDeclined) {
        const waits = Number(payload.context.ticketProtectionWaits || 0) + 1;
        if (waits > 10) {
          return {
            status: "failed",
            reason: "Etix did not close the ticket-protection offer.",
            stopCode: "upsell_not_dismissed"
          };
        }
        return {
          status: "continue",
          stage: "waiting_for_ticket_protection",
          reason: "Waiting for Etix to close the ticket-protection offer.",
          contextPatch: { ticketProtectionWaits: waits }
        };
      }
      declineRewards.click();
      return {
        status: "continue",
        stage: "declining_ticket_protection",
        reason: "Declining the ticket-protection offer before final submission.",
        contextPatch: { ticketProtectionDeclined: true, ticketProtectionWaits: 0 }
      };
    }

    const submit = document.getElementById("singlePage:exchange");
    if (!submit || submit.disabled) {
      return { status: "blocked", reason: "The final Exchange submit control is unavailable.", stopCode: "exchange_submit_unavailable" };
    }
    submit.click();
    return {
      status: "navigating",
      stage: "verifying_order_details",
      reason: "Submitted the verified exchange; waiting for final Order Details.",
      contextPatch: {
        exchangeSubmitted: true,
        refundAmount,
        selectedPriceCodes
      }
    };
  }

  function verifyEtixReclass(payload, profile) {
    if (readBookingNumber() !== payload.orderNumber) {
      return {
        status: "failed",
        reason: "Etix returned to a different order after submission. Inspect both orders before retrying.",
        stopCode: "final_order_mismatch"
      };
    }
    const summary = summarizeOrderTickets(profile);
    if (!summary.ok) return { ...summary, status: "failed" };
    if (summary.targetCount !== payload.context.expectedFinalTargetCount) {
      return {
        status: "failed",
        reason: `Expected ${payload.context.expectedFinalTargetCount} carer ticket(s), but Etix shows ${summary.targetCount}. Inspect the order before retrying.`,
        stopCode: "final_count_mismatch",
        expectedCarerTickets: payload.context.expectedFinalTargetCount,
        actualCarerTickets: summary.targetCount
      };
    }
    const reclassedTargetCount = summary.rows.filter((ticket) =>
      EtixCore.isCarerTicketName(ticket.priceCode) && /reclassed/i.test(ticket.rawText)
    ).length;
    if (reclassedTargetCount < payload.quantity || !document.body.innerText.includes(profile.note)) {
      return {
        status: "failed",
        reason: "The final ticket count is correct, but the reclassification or transaction-note evidence is incomplete.",
        stopCode: "final_evidence_incomplete"
      };
    }
    if (payload.context.initialGrandTotal && summary.grandTotal === payload.context.initialGrandTotal) {
      return {
        status: "failed",
        reason: "The order total did not change after the reclassification.",
        stopCode: "order_total_unchanged"
      };
    }
    return {
      status: "completed",
      reason: `Etix verified ${payload.quantity} newly reclassified carer ticket(s).`,
      orderNumber: maskIdentifier(payload.orderNumber),
      quantity: payload.quantity,
      finalCarerTickets: summary.targetCount,
      refundAmount: payload.context.refundAmount,
      targetPriceCodes: payload.context.selectedPriceCodes,
      verifiedAt: new Date().toISOString()
    };
  }

  function summarizeOrderTickets(profile) {
    const table = findTableByHeader("Price Code");
    if (!table) {
      return { ok: false, status: "blocked", reason: "The Order Details ticket table was not found.", stopCode: "ticket_table_missing" };
    }
    const model = modelTable(table);
    const priceCodeIndex = model.headers.indexOf("Price Code");
    const seatIndex = model.headers.indexOf("Seat Info");
    const rows = model.rows.map((row) => ({
      priceCode: cleanText(row.cells[priceCodeIndex]),
      seat: seatIndex >= 0 ? cleanText(row.cells[seatIndex]) : "",
      rawText: cleanText(row.element.textContent)
    }));
    const eligible = rows.filter((ticket) => profile.sourcePriceCodes.includes(ticket.priceCode));
    const targetCount = rows.filter((ticket) => EtixCore.isCarerTicketName(ticket.priceCode)).length;
    const grandTotal = readGrandTotal();
    return { ok: true, rows, eligible, targetCount, grandTotal };
  }

  function findTableByHeader(header) {
    return Array.from(document.querySelectorAll("table")).find((table) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => cleanText(cell.textContent));
      return headers.includes(header);
    }) || null;
  }

  function modelTable(table) {
    const headerRow = Array.from(table.querySelectorAll("tr")).find((row) => row.querySelector("th"));
    const headers = headerRow ? Array.from(headerRow.children).map((cell) => cleanText(cell.textContent)) : [];
    const rows = Array.from(table.querySelectorAll("tr"))
      .filter((row) => row !== headerRow && row.querySelector("td"))
      .map((element) => ({ element, cells: Array.from(element.children).map((cell) => cell.textContent || "") }));
    return { headers, rows };
  }

  function readGrandTotal() {
    const text = document.body ? document.body.innerText : "";
    const match = text.match(/Grand Total\s*£\s*([\d,]+\.\d{2})/i) ||
      text.match(/Order Summary\s*\|\s*Total:\s*£\s*([\d,]+\.\d{2})/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function readMoneySummary(label) {
    const rows = Array.from(document.querySelectorAll("tr"));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent));
      if (!cells[0] || !cells[0].toLowerCase().startsWith(label.toLowerCase())) continue;
      const match = (cells[1] || "").match(/(-?)£\s*([\d,]+\.\d{2})/);
      if (match) return Number(`${match[1]}${match[2].replace(/,/g, "")}`);
    }
    return null;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function waitForCondition(check, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const run = () => {
        let value = null;
        try { value = check(); } catch (_error) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(run, 100);
      };
      run();
    });
  }

  function pause(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function applyWorkflow(payload) {
    const profileCheck = EtixCore.validateWorkflowProfile(payload.workflowProfile);
    if (!profileCheck.ok) {
      return { status: "blocked", reason: profileCheck.error, stopCode: "calibration_required" };
    }
    const profile = profileCheck.value;
    if (!profile.hosts.includes(location.hostname)) {
      return {
        status: "blocked",
        reason: "This Etix host is not approved by the workflow profile.",
        stopCode: "host_not_approved"
      };
    }

    const evidence = document.querySelector(profile.orderEvidenceSelector);
    if (!evidence || !readElement(evidence).includes(payload.orderNumber)) {
      return {
        status: "blocked",
        reason: "The calibrated order evidence does not match the requested order.",
        stopCode: "order_mismatch"
      };
    }

    const candidates = candidatesFromProfile(profile);
    const match = EtixCore.chooseTicketCandidate(candidates, payload.aliases);
    if (match.status !== "matched") {
      return {
        status: match.status,
        reason: match.reason,
        stopCode: match.status === "needs_input" ? "ambiguous_ticket" : "ticket_not_found",
        candidates: match.ranked.slice(0, 10).map(publicCandidate)
      };
    }

    const row = match.candidate.element;
    const discountButton = row.querySelector(profile.discountButtonSelector);
    if (!discountButton || !isVisible(discountButton) || discountButton.disabled) {
      return {
        status: "blocked",
        reason: "The calibrated discount control is unavailable.",
        stopCode: "discount_control_unavailable"
      };
    }

    discountButton.click();
    const confirmation = await waitForSelector(profile.confirmationButtonSelector, 5000);
    if (!confirmation || !isVisible(confirmation) || confirmation.disabled) {
      return {
        status: "blocked",
        reason: "The expected confirmation control did not appear. No confirmation was submitted.",
        stopCode: "confirmation_missing"
      };
    }

    if (profile.quantityInputSelector) {
      const quantityInput = document.querySelector(profile.quantityInputSelector);
      if (!quantityInput) {
        return {
          status: "blocked",
          reason: "The calibrated quantity input did not appear. No confirmation was submitted.",
          stopCode: "quantity_input_missing"
        };
      }
      setInputValue(quantityInput, String(payload.quantity));
    } else if (payload.quantity !== 1) {
      return {
        status: "blocked",
        reason: "This workflow profile only supports a quantity of one.",
        stopCode: "quantity_not_supported"
      };
    }

    confirmation.click();
    const success = await waitForSelector(profile.successSelector, 8000);
    if (!success) {
      return {
        status: "failed",
        reason: "Etix did not show the calibrated success evidence. Check the order before retrying.",
        stopCode: "outcome_unknown"
      };
    }
    if (profile.successText && !EtixCore.normalizeText(readElement(success)).includes(
      EtixCore.normalizeText(profile.successText)
    )) {
      return {
        status: "failed",
        reason: "The success area appeared but its text did not match the calibrated result. Check the order before retrying.",
        stopCode: "verification_mismatch"
      };
    }

    return {
      status: "completed",
      reason: "Etix displayed the calibrated success evidence after confirmation.",
      orderNumber: maskIdentifier(payload.orderNumber),
      quantity: payload.quantity,
      selectedTicket: publicCandidate(match.candidate),
      verifiedAt: new Date().toISOString()
    };
  }

  function candidatesFromProfile(profile) {
    return Array.from(document.querySelectorAll(profile.ticketRowSelector)).map((row, index) => {
      const nameElement = row.querySelector(profile.ticketNameSelector);
      return {
        id: `row-${index}`,
        text: EtixCore.redactText(readElement(nameElement || row)).slice(0, 200),
        element: row,
        source: "profile"
      };
    }).filter((candidate) => candidate.text);
  }

  function discoverCandidateControls(aliases) {
    const elements = Array.from(document.querySelectorAll(
      "button, a, [role='button'], tr, li, [class*='ticket'], [class*='discount']"
    )).slice(0, 500);
    const seen = new Set();
    const candidates = [];
    for (const element of elements) {
      const text = EtixCore.redactText(readElement(element)).slice(0, 240);
      if (!text || text.length > 240 || seen.has(text)) continue;
      const score = EtixCore.scoreTicketCandidate(text, aliases);
      if (score < 0.4) continue;
      seen.add(text);
      candidates.push({
        id: `discovered-${candidates.length}`,
        text,
        element,
        source: "discovery"
      });
    }
    return candidates;
  }

  function findOrderEvidence(orderNumber, profile) {
    if (!profile || !profile.orderEvidenceSelector) return false;
    try {
      return Array.from(document.querySelectorAll(profile.orderEvidenceSelector))
        .some((element) => readElement(element).includes(orderNumber));
    } catch (_error) {
      return false;
    }
  }

  function publicCandidate(candidate) {
    return {
      id: candidate.id,
      text: candidate.text,
      score: candidate.score,
      source: candidate.source
    };
  }

  function readElement(element) {
    if (!element) return "";
    if ("value" in element && typeof element.value === "string") return element.value;
    return element.textContent || "";
  }

  function findLabel(element) {
    if (element.labels && element.labels.length) {
      return Array.from(element.labels).map((label) => label.textContent).join(" ");
    }
    const parentLabel = element.closest("label");
    return parentLabel ? parentLabel.textContent : "";
  }

  function safeAttribute(element, name) {
    return String(element.getAttribute(name) || "").slice(0, 120);
  }

  function redactAttribute(element, name) {
    return EtixCore.redactText(safeAttribute(element, name)).slice(0, 120);
  }

  function selectorHint(element) {
    if (element.id && !looksSensitive(element.id) && /^[A-Za-z][\w:.-]*$/.test(element.id)) {
      return `#${globalThis.CSS && CSS.escape ? CSS.escape(element.id) : element.id}`;
    }
    const tag = element.tagName.toLowerCase();
    const name = element.getAttribute("name");
    if (name && !looksSensitive(name) && !/["'\\]/.test(name)) return `${tag}[name="${name}"]`;
    const role = element.getAttribute("role");
    if (role && !/["'\\]/.test(role)) return `${tag}[role="${role}"]`;
    return tag;
  }

  function looksSensitive(value) {
    return /@|\d{6,}/.test(String(value || ""));
  }

  function safePageSummary() {
    return {
      origin: location.origin,
      pathname: redactPathname(location.pathname),
      title: EtixCore.redactText(document.title).slice(0, 160)
    };
  }

  function redactPathname(pathname) {
    return String(pathname || "").replace(/\b\d{6,}\b/g, "[NUMBER]");
  }

  function maskIdentifier(value) {
    const stringValue = String(value || "");
    if (stringValue.length <= 4) return "••••";
    return `${"•".repeat(Math.min(8, stringValue.length - 4))}${stringValue.slice(-4)}`;
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function setInputValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value"
    );
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function waitForSelector(selector, timeoutMs) {
    return new Promise((resolve) => {
      let initial;
      try {
        initial = document.querySelector(selector);
      } catch (_error) {
        resolve(null);
        return;
      }
      if (initial) {
        resolve(initial);
        return;
      }
      const observer = new MutationObserver(() => {
        let found;
        try { found = document.querySelector(selector); } catch (_error) { found = null; }
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }
})();
