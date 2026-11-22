(function initialiseEtixCore(globalScope) {
  "use strict";

  const DEFAULT_ALIASES = [
    "carer",
    "care assistant",
    "personal assistant",
    "essential companion",
    "companion",
    "support worker"
  ];

  const DEFAULT_WORKFLOW_PROFILE = Object.freeze({
    version: 2,
    workflowKind: "etix_carer_reclass",
    hosts: ["boxoffice.etix.com"],
    sourcePriceCodes: ["Adult (18+)"],
    targetSuffix: "50% Off",
    note: "Carers Ticket",
    dependentTicketAcknowledgementName: "exchanges:j_idt144"
  });

  // Add future enhancements as { id, name, description }; each starts disabled.
  const ENHANCEMENTS = Object.freeze([
    { id: "colourBlindMode", name: "Colour-blind friendly mode", description: "Off by default. Improve Etix controls and seating colours with contrast, patterns and colour-group codes. When enabled, choose a profile below; Tritanopia is preselected." },
    { id: "flashFocusedSeats", name: "Flash focused seats", description: "Scroll to the train and pulse the booking’s seats for up to 30 seconds or until your next action when you click its seating link on Unassigned Seat. Uses a steady outline if reduced motion is enabled. Works with or without colour-blind mode." },
    { id: "searchUnassignedOrders", name: "Search Unassigned Seat orders", description: "Add a search box beside Unassigned / Assigned / All. Filter every page of the current view by order number or part of a customer’s name." },
    { id: "doorAccessColumn", name: "Door-access request column", description: "Add an accessibility icon column on Unassigned Seat. Show the icon only when the booking answered Yes to the question about sitting closer to the carriage doors." }
  ]);
  const COLOUR_BLIND_MODES = Object.freeze([
    { id: "tritanopia", label: "Tritanopia / Tritanomaly (blue–yellow)", colours: ["#c62838", "#007f86", "#777777"], hueSlots: [0, 2, 0, 1, 1, 2] },
    { id: "protanopia", label: "Protanopia / Protanomaly (red–green)", colours: ["#195fbc", "#c46b00", "#777777"], hueSlots: [1, 1, 2, 0, 0, 2] },
    { id: "deuteranopia", label: "Deuteranopia / Deuteranomaly (red–green)", colours: ["#175ab5", "#bb6500", "#777777"], hueSlots: [1, 1, 2, 0, 0, 2] },
    { id: "monochrome", label: "Monochrome (contrast and patterns)", colours: ["#777777"] }
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    operatorName: "",
    accountLabel: "",
    ticketAliases: DEFAULT_ALIASES,
    emailWorkflowEnabled: true,
    carerWorkflowEnabled: true,
    parkingWorkflowEnabled: true,
    liveExecutionEnabled: false,
    skipCarerPreview: false,
    emailExecutionEnabled: false,
    parkingExecutionEnabled: false,
    showPageInspector: false,
    showFeedback: false,
    enhancements: Object.freeze({colourBlindMode: false}),
    colourBlindMode: "tritanopia",
    workflowProfile: DEFAULT_WORKFLOW_PROFILE
  });

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  }

  function validateOrderNumber(value) {
    const orderNumber = String(value || "").trim();
    if (!orderNumber) {
      return { ok: false, error: "Enter an Etix order number." };
    }
    if (!/^[A-Za-z0-9-]{4,40}$/.test(orderNumber)) {
      return {
        ok: false,
        error: "Use 4–40 letters, numbers, or hyphens for the order number."
      };
    }
    return { ok: true, value: orderNumber };
  }

  function validateEmailAddress(value) {
    const email = String(value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return { ok: false, error: "Enter a valid email address." };
    }
    return { ok: true, value: email };
  }

  function validateOrderLookup(value) {
    const lookup = String(value || "").trim();
    if (lookup.includes("@")) {
      const email = validateEmailAddress(lookup);
      return email.ok ? { ...email, type: "email" } : email;
    }
    const order = validateOrderNumber(lookup);
    return order.ok ? { ...order, type: "order" } : order;
  }

  function validateQuantity(value) {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return { ok: false, error: "Quantity must be a whole number from 1 to 10." };
    }
    return { ok: true, value: quantity };
  }

  function redactText(value) {
    return String(value || "")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
      .replace(/(?:\+?\d[\s().-]*){9,}/g, "[PHONE]")
      .replace(/\b\d{6,}\b/g, "[NUMBER]")
      .replace(/\s+/g, " ")
      .trim();
  }

  const PARKING_TYPES = Object.freeze([
    { key: "parking", label: "Parking" },
    { key: "disabled", label: "Disabled Parking" },
    { key: "comp", label: "Parking Comp" }
  ]);

  function validateParkingRequest(payload, requireRegistrations = true) {
    const order = validateOrderNumber(payload && payload.orderNumber);
    if (!order.ok) return order;
    const quantities = {};
    const registrations = {};
    for (const type of PARKING_TYPES) {
      const raw = payload && payload.quantities && payload.quantities[type.key];
      const quantity = Number(raw);
      if (raw === "" || raw === null || raw === undefined ||
          !Number.isInteger(quantity) || quantity < 0 || quantity > 10) {
        return { ok: false, error: `${type.label} quantity must be a whole number from 0 to 10.` };
      }
      quantities[type.key] = quantity;
      const plates = payload && payload.registrations && payload.registrations[type.key] || [];
      if (requireRegistrations && (!Array.isArray(plates) || plates.length !== quantity)) {
        return { ok: false, error: `Enter one registration plate for each ${type.label} space.` };
      }
      registrations[type.key] = [];
      if (requireRegistrations) {
        for (const plate of plates) {
          const value = String(plate || "").trim().replace(/\s+/g, " ").toUpperCase();
          if (!/^[A-Z0-9][A-Z0-9 -]{1,19}$/.test(value)) {
            return { ok: false, error: `Enter a registration plate of 2–20 letters, numbers, spaces or hyphens for ${type.label}.` };
          }
          registrations[type.key].push(value);
        }
      }
    }
    const quantity = Object.values(quantities).reduce((sum, count) => sum + count, 0);
    if (!quantity) return { ok: false, error: "Select at least one parking space." };
    return { ok: true, value: { orderNumber: order.value, quantities, registrations, quantity } };
  }

  function parkingDateKey(value) {
    const text = String(value || "");
    const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
    const long = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
    if (!numeric && !long) return null;
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const parts = (match, named) => {
      const day = Number(match[1]);
      const month = named ? months.indexOf(match[2].toLowerCase()) + 1 : Number(match[2]);
      const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
    };
    const key = parts(numeric || long, !numeric);
    return numeric && long && key !== parts(long, true) ? null : key;
  }

  function parkingVenueMatches(ticketVenue, parkingVenue) {
    if (!/\bparking\b/i.test(parkingVenue) || /protection/i.test(parkingVenue)) return false;
    const identity = (value) => normalizeText(String(value).split(/\bparking\b/i)[0])
      .split(" ").filter((word) => word && !["railway", "station", "car", "park"].includes(word)).join(" ");
    const source = identity(ticketVenue);
    return Boolean(source) && source === identity(parkingVenue);
  }

  function chooseParkingOption(names, predicate, description) {
    const matches = names.filter(predicate);
    if (matches.length === 1) return { status: "matched", value: matches[0] };
    return {
      status: matches.length ? "needs_input" : "blocked",
      reason: matches.length ? `More than one ${description} matches the tickets.` : `No ${description} matches the tickets.`,
      stopCode: matches.length ? "parking_match_ambiguous" : "parking_match_missing"
    };
  }

  function parkingOrderTarget(tickets) {
    const issued = tickets.filter((ticket) => /^ISSUED$/i.test(ticket.status));
    const experiences = issued.filter((ticket) => !/parking|protection/i.test(`${ticket.venue} ${ticket.performance} ${ticket.priceCode}`));
    if (!experiences.length || experiences.some((ticket) => !ticket.venue || !parkingDateKey(ticket.date))) {
      return { status: "blocked", reason: "No issued experience tickets with a readable venue and date were found.", stopCode: "parking_tickets_missing" };
    }
    const targets = new Map(experiences.map((ticket) => [
      `${normalizeText(ticket.venue)}|${parkingDateKey(ticket.date)}`,
      { venue: ticket.venue, date: parkingDateKey(ticket.date) }
    ]));
    if (targets.size !== 1) return { status: "needs_input", reason: "The order contains experience tickets for more than one venue or date. Select the intended tickets in Etix first.", stopCode: "parking_order_ambiguous" };
    const target = Array.from(targets.values())[0];
    const counts = Object.fromEntries(PARKING_TYPES.map((type) => [type.key, issued.filter((ticket) =>
      normalizeText(ticket.priceCode) === normalizeText(type.label) && parkingVenueMatches(target.venue, ticket.venue) && parkingDateKey(ticket.date) === target.date
    ).length]));
    return { status: "matched", target, counts, experienceCount: experiences.length, ticketCount: issued.length };
  }

  function scoreTicketCandidate(text, aliases) {
    const normalized = normalizeText(text);
    if (!normalized) return 0;

    let best = 0;
    for (const alias of aliases || DEFAULT_ALIASES) {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias) continue;
      if (normalized === normalizedAlias) best = Math.max(best, 1);
      else if (normalized.includes(normalizedAlias)) best = Math.max(best, 0.9);
      else {
        const words = normalizedAlias.split(" ").filter(Boolean);
        const matches = words.filter((word) => normalized.includes(word)).length;
        best = Math.max(best, words.length ? (matches / words.length) * 0.72 : 0);
      }
    }
    return Math.round(best * 100) / 100;
  }

  function chooseTicketCandidate(candidates, aliases) {
    const ranked = (candidates || [])
      .map((candidate) => ({
        ...candidate,
        score: scoreTicketCandidate(candidate.text, aliases)
      }))
      .sort((left, right) => right.score - left.score);

    if (!ranked.length || ranked[0].score < 0.8) {
      return { status: "blocked", reason: "No confident carer-ticket match.", ranked };
    }
    if (ranked[1] && ranked[1].score >= ranked[0].score - 0.1) {
      return {
        status: "needs_input",
        reason: "More than one ticket could be the carer ticket.",
        ranked
      };
    }
    return { status: "matched", candidate: ranked[0], ranked };
  }

  function isCarerTicketName(value) {
    const text = String(value || "");
    return /\bcarers?\b/i.test(text) || (/\badult\b/i.test(text) && /50\s*%/i.test(text));
  }

  function chooseCarerPriceCode(optionNames, sourcePriceCode, preferredSuffix) {
    const names = (optionNames || []).map((value) => String(value || "").trim()).filter(Boolean);
    const matches = names.filter(isCarerTicketName);
    const preferred = `${String(sourcePriceCode || "").trim()} ${String(preferredSuffix || "").trim()}`.trim();
    const exact = matches.find((name) => name === preferred);
    if (exact) return { status: "matched", value: exact, matches };
    if (matches.length === 1) return { status: "matched", value: matches[0], matches };
    if (!matches.length) {
      return {
        status: "blocked",
        reason: "No price code containing both Adult and 50%, or the word carer, is available.",
        matches
      };
    }
    return {
      status: "needs_input",
      reason: "More than one possible carer price code is available and none is the exact preferred match.",
      matches
    };
  }

  function isEtixUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        (url.hostname === "etix.com" || url.hostname.endsWith(".etix.com"));
    } catch (_error) {
      return false;
    }
  }

  function orderRoutingDecision(stage, currentOrder, requestedOrder, searchStarted) {
    if (!requestedOrder) return "not_applicable";
    const onOrderDetails = stage === "order_details" || stage === "order_details_after_reclass";
    if (onOrderDetails && currentOrder === requestedOrder) return "ready";
    if (stage === "order_search_results" && searchStarted) return "open_search_result";
    return "search";
  }

  function validateWorkflowProfile(profile) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return { ok: false, error: "A workflow profile is required for live actions." };
    }
    if (!Array.isArray(profile.hosts) || !profile.hosts.length ||
        profile.hosts.some((host) => typeof host !== "string" ||
          !(host === "etix.com" || host.endsWith(".etix.com")))) {
      return { ok: false, error: "Profile hosts must contain Etix host names." };
    }
    if (profile.version === 2 && profile.workflowKind === "etix_carer_reclass") {
      if (!Array.isArray(profile.sourcePriceCodes) || !profile.sourcePriceCodes.length ||
          profile.sourcePriceCodes.some((value) => typeof value !== "string" || !value.trim())) {
        return { ok: false, error: "The carer workflow needs at least one source price code." };
      }
      if (typeof profile.targetSuffix !== "string" || !profile.targetSuffix.trim()) {
        return { ok: false, error: "The carer workflow needs a target price-code suffix." };
      }
      if (typeof profile.note !== "string" || !profile.note.trim() || profile.note.length > 120) {
        return { ok: false, error: "The carer workflow needs a note of 1–120 characters." };
      }
      if (profile.dependentTicketAcknowledgementName !== undefined &&
          (typeof profile.dependentTicketAcknowledgementName !== "string" ||
            !profile.dependentTicketAcknowledgementName.trim())) {
        return { ok: false, error: "The dependent-ticket acknowledgement name is invalid." };
      }
      return { ok: true, value: profile };
    }
    if (profile.version !== 1) {
      return { ok: false, error: "Unsupported workflow profile version." };
    }
    const required = [
      "orderEvidenceSelector",
      "ticketRowSelector",
      "ticketNameSelector",
      "discountButtonSelector",
      "confirmationButtonSelector",
      "successSelector"
    ];
    for (const key of required) {
      if (typeof profile[key] !== "string" || !profile[key].trim()) {
        return { ok: false, error: `Workflow profile is missing ${key}.` };
      }
    }
    return { ok: true, value: profile };
  }

  function mergeSettings(stored) {
    const enhancements = stored && stored.enhancements;
    return {
      ...DEFAULT_SETTINGS,
      ...(stored || {}),
      colourBlindMode: COLOUR_BLIND_MODES.some((mode) => mode.id === (stored && stored.colourBlindMode))
        ? stored.colourBlindMode : DEFAULT_SETTINGS.colourBlindMode,
      ticketAliases: Array.isArray(stored && stored.ticketAliases)
        ? stored.ticketAliases.filter(Boolean)
        : DEFAULT_ALIASES,
      enhancements: {...DEFAULT_SETTINGS.enhancements, ...Object.fromEntries(Object.entries(
        enhancements && typeof enhancements === "object" && !Array.isArray(enhancements)
          ? enhancements : {}
      ).map(([id, enabled]) => [id, enabled === true]))}
    };
  }

  function parsePerformanceDateTime(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}:\d{2})/);
    if (match) {
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
      return {
        year,
        date: new Intl.DateTimeFormat("en-GB", {
          day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
        }).format(date),
        time: match[4]
      };
    }
    match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}:\d{2})/);
    if (match) return { year: Number(match[3]), date: `${Number(match[1])} ${match[2]} ${match[3]}`, time: match[4] };
    return null;
  }

  function ticketTypeLabel(priceCode) {
    const value = String(priceCode || "").trim();
    if (/lap infant/i.test(value)) return "Adult with lap infant";
    if (/^child\b/i.test(value)) return "Child";
    if (/^adult\b/i.test(value)) return "Adult";
    if (/comp|carer|companion/i.test(value)) return "Carer/Companion";
    return value.replace(/\s+(?:10|25|50)%\s+Off$/i, "") || "Ticket";
  }

  function joinWithAnd(values) {
    if (values.length <= 1) return values[0] || "";
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
  }

  function formatCustomerReply(bookings) {
    const numbers = bookings.map((booking) => booking.bookingNumber);
    const opening = numbers.length === 1
      ? `Your booking number is: ${numbers[0]}.`
      : `You have multiple booking numbers this year: ${joinWithAnd(numbers)}.`;
    const details = [];
    for (const booking of bookings) {
      if (bookings.length > 1) details.push(`Booking ${booking.bookingNumber}:`);
      for (const attendance of booking.attendance) {
        const ticketText = Object.entries(attendance.tickets)
          .map(([label, count]) => `${label} x${count}`)
          .join(", ");
        details.push(`Ticket details: ${ticketText}.`);
        details.push(`Attending on: ${attendance.performanceDate} at ${attendance.performanceTime} at ${attendance.venue}.`);
      }
      if (bookings.length > 1) details.push("");
    }
    return [
      opening,
      "",
      ...details,
      "I have resent your confirmation to your email. Look for an email from Etix.com"
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const api = {
    DEFAULT_ALIASES,
    DEFAULT_WORKFLOW_PROFILE,
    DEFAULT_SETTINGS,
    ENHANCEMENTS,
    COLOUR_BLIND_MODES,
    normalizeText,
    validateOrderNumber,
    validateEmailAddress,
    validateOrderLookup,
    validateQuantity,
    PARKING_TYPES,
    validateParkingRequest,
    parkingDateKey,
    parkingVenueMatches,
    chooseParkingOption,
    parkingOrderTarget,
    redactText,
    scoreTicketCandidate,
    chooseTicketCandidate,
    isCarerTicketName,
    chooseCarerPriceCode,
    isEtixUrl,
    orderRoutingDecision,
    validateWorkflowProfile,
    mergeSettings,
    parsePerformanceDateTime,
    ticketTypeLabel,
    joinWithAnd,
    formatCustomerReply
  };

  globalScope.EtixCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
