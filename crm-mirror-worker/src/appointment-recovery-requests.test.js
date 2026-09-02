import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  captureAppointmentRecoveryRequest,
  listAppointmentRecoveryRequests,
} from "./appointment-recovery-requests.js";

function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((value) => /^\d{4}_.+\.sql$/.test(value)).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const now = "2026-09-01T20:00:00.000Z";
  sqlite.prepare(
    `INSERT INTO contacts (id, display_name, created_at, updated_at, archived_at)
     VALUES ('contact-1', 'Avery Example', ?, ?, ?)`,
  ).run(now, now, overrides.archivedAt || null);
  sqlite.prepare(
    `INSERT INTO appointments
       (id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
        provider_status_raw, status, starts_at, ends_at, timezone, authority,
        provider_sync_state, revision, created_at, updated_at)
     VALUES ('appointment-1', 'contact-1', 'partner-initial', 'provider-1',
             'lfsnaiGiLNL2z12pLKDP', ?, ?, '2026-09-01T18:00:00.000Z',
             '2026-09-01T19:00:00.000Z', 'America/Los_Angeles', ?, ?, 3, ?, ?)`,
  ).run(
    overrides.status || "noshow",
    overrides.normalizedStatus || "no_show",
    overrides.authority || "provider_mirror",
    overrides.syncState || "synced",
    now,
    now,
  );
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
    _run: () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  });
  const db = {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, db, now };
}

const input = {
  appointmentId: "appointment-1",
  contactId: "contact-1",
  appointmentRevision: 3,
};

describe("owned appointment recovery request boundary", () => {
  it("records one review request and one append-only event without booking, credit, payment, or communication effects", async () => {
    const { sqlite, db, now } = fixture();
    const first = await captureAppointmentRecoveryRequest(db, input, now);
    const replay = await captureAppointmentRecoveryRequest(db, input, "2026-09-01T20:01:00.000Z");
    expect(first).toMatchObject({
      appointmentId: "appointment-1", contactId: "contact-1", appointmentRevision: 3,
      state: "pending_review", requestedAt: now, reviewedAt: null, reviewedBy: null, deduped: false,
    });
    expect(replay).toEqual({ ...first, deduped: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_recovery_requests").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_recovery_request_events").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT event_type, detail_json FROM appointment_recovery_request_events").get()).toEqual({
      event_type: "client_requested",
      detail_json: JSON.stringify({ source: "signed_appointment_manage_link", appointmentRevision: 3 }),
    });
    expect(sqlite.prepare("SELECT request_sha256 FROM appointment_recovery_requests").get().request_sha256)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_authority_commands").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_payment_records").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_ledger_entries").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_communication_commands").get()).toEqual({ count: 0 });
    expect(() => sqlite.prepare("DELETE FROM appointment_recovery_requests").run())
      .toThrow(/cannot be deleted/);
    sqlite.close();
  });

  it("fails closed on stale identity, a non-missed appointment, archived contact, or unready authority", async () => {
    for (const [overrides, changedInput, code] of [
      [{}, { ...input, appointmentRevision: 2 }, "appointment_recovery_identity_mismatch"],
      [{ normalizedStatus: "confirmed" }, input, "appointment_recovery_not_missed"],
      [{ archivedAt: "2026-09-01T19:00:00.000Z" }, input, "appointment_recovery_contact_archived"],
      [{ syncState: "pending" }, input, "appointment_recovery_authority_unavailable"],
    ]) {
      const { sqlite, db, now } = fixture(overrides);
      await expect(captureAppointmentRecoveryRequest(db, changedInput, now)).rejects.toMatchObject({ code });
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_recovery_requests").get()).toEqual({ count: 0 });
      sqlite.close();
    }
  });

  it("exposes a bounded Staff review readback without client destinations", async () => {
    const { sqlite, db, now } = fixture();
    await captureAppointmentRecoveryRequest(db, input, now);
    await expect(listAppointmentRecoveryRequests(db, { limit: 1 })).resolves.toEqual([expect.objectContaining({
      contactName: "Avery Example",
      serviceName: "Partner Initial Session",
      state: "pending_review",
      startsAt: "2026-09-01T18:00:00.000Z",
    })]);
    expect(JSON.stringify(await listAppointmentRecoveryRequests(db))).not.toContain("provider-1");
    sqlite.close();
  });
});
