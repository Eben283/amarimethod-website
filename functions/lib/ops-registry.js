// Amari Ops path registry — the board only shows registered rows.
// Paths emit OpsEvents; dependencies are judged from live signals (KV / workers).

export const OPS_SEVERITY = Object.freeze({
  MONEY: "money",
  BOOKING: "booking",
  WRONG_MESSAGE: "wrong_message",
  INFRA: "infra",
});

export const PATH_ASSESSMENT_PAID_BOOK = "assessment_paid_book";

/** @type {ReadonlyArray<{id:string,label:string,kind:'path'|'dependency',severity:string,hops:Array<{id:string,label:string}>,laws:string[],instrumentation:'full'|'partial'|'planned'}>} */
export const OPS_REGISTRY = Object.freeze([
  Object.freeze({
    id: PATH_ASSESSMENT_PAID_BOOK,
    label: "Assessment · paid → book",
    kind: "path",
    severity: OPS_SEVERITY.MONEY,
    hops: Object.freeze([
      Object.freeze({ id: "create_checkout", label: "Checkout created" }),
      Object.freeze({ id: "payment", label: "Payment" }),
      Object.freeze({ id: "purchase_webhook", label: "Purchase webhook" }),
      Object.freeze({ id: "create_appointment", label: "Create appointment" }),
    ]),
    laws: Object.freeze(["L_paid_assessment_has_appt", "L_webhook_book_attempt_logged"]),
    instrumentation: "full",
  }),
  Object.freeze({
    id: "intro_paid_book",
    label: "Intro paid → book",
    kind: "path",
    severity: OPS_SEVERITY.MONEY,
    hops: Object.freeze([
      Object.freeze({ id: "create_checkout", label: "Checkout created" }),
      Object.freeze({ id: "payment", label: "Payment" }),
      Object.freeze({ id: "purchase_webhook", label: "Purchase webhook" }),
      Object.freeze({ id: "create_appointment", label: "Create appointment" }),
    ]),
    laws: Object.freeze([]),
    instrumentation: "partial",
  }),
  Object.freeze({
    id: "pos_card_fulfill",
    label: "Staff POS · charge → fulfill",
    kind: "path",
    severity: OPS_SEVERITY.MONEY,
    hops: Object.freeze([
      Object.freeze({ id: "pos_charge", label: "POS charge" }),
      Object.freeze({ id: "pos_webhook", label: "POS webhook" }),
      Object.freeze({ id: "fulfill", label: "Fulfill" }),
    ]),
    laws: Object.freeze(["L_pos_paid_fulfilled"]),
    instrumentation: "partial",
  }),
  Object.freeze({
    id: "ghl_token",
    label: "GHL token",
    kind: "dependency",
    severity: OPS_SEVERITY.INFRA,
    hops: Object.freeze([]),
    laws: Object.freeze([]),
    instrumentation: "full",
  }),
  Object.freeze({
    id: "series_reconcile",
    label: "Series reconcile",
    kind: "dependency",
    severity: OPS_SEVERITY.INFRA,
    hops: Object.freeze([]),
    laws: Object.freeze([]),
    instrumentation: "full",
  }),
  Object.freeze({
    id: "daily_audit",
    label: "Daily audit",
    kind: "dependency",
    severity: OPS_SEVERITY.INFRA,
    hops: Object.freeze([]),
    laws: Object.freeze([]),
    instrumentation: "full",
  }),
  Object.freeze({
    id: "partner_refresh",
    label: "Partner activity refresh",
    kind: "dependency",
    severity: OPS_SEVERITY.INFRA,
    hops: Object.freeze([]),
    laws: Object.freeze([]),
    instrumentation: "full",
  }),
  Object.freeze({
    id: "crm_mirror",
    label: "CRM mirror",
    kind: "dependency",
    severity: OPS_SEVERITY.INFRA,
    hops: Object.freeze([]),
    laws: Object.freeze([]),
    instrumentation: "planned",
  }),
]);

export function registryPath(pathId) {
  return OPS_REGISTRY.find((p) => p.id === pathId) || null;
}

export function registryPathIds() {
  return OPS_REGISTRY.filter((p) => p.kind === "path").map((p) => p.id);
}
