import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { confirmationForSeries, recordSeriesPurchase } from "./purchase-confirmations.js";
import { sendConversationMessage } from "./ghl-send.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");

// Fake D1 covering upgrade_offer_timers + purchase_confirmations + automation_events.
function fakeD1() {
  const timers = new Map();
  const confirms = new Map();
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO upgrade_offer_timers/.test(sql)) {
        if (timers.has(a[0])) return { meta: { changes: 0 } };
        timers.set(a[0], { contact_id: a[0], scheduled_at: a[1], due_at: a[2], status: a[3] });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE upgrade_offer_timers SET status = 'cancelled'/.test(sql)) {
        const t = timers.get(a[0]);
        if (t && t.status === "pending") { t.status = "cancelled"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO purchase_confirmations/.test(sql)) {
        const [ref, contact_id, series_type, status, ts] = a;
        if (confirms.has(ref)) return { meta: { changes: 0 } };
        confirms.set(ref, { ref, contact_id, series_type, status, ts });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE purchase_confirmations SET status = \?/.test(sql)) {
        const [status, ref] = a;
        const c = confirms.get(ref);
        if (c) { c.status = status; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) { events.push(a); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    },
    async all() { return { results: [] }; },
  });
  return { prepare, _timers: timers, _confirms: confirms, _events: events };
}

let context;
beforeEach(() => {
  context = { env: { AUTOMATION_DB: fakeD1() }, waitUntil: () => {} };
  vi.clearAllMocks();
});

describe("confirmationForSeries — verbatim invoice-confirmation copy, branch on the reconcile result", () => {
  it("4-session template exists and does NOT mention Living Practice", () => {
    const t = confirmationForSeries("4-session");
    expect(t.subject).toBe("Your 4-Session Series is confirmed, {{contact.first_name}}");
    expect(t.body).toContain("Your 4-Session Series is confirmed.");
    expect(t.body).not.toMatch(/Living Practice/);
  });

  it("8-session template mentions Living Practice access (the only one that does)", () => {
    const t = confirmationForSeries("8-session");
    expect(t.subject).toBe("Your 8-Session Series is Confirmed, {{contact.first_name}}");
    expect(t.body).toContain("your Living Practice access is included");
  });

  it("Single/unknown series types get NO email (documented silent fall-through)", () => {
    expect(confirmationForSeries("Single")).toBeNull();
    expect(confirmationForSeries("")).toBeNull();
    expect(confirmationForSeries(null)).toBeNull();
  });

  it("an 8-UPGRADE order gets the verified upgrade variant with the initial-credit line (MASTER C2b, confirmed live 2026-07-12)", () => {
    const t = confirmationForSeries("8-session", "8-upgrade");
    expect(t.key).toBe("confirm-8-upgrade");
    expect(t.body).toContain("your initial session credit has been applied");
    expect(t.body).toContain("Living Practice access is included");
    // unknown/absent classification falls back to the seriesType template
    expect(confirmationForSeries("8-session", "8-series").key).toBe("confirm-8-session");
    expect(confirmationForSeries("8-session").key).toBe("confirm-8-session");
  });
});

describe("recordSeriesPurchase — the one seam both webhooks call", () => {
  const args = { contactId: "cont_1", seriesType: "4-session", ref: "inv:INV-100", source: "invoice" };

  it("cancels a pending upgrade-offer timer (the money-facing failure this prevents)", async () => {
    const db = context.env.AUTOMATION_DB;
    db._timers.set("cont_1", { contact_id: "cont_1", scheduled_at: NOW, due_at: NOW + 1, status: "pending" });
    const res = await recordSeriesPurchase(context, args, NOW);
    expect(res.ok).toBe(true);
    expect(res.offerCancelled).toBe(true);
    expect(db._timers.get("cont_1").status).toBe("cancelled");
  });

  it("shadow (default): records would_send + logs, NEVER calls the send adapter", async () => {
    const res = await recordSeriesPurchase(context, args, NOW);
    expect(res.confirmation).toBe("would_send");
    expect(sendConversationMessage).not.toHaveBeenCalled();
    const db = context.env.AUTOMATION_DB;
    expect(db._confirms.get("inv:INV-100").status).toBe("would_send");
    expect(db._events.some((e) => e[6] === "would_send")).toBe(true); // action column
  });

  it("is idempotent per ref — a webhook retry never double-records (brief RED test)", async () => {
    await recordSeriesPurchase(context, args, NOW);
    const res = await recordSeriesPurchase(context, args, NOW);
    expect(res.confirmation).toBe("duplicate");
    expect(context.env.AUTOMATION_DB._events.filter((e) => e[6] === "would_send")).toHaveLength(1);
  });

  it("Single series type: cancel still runs, no confirmation recorded as sendable", async () => {
    const db = context.env.AUTOMATION_DB;
    db._timers.set("cont_1", { contact_id: "cont_1", scheduled_at: NOW, due_at: NOW + 1, status: "pending" });
    const res = await recordSeriesPurchase(context, { ...args, seriesType: "Single" }, NOW);
    expect(res.offerCancelled).toBe(true);
    expect(res.confirmation).toBe("no_template");
    expect(sendConversationMessage).not.toHaveBeenCalled();
  });

  it("missing AUTOMATION_DB binding: graceful skip, never throws (deploy-safe before the D1 exists)", async () => {
    const res = await recordSeriesPurchase({ env: {} }, args, NOW);
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe("no-binding");
  });

  it("a thrown D1 error is contained — returns ok:false, never propagates into the webhook", async () => {
    const broken = { prepare: () => { throw new Error("d1 down"); } };
    const res = await recordSeriesPurchase({ env: { AUTOMATION_DB: broken } }, args, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/d1 down/);
  });
});
