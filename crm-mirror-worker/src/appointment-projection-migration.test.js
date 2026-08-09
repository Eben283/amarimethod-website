import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/0014_appointment_projection.sql", import.meta.url), "utf8");

describe("appointment projection migration", () => {
  it("rejects mutation and deletion of append-only provider evidence", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(migration);
    db.prepare(
      `INSERT INTO appointment_projection_events
       (id, provider, source_kind, provider_event_id, provider_event_type,
        provider_appointment_id, normalized_status, transition_type, observed_at, evidence_hash)
       VALUES (?, 'ghl', 'webhook', ?, 'AppointmentCreate', ?, 'confirmed', 'create', ?, ?)`,
    ).run("event-1", "provider-event-1", "appointment-1", "2026-08-08T17:00:00.000Z", "hash-1");

    expect(() => db.exec("UPDATE appointment_projection_events SET normalized_status = 'cancelled' WHERE id = 'event-1'"))
      .toThrow(/append-only/i);
    expect(() => db.exec("DELETE FROM appointment_projection_events WHERE id = 'event-1'"))
      .toThrow(/append-only/i);
    expect(db.prepare("SELECT normalized_status FROM appointment_projection_events WHERE id = ?").get("event-1"))
      .toEqual({ normalized_status: "confirmed" });
    db.close();
  });
});
