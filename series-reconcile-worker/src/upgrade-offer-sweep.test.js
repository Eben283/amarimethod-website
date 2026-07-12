import { describe, it, expect, vi, beforeEach } from "vitest";
import { UPGRADE_OFFER_EMAIL, sweepUpgradeOffers } from "./upgrade-offer-sweep.js";
import { FIELD_IDS } from "./reconcile.js";

const NOW = Date.parse("2026-07-15T10:00:00-07:00");
const DAY = 86400000;

// Fake AUTOMATION_DB (upgrade_offer_timers + automation_events), matching upgrade-offer.js SQL.
function fakeD1(rows = []) {
  const timers = new Map(rows.map((r) => [r.contact_id, { ...r }]));
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/UPDATE upgrade_offer_timers SET status = 'cancelled'/.test(sql)) {
        const t = timers.get(a[0]);
        if (t && t.status === "pending") { t.status = "cancelled"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/UPDATE upgrade_offer_timers SET status = \?/.test(sql)) {
        const t = timers.get(a[1]);
        if (t) { t.status = a[0]; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) { events.push(a); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    },
    async all() {
      const [nowMs, limit] = this._args;
      return {
        results: [...timers.values()]
          .filter((t) => t.status === "pending" && t.due_at <= nowMs)
          .sort((x, y) => x.due_at - y.due_at)
          .slice(0, limit),
      };
    },
  });
  return { prepare, _timers: timers, _events: events };
}

const dueRow = (contactId = "cont_1") => ({
  contact_id: contactId, scheduled_at: NOW - 3 * DAY, due_at: NOW, status: "pending",
});

const cleanContact = () => ({
  id: "cont_1",
  tags: ["quiz submitted"],
  customFields: [{ id: FIELD_IDS.series_type, value: "" }],
});

function deps(over = {}) {
  return {
    getContact: vi.fn().mockResolvedValue(cleanContact()),
    send: vi.fn().mockResolvedValue({ success: true }),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("UPGRADE_OFFER_EMAIL — the 2026-06-17 post-scrub copy, verbatim", () => {
  it("carries the live subject, sender, and both upgrade payment links", () => {
    expect(UPGRADE_OFFER_EMAIL.subject).toBe("Ready to go deeper");
    expect(UPGRADE_OFFER_EMAIL.from).toEqual({ name: "Garrett", email: "garrett@amarimethod.com" });
    expect(UPGRADE_OFFER_EMAIL.body).toContain("https://link.amarimethod.com/payment-link/699873a81a8400115e0381db");
    expect(UPGRADE_OFFER_EMAIL.body).toContain("https://link.amarimethod.com/payment-link/699873e31a840007c0038223");
  });

  it("never regresses to the retired pre-scrub copy", () => {
    expect(UPGRADE_OFFER_EMAIL.body).not.toMatch(/short window/i); // manufactured-urgency line stays dead
    expect(UPGRADE_OFFER_EMAIL.body).not.toMatch(/Dr\./);
    expect(UPGRADE_OFFER_EMAIL.body).not.toMatch(/reach out personally/i);
  });
});

describe("sweepUpgradeOffers — shadow (default): observes, never sends", () => {
  it("a due timer with a still-clean contact logs would_send and leaves the queue", async () => {
    const db = fakeD1([dueRow()]);
    const d = deps();
    const counts = await sweepUpgradeOffers({ AUTOMATION_DB: db }, NOW, d);
    expect(counts.would_send).toBe(1);
    expect(d.send).not.toHaveBeenCalled();
    expect(db._timers.get("cont_1").status).toBe("would_send");
    expect(db._events.some((e) => e[6] === "would_send")).toBe(true);
  });

  it("re-checks the guard at fire time: a series bought in the window suppresses the send (missed-cancel safety)", async () => {
    const db = fakeD1([dueRow()]);
    const d = deps({
      getContact: vi.fn().mockResolvedValue({
        ...cleanContact(),
        customFields: [{ id: FIELD_IDS.series_type, value: "4-session" }],
      }),
    });
    const counts = await sweepUpgradeOffers({ AUTOMATION_DB: db }, NOW, d);
    expect(counts.suppressed).toBe(1);
    expect(d.send).not.toHaveBeenCalled();
    expect(db._timers.get("cont_1").status).toBe("suppressed");
  });

  it("a partner-track tag acquired in the window also suppresses", async () => {
    const db = fakeD1([dueRow()]);
    const d = deps({
      getContact: vi.fn().mockResolvedValue({ ...cleanContact(), tags: ["ambassador-prospect"] }),
    });
    const counts = await sweepUpgradeOffers({ AUTOMATION_DB: db }, NOW, d);
    expect(counts.suppressed).toBe(1);
  });

  it("a failed contact read leaves the timer pending (retried next hour), logs the error, keeps sweeping", async () => {
    const db = fakeD1([dueRow("cont_1"), dueRow("cont_2")]);
    const d = deps({
      getContact: vi.fn()
        .mockRejectedValueOnce(new Error("ghl 500"))
        .mockResolvedValue(cleanContact()),
    });
    const counts = await sweepUpgradeOffers({ AUTOMATION_DB: db }, NOW, d);
    expect(counts.errors).toBe(1);
    expect(counts.would_send).toBe(1);
    expect(db._timers.get("cont_1").status).toBe("pending");
  });

  it("no AUTOMATION_DB binding: clean no-op (deploy-safe before the shared D1 exists)", async () => {
    const counts = await sweepUpgradeOffers({}, NOW, deps());
    expect(counts).toEqual({ skipped: "no-binding" });
  });

  it("nothing due: zero counts, zero reads", async () => {
    const db = fakeD1([{ ...dueRow(), due_at: NOW + DAY }]);
    const d = deps();
    const counts = await sweepUpgradeOffers({ AUTOMATION_DB: db }, NOW, d);
    expect(counts.would_send).toBe(0);
    expect(d.getContact).not.toHaveBeenCalled();
  });
});
