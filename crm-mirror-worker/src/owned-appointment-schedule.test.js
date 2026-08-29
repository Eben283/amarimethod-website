import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { listOwnedAppointmentSchedule, normalizeOwnedScheduleRange } from "./owned-appointment-schedule.js";

describe("owned appointment schedule", () => {
  it("returns stable owned identity with explicit truth state", async () => {
    const db = {
      prepare: () => ({ bind: (...values) => ({ all: async () => ({ results: [
        {
          id: "appointment-owned", contact_id: "contact-1", display_name: "Partner Person",
          service_id: "partner-initial", service_name: "Partner Initial Session",
          provider_appointment_id: "ghl-1", provider_calendar_id: "calendar-1",
          status: "confirmed", starts_at: "2026-09-01T17:00:00.000Z", ends_at: "2026-09-01T18:00:00.000Z",
          timezone: "America/Los_Angeles", authority: "owned", provider_sync_state: "synced",
          revision: 1, updated_at: "2026-08-28T00:00:00.000Z", service_family: "partner_session",
          provider_meeting_location: "https://meet.example.test/owned", tags_joined: "affiliate-partner\u001fclient",
          imported_sessions_remaining: "3", imported_series_type: "4-session",
          ledger_entry_count: 2, ledger_balance: 2, sessions_completed: 1,
          payment_status: "comped", payment_note: "Partner gift",
        },
        {
          id: "appointment-mirror", contact_id: "contact-2", display_name: "Legacy Person",
          service_id: "followup-in-person", service_name: "Follow-up Session — In Person",
          provider_appointment_id: "ghl-2", provider_calendar_id: "calendar-2",
          status: "confirmed", starts_at: "2026-09-02T17:00:00.000Z", ends_at: "2026-09-02T17:50:00.000Z",
          timezone: "America/Los_Angeles", authority: "provider_mirror", provider_sync_state: "synced",
          revision: 1, updated_at: "2026-08-28T00:01:00.000Z",
        },
      ], values }) }) }),
    };
    const schedule = await listOwnedAppointmentSchedule(db, {
      startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-03T00:00:00Z",
      includeDetail: true,
    });
    expect(schedule.truth).toEqual({ authoritative: 1, propagating: 0, mirrored: 1, degraded: 0 });
    expect(schedule.appointments[0]).toMatchObject({
      id: "appointment-owned", contactId: "contact-1", truthState: "authoritative",
      providerAppointmentId: "ghl-1",
      meetingLocation: "https://meet.example.test/owned",
      sessionsRemaining: 2,
      sessionsCompleted: 1,
      seriesType: "4-session",
      tags: ["affiliate-partner", "client"],
      paymentStatus: "comped",
      detailTruth: {
        overall: "complete", sessionBalance: "owned_ledger", series: "provider_mirror",
        payment: "owned_record", meetingLocation: "provider_mirror",
      },
    });
    expect(schedule.detailIncluded).toBe(true);
  });

  it("rejects unbounded or invalid ranges", () => {
    expect(() => normalizeOwnedScheduleRange({ startTime: "bad", endTime: "also bad" })).toThrow(/valid appointment range/i);
    expect(() => normalizeOwnedScheduleRange({
      startTime: "2026-08-01T00:00:00Z", endTime: "2026-10-01T00:00:00Z",
    })).toThrow(/45 days/i);
  });

  it("hydrates the detailed contract from the migrated schema", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const migrationDirectory = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
      db.exec(readFileSync(new URL(name, migrationDirectory), "utf8"));
    }
    db.exec(`
      INSERT INTO contacts (id, display_name, created_at, updated_at)
      VALUES ('contact-1', 'Person One', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
      INSERT INTO contact_tags (contact_id, tag, source, created_at)
      VALUES ('contact-1', 'client', 'ghl', '2026-08-28T00:00:00Z');
      INSERT INTO contact_attributes (contact_id, source, attribute_key, attribute_value, updated_at)
      VALUES
        ('contact-1', 'ghl', 'wrQSkx6BhXwDGIn1d0V4', '3', '2026-08-28T00:00:00Z'),
        ('contact-1', 'ghl', '3i93lTkmuAV49s9nh0q8', '4-session', '2026-08-28T00:00:00Z');
      INSERT INTO appointments (
        id, contact_id, service_id, status, starts_at, ends_at, timezone,
        provider_meeting_location, authority, provider_sync_state, created_at, updated_at
      ) VALUES (
        'appointment-1', 'contact-1', 'followup-in-person', 'confirmed',
        '2026-09-01T17:00:00Z', '2026-09-01T17:50:00Z', 'America/Los_Angeles',
        'https://meet.example.test/one', 'owned', 'not_required',
        '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z'
      );
      INSERT INTO session_ledger_entries (
        id, contact_id, entry_type, credits, reason, created_by, source_key, created_at
      ) VALUES ('ledger-1', 'contact-1', 'cutover_opening_balance', 3, 'Opening', 'Eben', 'opening:1', '2026-08-28T00:00:00Z');
      INSERT INTO appointment_payment_records (
        appointment_id, contact_id, status, method, source, recorded_by, recorded_at, updated_at
      ) VALUES ('appointment-1', 'contact-1', 'on-package', NULL, 'staff', 'Garrett', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');
    `);
    const d1 = {
      prepare(sql) {
        const statement = db.prepare(sql);
        return { bind: (...values) => ({ all: async () => ({ results: statement.all(...values) }) }) };
      },
    };
    const schedule = await listOwnedAppointmentSchedule(d1, {
      startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-02T00:00:00Z",
      includeDetail: true, now: "2026-09-02T00:00:00Z",
    });
    expect(schedule.appointments[0]).toMatchObject({
      id: "appointment-1", tags: ["client"], sessionsRemaining: 3,
      sessionsCompleted: 1, paymentStatus: "on-package", sessionPrepaid: true,
      meetingLocation: "https://meet.example.test/one",
      detailTruth: { overall: "complete", sessionBalance: "owned_ledger" },
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
