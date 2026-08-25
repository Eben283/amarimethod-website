import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";
import { captureFollowUpReliability, followUpCompositeIdentityV1 } from "./follow-up-reliability.js";

function d1FromSqlite(raw) {
  const statement = (sql) => ({
    sql, values: [],
    bind(...values) { this.values = values; return this; },
    first() { return raw.prepare(this.sql).get(...this.values) || null; },
    all() { return { results: raw.prepare(this.sql).all(...this.values) }; },
    run() {
      const result = raw.prepare(this.sql).run(...this.values);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: statement,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const NOW = Date.parse("2026-08-24T10:58:25.565-07:00");
const RAW = JSON.stringify({
  contact_id: "contact-1", appointment_id: "appointment-1",
  calendar_id: "SKDVOL8wtUN6Ne0ppbC9", status: "confirmed",
  start_time: "2026-08-25T13:00:00-07:00", source: "appointment-events-webhook",
});
const event = (over = {}) => ({
  recognized: true,
  type: "confirmed",
  status: "confirmed",
  appointmentEventType: "normal",
  appointmentId: "appointment-1",
  contactId: "contact-1",
  calendarId: "SKDVOL8wtUN6Ne0ppbC9",
  startAt: "2026-08-25T13:00:00-07:00",
  context: { reminderPreference: "full" },
  ...over,
});

let raw;
let db;
let env;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  db = d1FromSqlite(raw);
  env = {
    REMINDER_DB: db,
    FOLLOW_UP_RELIABILITY_SPINE_ENABLED: "enabled",
    FOLLOW_UP_RELIABILITY_SOURCE_VERSION: "ghl:appointment-events-webhook:v7",
    SOURCE_REVISION: "git:source-revision",
    WORKER_VERSION: "worker-version-1",
  };
});

describe("Follow-Up disabled runtime import", () => {
  it("is completely inert unless the exact feature flag is enabled", async () => {
    const result = await captureFollowUpReliability({
      env: { REMINDER_DB: { prepare: () => { throw new Error("must not read"); } } },
      event: event(), rawPayload: RAW, nowMs: NOW, workflow: null,
    });
    expect(result).toEqual({ enabled: false, applicable: false });
  });

  it("requires explicit source and runtime provenance before any enabled capture", async () => {
    for (const missing of ["FOLLOW_UP_RELIABILITY_SOURCE_VERSION", "SOURCE_REVISION", "WORKER_VERSION"]) {
      const candidate = { ...env };
      delete candidate[missing];
      await expect(captureFollowUpReliability({
        env: candidate, event: event(), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW,
      })).rejects.toThrow(missing);
    }
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(0);
  });

  it("derives the versioned identity from the exact documented composite", () => {
    const identity = followUpCompositeIdentityV1({
      appointmentId: "appointment-1", eventKind: "normal", status: "confirmed",
      effectiveStart: "2026-08-25T13:00:00-07:00", payloadSha256: "a".repeat(64),
    });
    expect(identity).toBe(`ghl:appointment-event:v1:ghl:appointment-1:normal:confirmed:2026-08-25T13:00:00-07:00:${"a".repeat(64)}`);
    expect(() => followUpCompositeIdentityV1({ appointmentId: "appointment-1" })).toThrow("complete");
  });

  it("atomically records one source, lifecycle, and exact full-preference obligations", async () => {
    const result = await captureFollowUpReliability({
      env, event: event(), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW,
    });
    expect(result).toMatchObject({ enabled: true, applicable: true, accepted: true, created: true, deduplicated: false });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(1);
    expect(raw.prepare("SELECT obligation_key, kind, owner_role, closer FROM lifecycle_obligations ORDER BY deadline_at, obligation_key").all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ obligation_key: "remove-no-show-series", kind: "external_workflow_exit", closer: "provider_exit_evidence" }),
        expect.objectContaining({ obligation_key: "booked-internal", kind: "internal_email", owner_role: "assigned_user" }),
        expect.objectContaining({ obligation_key: "confirmation", kind: "client_email", closer: "provider_receipt" }),
        expect.objectContaining({ obligation_key: "day-before", kind: "client_email" }),
        expect.objectContaining({ obligation_key: "one-hour-email", kind: "client_email" }),
        expect.objectContaining({ obligation_key: "one-hour-sms", kind: "client_sms" }),
        expect.objectContaining({ obligation_key: "one-hour-internal", kind: "internal_sms", owner_role: "assigned_user" }),
      ]));
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(7);
    expect(raw.prepare("SELECT transition FROM source_event_transitions ORDER BY sequence").all().at(-1))
      .toEqual({ transition: "dispatched" });
    expect(raw.prepare("SELECT definition_version, runtime_version FROM lifecycle_instances").get())
      .toEqual({ definition_version: FOLLOW_UP_WORKFLOW.version, runtime_version: "git:source-revision@worker-version-1" });
  });

  it("collapses an exact replay without creating another lifecycle or obligation", async () => {
    const first = await captureFollowUpReliability({ env, event: event(), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW });
    const replay = await captureFollowUpReliability({ env, event: event(), rawPayload: RAW, nowMs: NOW + 1, workflow: FOLLOW_UP_WORKFLOW });
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, deduplicated: true, accepted: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(7);
    expect(raw.prepare("SELECT COUNT(*) count FROM source_event_transitions WHERE transition='dispatched'").get().count).toBe(1);
  });

  it.each([
    ["some", ["remove-no-show-series", "booked-internal", "confirmation", "one-hour-sms", "one-hour-internal"]],
    ["none", ["remove-no-show-series", "booked-internal", "confirmation"]],
  ])("materializes only the exact %s preference obligations", async (preference, expected) => {
    await captureFollowUpReliability({
      env, event: event({ context: { reminderPreference: preference } }), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW,
    });
    expect(raw.prepare("SELECT obligation_key FROM lifecycle_obligations ORDER BY obligation_key").all().map((row) => row.obligation_key).sort())
      .toEqual([...expected].sort());
  });

  it("records an ambiguous Follow-Up entry as one exception and no lifecycle", async () => {
    const result = await captureFollowUpReliability({
      env, event: event({ appointmentEventType: null }), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW,
    });
    expect(result).toMatchObject({ enabled: true, applicable: true, accepted: false, created: true });
    expect(raw.prepare("SELECT state, rejection_reason FROM source_events").get()).toMatchObject({
      state: "rejected", rejection_reason: "Follow-Up source identity is incomplete",
    });
    expect(raw.prepare("SELECT kind, accountable_owner, state FROM lifecycle_exceptions").get())
      .toEqual({ kind: "follow_up_identity_ambiguous", accountable_owner: "Eben", state: "open" });
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(0);
  });

  it("does not capture a different lifecycle family", async () => {
    const result = await captureFollowUpReliability({
      env, event: event({ calendarId: "not-follow-up" }), rawPayload: RAW, nowMs: NOW, workflow: FOLLOW_UP_WORKFLOW,
    });
    expect(result).toEqual({ enabled: true, applicable: false });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(0);
  });
});
