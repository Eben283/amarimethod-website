import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-notify.js", () => ({
  notifyOpsFlip: vi.fn(async () => ({ sent: true })),
}));

import {
  recordOpsEvent,
  openOpsIncident,
  resolveOpsIncident,
  listOpsEvents,
} from "./ops-events.js";
import { notifyOpsFlip } from "./ops-notify.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

function fakeD1() {
  const events = [];
  const incidents = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) {
      this._args = a;
      return this;
    },
    async run() {
      const a = this._args;
      if (/INSERT INTO ops_events/.test(sql)) {
        events.push({
          id: a[0],
          at: a[1],
          at_ms: a[2],
          path_id: a[3],
          hop_id: a[4],
          outcome: a[5],
          reason_code: a[6],
          summary: a[7],
          correlation_id: a[8],
          contact_id: a[9],
          person_label: a[10],
          condition_expected: a[13],
          condition_observed: a[14],
          money_json: a[16],
          source: a[17],
        });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO ops_incidents/.test(sql)) {
        incidents.push({
          id: a[0],
          path_id: a[1],
          status: a[2],
          severity: a[3],
          opened_at: a[4],
          opened_at_ms: a[5],
          last_alerted_at: a[7],
          title: a[8],
          contact_id: a[9],
          person_label: a[10],
          correlation_id: a[11],
          failed_hop_id: a[12],
          event_ids_json: a[13],
          law_id: a[14],
        });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE ops_incidents SET event_ids_json/.test(sql)) {
        const inc = incidents.find((i) => i.id === a[2]);
        if (inc) {
          inc.event_ids_json = a[0];
          if (a[1]) inc.failed_hop_id = a[1];
        }
        return { meta: { changes: inc ? 1 : 0 } };
      }
      if (/UPDATE ops_incidents SET last_alerted_at/.test(sql)) {
        const inc = incidents.find((i) => i.id === a[1]);
        if (inc) inc.last_alerted_at = a[0];
        return { meta: { changes: 1 } };
      }
      if (/UPDATE ops_incidents SET status = 'resolved'/.test(sql)) {
        let n = 0;
        for (const inc of incidents) {
          if (inc.path_id !== a[1] || inc.status !== "open") continue;
          if (sql.includes("correlation_id") && inc.correlation_id === a[2]) {
            inc.status = "resolved";
            inc.resolved_at = a[0];
            n += 1;
          } else if (sql.includes("contact_id") && !sql.includes("correlation_id") && inc.contact_id === a[2]) {
            inc.status = "resolved";
            inc.resolved_at = a[0];
            n += 1;
          }
        }
        return { meta: { changes: n } };
      }
      return { meta: { changes: 0 } };
    },
    async first() {
      const a = this._args;
      if (/status = 'open' AND correlation_id/.test(sql)) {
        return (
          incidents.find(
            (i) => i.path_id === a[0] && i.status === "open" && i.correlation_id === a[1],
          ) || null
        );
      }
      if (/status = 'open' AND contact_id/.test(sql)) {
        return (
          incidents.find(
            (i) => i.path_id === a[0] && i.status === "open" && i.contact_id === a[1],
          ) || null
        );
      }
      return null;
    },
    async all() {
      const a = this._args;
      let rows = events.slice();
      if (sql.includes("correlation_id = ?")) {
        rows = rows.filter((e) => e.correlation_id === a[0]);
      } else if (sql.includes("path_id = ? AND contact_id = ?")) {
        rows = rows.filter((e) => e.path_id === a[0] && e.contact_id === a[1]);
      } else if (sql.includes("path_id = ?")) {
        rows = rows.filter((e) => e.path_id === a[0]);
      }
      rows.sort((x, y) => y.at_ms - x.at_ms);
      const limit = a[a.length - 1];
      return { results: rows.slice(0, limit) };
    },
  });
  return { prepare, _events: events, _incidents: incidents };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordOpsEvent", () => {
  it("writes a shaped hop row to AUTOMATION_DB", async () => {
    const db = fakeD1();
    const res = await recordOpsEvent(
      { AUTOMATION_DB: db },
      {
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        hopId: "create_appointment",
        outcome: "fail",
        summary: "Paid Assessment, no appointment",
        contactId: "c1",
        personLabel: "Holly Brinkman",
        correlationId: "order:o1",
        condition: { expected: "slot iso present", observed: "null" },
        money: { product: "Amari Assessment", amountCents: 2900 },
        source: "ghl-purchase-webhook",
      },
    );
    expect(res.recorded).toBe(true);
    expect(db._events).toHaveLength(1);
    expect(db._events[0]).toMatchObject({
      path_id: PATH_ASSESSMENT_PAID_BOOK,
      hop_id: "create_appointment",
      outcome: "fail",
      contact_id: "c1",
      condition_expected: "slot iso present",
      condition_observed: "null",
    });
  });

  it("missing AUTOMATION_DB and KV: graceful skip, never throws", async () => {
    const res = await recordOpsEvent({}, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "purchase_webhook",
      outcome: "ok",
      summary: "x",
    });
    expect(res).toEqual({ recorded: false, reason: "no-store" });
  });

  it("missing AUTOMATION_DB but has KV: records trail for /ops", async () => {
    const store = new Map();
    const env = {
      PORTAL_KV: {
        async get(key, type) {
          const v = store.get(key);
          if (v == null) return null;
          return type === "json" ? JSON.parse(v) : v;
        },
        async put(key, value) {
          store.set(key, value);
        },
      },
    };
    const res = await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "purchase_webhook",
      outcome: "ok",
      summary: "paid via kv trail",
    });
    expect(res.recorded).toBe(true);
    expect(res.via).toBe("kv");
    const rows = await listOpsEvents(env, { pathId: PATH_ASSESSMENT_PAID_BOOK });
    expect(rows[0].summary).toBe("paid via kv trail");
  });
});

describe("openOpsIncident / resolve", () => {
  it("opens once and alerts on flip; second open attaches without re-alert", async () => {
    const db = fakeD1();
    const env = { AUTOMATION_DB: db };
    const first = await openOpsIncident(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      title: "Paid Assessment, no appointment",
      correlationId: "order:o1",
      contactId: "c1",
      eventIds: ["evt_1"],
      failedHopId: "create_appointment",
      lawId: "L_paid_assessment_has_appt",
    }, { context: { env }, alert: true });
    expect(first.opened).toBe(true);
    expect(first.flipped).toBe(true);
    expect(notifyOpsFlip).toHaveBeenCalledTimes(1);

    const second = await openOpsIncident(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      title: "Paid Assessment, no appointment",
      correlationId: "order:o1",
      contactId: "c1",
      eventIds: ["evt_2"],
    }, { context: { env }, alert: true });
    expect(second.attached).toBe(true);
    expect(second.flipped).toBe(false);
    expect(notifyOpsFlip).toHaveBeenCalledTimes(1);
    expect(db._incidents).toHaveLength(1);
  });

  it("resolve closes open incidents for correlation", async () => {
    const db = fakeD1();
    const env = { AUTOMATION_DB: db };
    await openOpsIncident(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      title: "x",
      correlationId: "order:o1",
      contactId: "c1",
    }, { alert: false });
    const r = await resolveOpsIncident(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      correlationId: "order:o1",
    });
    expect(r.resolved).toBe(1);
    expect(db._incidents[0].status).toBe("resolved");
  });
});

describe("listOpsEvents", () => {
  it("returns newest-first shaped events for a path", async () => {
    const db = fakeD1();
    const env = { AUTOMATION_DB: db };
    await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "purchase_webhook",
      outcome: "ok",
      summary: "a",
      at: "2026-07-29T10:00:00.000Z",
      atMs: Date.parse("2026-07-29T10:00:00.000Z"),
    });
    await recordOpsEvent(env, {
      pathId: PATH_ASSESSMENT_PAID_BOOK,
      hopId: "create_appointment",
      outcome: "fail",
      summary: "b",
      at: "2026-07-29T10:01:00.000Z",
      atMs: Date.parse("2026-07-29T10:01:00.000Z"),
    });
    const rows = await listOpsEvents(env, { pathId: PATH_ASSESSMENT_PAID_BOOK });
    expect(rows.map((r) => r.summary)).toEqual(["b", "a"]);
    expect(rows[0].hopId).toBe("create_appointment");
  });
});
