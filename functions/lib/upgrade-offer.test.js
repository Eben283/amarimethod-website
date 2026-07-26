import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldScheduleUpgradeOffer, scheduleUpgradeOffer, cancelUpgradeOffer,
  loadDueOffers, markOffer, appendAutomationEvent, UPGRADE_OFFER_DELAY_MS,
} from "./upgrade-offer.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");
const DAY = 86400000;

// Minimal stateful fake D1 for upgrade_offer_timers + automation_events.
function fakeD1() {
  const timers = new Map();
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO upgrade_offer_timers/.test(sql)) {
        const [contact_id, scheduled_at, due_at, status] = a;
        if (timers.has(contact_id)) return { meta: { changes: 0 } };
        timers.set(contact_id, { contact_id, scheduled_at, due_at, status });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE upgrade_offer_timers SET status = 'cancelled'/.test(sql)) {
        const [contact_id] = a;
        const t = timers.get(contact_id);
        if (t && t.status === "pending") { t.status = "cancelled"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/UPDATE upgrade_offer_timers SET status = \?/.test(sql)) {
        const [status, contact_id] = a;
        const t = timers.get(contact_id);
        if (t) { t.status = status; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) {
        events.push(a);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
    async all() {
      const [nowMs, limit] = this._args;
      if (/FROM upgrade_offer_timers/.test(sql)) {
        return {
          results: [...timers.values()]
            .filter((t) => t.status === "pending" && t.due_at <= nowMs)
            .sort((x, y) => x.due_at - y.due_at)
            .slice(0, limit),
        };
      }
      return { results: [] };
    },
  });
  return { prepare, _timers: timers, _events: events };
}

let db;
beforeEach(() => { db = fakeD1(); });

describe("shouldScheduleUpgradeOffer — the GHL entry condition, pure", () => {
  it("schedules when series_type is empty and tags are clean", () => {
    expect(shouldScheduleUpgradeOffer({ seriesType: "", tags: ["quiz submitted"] })).toBe(true);
    expect(shouldScheduleUpgradeOffer({ seriesType: null, tags: [] })).toBe(true);
    expect(shouldScheduleUpgradeOffer({ seriesType: "none", tags: [] })).toBe(true); // dropdown default counts as empty
  });

  it("does not schedule for series holders or partner-track contacts", () => {
    expect(shouldScheduleUpgradeOffer({ seriesType: "4-session", tags: [] })).toBe(false);
    expect(shouldScheduleUpgradeOffer({ seriesType: "8-session", tags: [] })).toBe(false);
    expect(shouldScheduleUpgradeOffer({ seriesType: "", tags: ["ambassador-prospect"] })).toBe(false);
    expect(shouldScheduleUpgradeOffer({ seriesType: "", tags: ["Affiliate-Partner"] })).toBe(false); // case-insensitive
  });
});

describe("scheduleUpgradeOffer — write-once 3-day timer", () => {
  it("creates one pending row due 3 days out", async () => {
    const { created } = await scheduleUpgradeOffer(db, "cont_1", NOW);
    expect(created).toBe(true);
    const row = db._timers.get("cont_1");
    expect(row.status).toBe("pending");
    expect(row.due_at).toBe(NOW + UPGRADE_OFFER_DELAY_MS);
    expect(UPGRADE_OFFER_DELAY_MS).toBe(3 * DAY);
  });

  it("re-scheduling is a no-op (duplicate sessions_completed→1 events → one row)", async () => {
    await scheduleUpgradeOffer(db, "cont_1", NOW);
    const { created } = await scheduleUpgradeOffer(db, "cont_1", NOW + 1000);
    expect(created).toBe(false);
    expect(db._timers.size).toBe(1);
  });
});

describe("cancelUpgradeOffer — the money-facing cancel (idempotent)", () => {
  it("cancels a pending timer; the row never loads as due again", async () => {
    await scheduleUpgradeOffer(db, "cont_1", NOW);
    const { cancelled } = await cancelUpgradeOffer(db, "cont_1");
    expect(cancelled).toBe(true);
    expect(await loadDueOffers(db, NOW + 30 * DAY)).toHaveLength(0);
  });

  it("cancel of nothing is a no-op; double-cancel is a no-op", async () => {
    expect((await cancelUpgradeOffer(db, "stranger")).cancelled).toBe(false);
    await scheduleUpgradeOffer(db, "cont_1", NOW);
    await cancelUpgradeOffer(db, "cont_1");
    expect((await cancelUpgradeOffer(db, "cont_1")).cancelled).toBe(false);
  });
});

describe("loadDueOffers / markOffer", () => {
  it("returns only pending timers whose 3 days have elapsed", async () => {
    await scheduleUpgradeOffer(db, "early", NOW);
    await scheduleUpgradeOffer(db, "late", NOW + 2 * DAY);
    expect(await loadDueOffers(db, NOW + 2 * DAY)).toHaveLength(0);
    const due = await loadDueOffers(db, NOW + 3 * DAY);
    expect(due.map((t) => t.contact_id)).toEqual(["early"]);
  });

  it("a marked timer (sent/suppressed/would_send) leaves the due queue", async () => {
    await scheduleUpgradeOffer(db, "cont_1", NOW);
    await markOffer(db, "cont_1", "would_send");
    expect(await loadDueOffers(db, NOW + 30 * DAY)).toHaveLength(0);
    expect(db._timers.get("cont_1").status).toBe("would_send");
  });
});

describe("appendAutomationEvent", () => {
  it("writes to the shared automation_events log with engine purchase", async () => {
    await appendAutomationEvent(db, { ts: NOW, flowKey: "upgrade-offer", contactId: "cont_1", action: "scheduled", outcome: "scheduled" });
    expect(db._events).toHaveLength(1);
    expect(db._events[0][1]).toBe("purchase"); // engine column
  });
});
