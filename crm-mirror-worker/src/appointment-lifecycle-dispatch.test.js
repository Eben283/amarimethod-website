import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  appointmentLifecycleDispatchReadiness,
  dispatchOwnedAppointmentLifecycles,
  ownedAppointmentLifecyclePayload,
} from "./appointment-lifecycle-dispatch.js";

const migrationNames = [
  "0001_initial_schema.sql", "0002_purchase_reconciliation_candidates.sql",
  "0003_purchase_classification_review.sql", "0004_ledger_cutover_candidates.sql",
  "0005_shadow_ledger_opening_balances.sql", "0006_staff_communications.sql",
  "0007_ghl_webhook_event_journal.sql", "0008_client_workspace_records.sql",
  "0009_stripe_invoices.sql", "0010_owned_sender_foundation.sql",
  "0011_monitor_readiness_contract.sql", "0012_client_desk_seen.sql",
  "0013_owned_followups.sql", "0014_appointment_projection.sql",
  "0015_owned_communication_commands.sql", "0016_gmail_provider_evidence.sql",
  "0017_gmail_sync_gap_evidence.sql", "0018_gmail_reply_sync_control.sql",
  "0019_owned_appointment_authority.sql", "0020_owned_appointment_lifecycle_dispatch.sql",
  "0021_provider_neutral_calendar_authority.sql",
];

function d1Database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of migrationNames) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    if (name === "0019_owned_appointment_authority.sql") sqlite.exec(`BEGIN; ${sql} COMMIT;`);
    else sqlite.exec(sql);
  }
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return { sqlite, prepare: (sql) => statement(sql) };
}

async function seedDispatch(db, overrides = {}) {
  const row = {
    id: "alife_1234567890abcdef12345678",
    command_id: "acmd_1234567890abcdef12345678",
    appointment_id: "appt_1234567890abcdef12345678",
    contact_id: "contact-1",
    service_id: "partner-initial",
    provider: "ghl",
    provider_contact_id: "ghl-contact-1",
    provider_appointment_id: "ghl-appointment-1",
    provider_calendar_id: "lfsnaiGiLNL2z12pLKDP",
    event_type: "confirmed",
    start_at: "2026-09-01T17:00:00.000Z",
    ...overrides,
  };
  const { payloadSha256 } = await ownedAppointmentLifecyclePayload(row);
  db.sqlite.exec(`
    INSERT INTO contacts (id, display_name, created_at, updated_at)
    VALUES ('contact-1', 'Partner Person', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z');
    INSERT INTO appointments (
      id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
      provider_status_raw, status, starts_at, ends_at, timezone, authority,
      provider_sync_state, revision, created_at, updated_at
    ) VALUES (
      'appt_1234567890abcdef12345678', 'contact-1', 'partner-initial', 'ghl-appointment-1',
      'lfsnaiGiLNL2z12pLKDP', 'confirmed', 'confirmed', '2026-09-01T17:00:00.000Z',
      '2026-09-01T18:00:00.000Z', 'America/Los_Angeles', 'owned', 'synced', 1,
      '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'
    );
    INSERT INTO appointment_authority_commands (
      id, actor, idempotency_key, action, contact_id, appointment_id, service_id,
      requested_start_time, requested_end_time, requested_timezone, payload_sha256,
      state, provider, provider_record_id, attempts, lease_until, created_at, updated_at
    ) VALUES (
      'acmd_1234567890abcdef12345678', 'Garrett', 'partner-lifecycle-test-1', 'schedule',
      'contact-1', 'appt_1234567890abcdef12345678', 'partner-initial',
      '2026-09-01T17:00:00.000Z', '2026-09-01T18:00:00.000Z', 'America/Los_Angeles',
      '${"a".repeat(64)}', 'completed', 'ghl', 'ghl-appointment-1', 1, 0,
      '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z'
    )
  `);
  if (row.service_id !== "partner-initial" || row.provider_calendar_id !== "lfsnaiGiLNL2z12pLKDP") {
    db.sqlite.prepare(
      "UPDATE appointments SET service_id = ?, provider_calendar_id = ? WHERE id = ?",
    ).run(row.service_id, row.provider_calendar_id, row.appointment_id);
    db.sqlite.prepare(
      "UPDATE appointment_authority_commands SET service_id = ? WHERE id = ?",
    ).run(row.service_id, row.command_id);
  }
  db.sqlite.prepare(`
    INSERT INTO appointment_lifecycle_dispatches (
      id, command_id, appointment_id, contact_id, service_id, provider,
      provider_contact_id, provider_appointment_id, provider_calendar_id,
      event_type, start_at, payload_sha256, state, attempts, lease_until,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ghl', ?, ?, ?, ?, ?, ?, 'pending', 0, 0,
              '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z')
  `).run(
    row.id, row.command_id, row.appointment_id, row.contact_id, row.service_id,
    row.provider_contact_id, row.provider_appointment_id, row.provider_calendar_id,
    row.event_type, row.start_at, overrides.payload_sha256 || payloadSha256,
  );
  return row;
}

describe("owned appointment lifecycle dispatch", () => {
  it("delivers the exact owned Partner Initial event through the authenticated service binding", async () => {
    const db = d1Database();
    await seedDispatch(db);
    const fetch = vi.fn(async (_url, init) => new Response(JSON.stringify({
      success: true,
      actions: [{ engine: "reminder", action: "enroll", detail: { flowKey: "partner-initial-in-person" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const summary = await dispatchOwnedAppointmentLifecycles({
      CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch },
    }, Date.parse("2026-08-29T01:00:00Z"));

    expect(summary).toEqual({ status: "succeeded", considered: 1, dispatched: 1, retryable: 0, manualReview: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://reminder-engine/event");
    expect(init.headers.Authorization).toBe("Bearer test-worker-secret");
    expect(JSON.parse(init.body)).toEqual({
      type: "confirmed", recognized: true, status: "confirmed",
      calendarId: "lfsnaiGiLNL2z12pLKDP", contactId: "contact-1",
      appointmentId: "appt_1234567890abcdef12345678", startAt: "2026-09-01T17:00:00.000Z",
      modifiedBy: "user",
      context: {
        source: "owned_crm", commandId: "acmd_1234567890abcdef12345678",
        ownedAppointmentId: "appt_1234567890abcdef12345678",
        ownedContactId: "contact-1", serviceId: "partner-initial",
        provider: "ghl", providerAppointmentId: "ghl-appointment-1",
        providerCalendarId: "lfsnaiGiLNL2z12pLKDP", providerContactId: "ghl-contact-1",
      },
    });
    expect(db.sqlite.prepare("SELECT state, attempts, dispatched_at FROM appointment_lifecycle_dispatches").get())
      .toEqual({ state: "dispatched", attempts: 1, dispatched_at: "2026-08-29T01:00:00.000Z" });
    expect(await appointmentLifecycleDispatchReadiness(db)).toMatchObject({
      configured: true, state: "ready", blocking: 0, shadowOnly: true, deliveryEnabled: false,
      counts: { dispatched: 1 },
    });
    db.sqlite.close();
  });

  it.each([
    ["discovery-call", "USgPsktqRcuomdUgpShL"],
    ["discovery-call-virtual", "ZEIGFHBi17SpZ3Ezi5DR"],
  ])("delivers the exact owned %s event only when the discovery shadow flow acknowledges it", async (serviceId, calendarId) => {
    const db = d1Database();
    await seedDispatch(db, { service_id: serviceId, provider_calendar_id: calendarId });
    const fetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({
        calendarId,
        context: { serviceId, providerCalendarId: calendarId },
      });
      return new Response(JSON.stringify({
        actions: [{ engine: "reminder", action: "enroll", detail: { flowKey: "discovery-call" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(dispatchOwnedAppointmentLifecycles({
      CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch },
    }, Date.parse("2026-08-29T01:00:00Z"))).resolves.toMatchObject({
      status: "succeeded", dispatched: 1, manualReview: 0,
    });
    expect(db.sqlite.prepare("SELECT state FROM appointment_lifecycle_dispatches").get())
      .toEqual({ state: "dispatched" });
    db.sqlite.close();
  });

  it("quarantines a cross-flow acknowledgement instead of accepting unrelated lifecycle work", async () => {
    const db = d1Database();
    await seedDispatch(db, {
      service_id: "discovery-call",
      provider_calendar_id: "USgPsktqRcuomdUgpShL",
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      actions: [{ engine: "reminder", action: "enroll", detail: { flowKey: "partner-initial-in-person" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(dispatchOwnedAppointmentLifecycles({
      CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch },
    }, Date.parse("2026-08-29T01:00:00Z"))).resolves.toMatchObject({
      status: "attention", dispatched: 0, manualReview: 1,
    });
    expect(db.sqlite.prepare("SELECT state, last_error FROM appointment_lifecycle_dispatches").get())
      .toEqual({
        state: "manual_review",
        last_error: "reminder engine did not acknowledge the exact owned appointment lifecycle",
      });
    db.sqlite.close();
  });

  it("retries a failed handoff and accepts the reminder engine's idempotent no-op acknowledgement", async () => {
    const db = d1Database();
    await seedDispatch(db);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        actions: [{ engine: "reminder", action: "enroll-noop", detail: { flowKey: "partner-initial-in-person" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const env = { CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch } };

    await expect(dispatchOwnedAppointmentLifecycles(env, Date.parse("2026-08-29T01:00:00Z")))
      .resolves.toMatchObject({ status: "attention", retryable: 1 });
    await expect(dispatchOwnedAppointmentLifecycles(env, Date.parse("2026-08-29T01:05:00Z")))
      .resolves.toMatchObject({ status: "succeeded", dispatched: 1 });
    expect(db.sqlite.prepare("SELECT state, attempts FROM appointment_lifecycle_dispatches").get())
      .toEqual({ state: "dispatched", attempts: 2 });
    db.sqlite.close();
  });

  it("delivers cancellation evidence and requires the reminder engine to acknowledge cancellation", async () => {
    const db = d1Database();
    await seedDispatch(db, { event_type: "cancelled" });
    const fetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({
        type: "cancelled",
        status: "cancelled",
        appointmentId: "appt_1234567890abcdef12345678",
        context: { serviceId: "partner-initial" },
      });
      return new Response(JSON.stringify({
        actions: [{ engine: "reminder", action: "cancel", detail: {
          flowKey: "partner-initial-in-person", cancelledSteps: 4,
        } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(dispatchOwnedAppointmentLifecycles({
      CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch },
    }, Date.parse("2026-08-29T01:00:00Z"))).resolves.toMatchObject({
      status: "succeeded", dispatched: 1,
    });
    expect(db.sqlite.prepare("SELECT state FROM appointment_lifecycle_dispatches").get())
      .toEqual({ state: "dispatched" });
    db.sqlite.close();
  });

  it("quarantines digest drift instead of delivering changed lifecycle truth", async () => {
    const db = d1Database();
    await seedDispatch(db, { payload_sha256: "0".repeat(64) });
    const fetch = vi.fn();

    await expect(dispatchOwnedAppointmentLifecycles({
      CRM_DB: db, WORKER_AUTH_SECRET: "test-worker-secret", REMINDER: { fetch },
    }, Date.parse("2026-08-29T01:00:00Z")))
      .resolves.toMatchObject({ status: "attention", manualReview: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT state, last_error FROM appointment_lifecycle_dispatches").get())
      .toEqual({ state: "manual_review", last_error: "appointment lifecycle payload digest mismatch" });
    db.sqlite.close();
  });
});
