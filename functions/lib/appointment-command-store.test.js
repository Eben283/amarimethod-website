import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAppointmentCommandStore } from "./appointment-command-store.js";

function d1(raw) {
  function statement(sql, values = []) {
    return {
      bind(...next) { return statement(sql, next); },
      async first() { return raw.prepare(sql).get(...values) || null; },
      async run() {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes || 0) } };
      },
    };
  }
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("appointment command store", () => {
  it("preserves a replacement checkpoint across retry and returns one completed result", async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../../db/appointment-commands-migration.sql", import.meta.url), "utf8"));
    let now = 1_786_365_000_000;
    const store = createAppointmentCommandStore(d1(raw), { now: () => now, leaseMs: 1000 });
    const input = {
      actor: "Garrett", action: "reschedule", contactId: "contact_1",
      appointmentId: "appt_1", idempotencyKey: "reschedule-appt-1",
      requestedStartTime: "2026-08-12T10:15:00-07:00",
    };

    const first = await store.claim(input);
    expect(first.state).toBe("acquired");
    await store.checkpointReplacement(first.command.id, "appt_2");
    await store.fail(first.command.id, Object.assign(new Error("provider readback timed out"), { code: "readback" }));

    now += 2000;
    const resumed = await store.claim(input);
    expect(resumed).toMatchObject({ state: "acquired", command: { replacementAppointmentId: "appt_2" } });
    const result = { status: "completed", action: "reschedule", replacementAppointmentId: "appt_2" };
    await store.complete(resumed.command.id, result);

    await expect(store.claim(input)).resolves.toMatchObject({ state: "completed", command: { result } });
    expect(raw.prepare("SELECT phase FROM appointment_command_events ORDER BY occurred_at, rowid").all().map((row) => row.phase))
      .toEqual(["claimed", "replacement_created", "retryable", "resumed", "completed"]);
  });
});
