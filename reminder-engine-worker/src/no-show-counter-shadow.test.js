import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { captureNoShowCounterShadow, MISSED_APPOINTMENTS_FIELD, noShowCounterCompositeIdentityV1 } from "./no-show-counter-shadow.js";

function d1FromSqlite(raw) {
  const statement = (sql) => ({
    sql, values: [], bind(...values) { this.values = values; return this; },
    first() { return raw.prepare(this.sql).get(...this.values) || null; },
    all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
    run() { const result = raw.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; },
  });
  return {
    prepare: statement,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try { const results = statements.map((item) => item.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };
}

const NOW = Date.parse("2026-08-25T11:00:00-07:00");
const RAW = JSON.stringify({ appointment_id: "appt-1", contact_id: "contact-1", status: "noshow", event_type: "normal" });
const event = (over = {}) => ({
  type: "noshow", appointmentEventType: "normal", appointmentId: "appt-1", contactId: "contact-1",
  calendarId: "SKDVOL8wtUN6Ne0ppbC9", startAt: "2026-08-25T09:00:00-07:00",
  context: { missedAppointmentsObserved: 2 }, ...over,
});

let raw;
let env;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  env = {
    REMINDER_DB: d1FromSqlite(raw), NO_SHOW_COUNTER_SHADOW_ENABLED: "enabled",
    NO_SHOW_COUNTER_SOURCE_VERSION: "ghl:no-show-increment:v7", SOURCE_REVISION: "git:abc", WORKER_VERSION: "worker-1",
  };
});

describe("No Show missed-count shadow", () => {
  it("is completely inert unless explicitly enabled", async () => {
    expect(await captureNoShowCounterShadow({ env: { REMINDER_DB: { prepare: () => { throw new Error("must not read"); } } }, event: event(), rawPayload: RAW, nowMs: NOW }))
      .toEqual({ enabled: false, applicable: false });
  });

  it("requires exact provenance and does not write when it is missing", async () => {
    for (const missing of ["NO_SHOW_COUNTER_SOURCE_VERSION", "SOURCE_REVISION", "WORKER_VERSION"]) {
      const candidate = { ...env }; delete candidate[missing];
      await expect(captureNoShowCounterShadow({ env: candidate, event: event(), rawPayload: RAW, nowMs: NOW })).rejects.toThrow(missing);
    }
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(0);
  });

  it("records one durable lifecycle and one GHL-retained increment obligation", async () => {
    const result = await captureNoShowCounterShadow({ env, event: event(), rawPayload: RAW, nowMs: NOW });
    expect(result).toMatchObject({ enabled: true, applicable: true, accepted: true, created: true });
    expect(raw.prepare("SELECT family, scope, definition_version FROM lifecycle_instances").get())
      .toEqual({ family: "no-show-missed-count", scope: "normal-no-show-counter-shadow", definition_version: 1 });
    expect(raw.prepare("SELECT obligation_key, kind, owner_role, closer, state FROM lifecycle_obligations").get())
      .toEqual({ obligation_key: "increment-missed-appointments", kind: "contact_field_increment", owner_role: "ghl-retained", closer: "No Show — Increment Missed Count", state: "pending" });
    const normalized = JSON.parse(raw.prepare("SELECT normalized_json FROM source_events").get().normalized_json);
    expect(normalized).toMatchObject({ observedAtIngest: 2, observedField: MISSED_APPOINTMENTS_FIELD, liveOwner: "No Show — Increment Missed Count" });
    expect(normalized.observationLimitation).toContain("not increment proof");
    expect(raw.prepare("SELECT transition FROM source_event_transitions ORDER BY sequence").all().map((row) => row.transition))
      .toEqual(["received", "authenticated", "normalized", "accepted"]);
  });

  it("deduplicates an exact replay without another obligation", async () => {
    await captureNoShowCounterShadow({ env, event: event(), rawPayload: RAW, nowMs: NOW });
    const replay = await captureNoShowCounterShadow({ env, event: event(), rawPayload: RAW, nowMs: NOW + 1 });
    expect(replay).toMatchObject({ accepted: true, created: false, deduplicated: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(1);
  });

  it("rejects an incomplete applicable identity into the Staff exception queue", async () => {
    const result = await captureNoShowCounterShadow({ env, event: event({ appointmentEventType: null }), rawPayload: RAW, nowMs: NOW });
    expect(result).toMatchObject({ accepted: false, applicable: true, created: true });
    expect(raw.prepare("SELECT kind, accountable_owner FROM lifecycle_exceptions").get())
      .toEqual({ kind: "no_show_counter_identity_ambiguous", accountable_owner: "Eben" });
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(0);
  });

  it("does not capture an unrelated calendar", async () => {
    expect(await captureNoShowCounterShadow({ env, event: event({ calendarId: "other" }), rawPayload: RAW, nowMs: NOW }))
      .toEqual({ enabled: true, applicable: false });
  });

  it("builds the exact composite identity", () => {
    expect(noShowCounterCompositeIdentityV1({ appointmentId: "a", eventKind: "normal", status: "noshow", effectiveStart: "s", payloadSha256: "h" }))
      .toBe("ghl:no-show-counter:v1:ghl:a:normal:noshow:s:h");
  });
});
