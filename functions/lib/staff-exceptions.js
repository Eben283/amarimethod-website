// Shape ops:err (+ future exception sources) into staff-facing triage rows.
// Plain sentences + recovery actions. No AI.

/**
 * @typedef {{
 *   id: string,
 *   kind: 'break' | 'money' | 'ops',
 *   title: string,
 *   blurb: string,
 *   source: string,
 *   at: string | null,
 *   contactId: string | null,
 *   product: string | null,
 *   actions: Array<'open_client' | 'open_ghl' | 'open_balances' | 'open_pos' | 'dismiss'>,
 * }} TriageItem
 */

/**
 * Turn a recorded ops:err entry into a triage card humans can act on.
 * @param {{ key?: string, source?: string, summary?: string, detail?: Record<string, unknown>, at?: string }} entry
 * @returns {TriageItem}
 */
export function humanizeOpsError(entry) {
  const source = String(entry.source || "unknown");
  const summary = String(entry.summary || "Something failed in production");
  const detail = entry.detail && typeof entry.detail === "object" ? entry.detail : {};
  const contactId = typeof detail.contactId === "string" && detail.contactId.trim()
    ? detail.contactId.trim()
    : null;
  const product = typeof detail.product === "string" && detail.product.trim()
    ? detail.product.trim()
    : (typeof detail.pkg === "string" ? detail.pkg : null);

  let kind = "ops";
  let title = summary;
  let blurb = sourceLabel(source);

  if (/appointment did not auto-book/i.test(summary) || /failed to auto-book/i.test(summary)) {
    kind = "break";
    title = product
      ? `Paid for ${product}, but no appointment was created`
      : "Payment received, but no appointment was created";
    blurb = "Book the visit on their calendar, then mark handled.";
  } else if (/sessions_remaining NOT updated/i.test(summary) || /field update failed/i.test(summary)) {
    kind = "money";
    title = product
      ? `Paid for ${product}, but session balance was not updated`
      : "Payment received, but session balance was not updated";
    blurb = "Check their package fields / Balances, then mark handled.";
  } else if (/Contact fetch failed after payment/i.test(summary)) {
    kind = "break";
    title = "Payment received, but contact could not be loaded to fulfill";
    blurb = "Open the person (or find them by email in Clients) and finish fulfillment.";
  } else if (/staff-pos-fulfill/i.test(source) || /fulfill/i.test(summary)) {
    kind = "money";
    title = summary;
    blurb = "Open POS / the client and retry fulfillment if needed.";
  } else if (/consistency violation/i.test(summary)) {
    kind = "money";
    title = "Session balance looked inconsistent after a purchase";
    blurb = "Review Balances for this person.";
  }

  /** @type {TriageItem['actions']} */
  const actions = ["dismiss"];
  if (contactId) {
    actions.unshift("open_client", "open_ghl");
  }
  if (kind === "money") {
    actions.splice(contactId ? 2 : 0, 0, "open_balances");
  }
  if (/pos/i.test(source)) {
    actions.splice(contactId ? 2 : 0, 0, "open_pos");
  }

  return {
    id: String(entry.key || ""),
    kind,
    title,
    blurb,
    source,
    at: entry.at || null,
    contactId,
    product,
    actions: unique(actions),
  };
}

function sourceLabel(source) {
  if (source === "ghl-purchase-webhook") return "Purchase webhook";
  if (source === "ghl-invoice-webhook") return "Invoice webhook";
  if (source === "staff-pos-fulfill") return "Staff POS fulfill";
  if (source === "appointment-webhook") return "Appointment webhook";
  return source;
}

function unique(arr) {
  return [...new Set(arr)];
}

export function isOpsErrKey(key) {
  return typeof key === "string" && key.startsWith("ops:err:");
}
