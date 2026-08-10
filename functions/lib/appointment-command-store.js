function changes(result) {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

function parseResult(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    contactId: row.contact_id,
    appointmentId: row.source_appointment_id,
    requestedStartTime: row.requested_start_time || null,
    replacementAppointmentId: row.replacement_appointment_id || null,
    status: row.status,
    result: parseResult(row.result_json),
    leaseUntil: Number(row.lease_until || 0),
  };
}

function sameCommand(row, input) {
  return row.actor === input.actor &&
    row.action === input.action &&
    row.contact_id === input.contactId &&
    row.source_appointment_id === input.appointmentId &&
    (row.requested_start_time || null) === (input.requestedStartTime || null);
}

function commandId(actor, idempotencyKey) {
  return `appointment:${String(actor).toLowerCase()}:${encodeURIComponent(idempotencyKey)}`;
}

function eventStatement(db, command, phase, detail, now) {
  return db.prepare(
    `INSERT INTO appointment_command_events
      (id, command_id, actor, phase, detail_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    command.id,
    command.actor,
    phase,
    detail ? JSON.stringify(detail) : null,
    now,
  );
}

async function read(db, id) {
  return db.prepare("SELECT * FROM appointment_commands WHERE id = ?").bind(id).first();
}

export function createAppointmentCommandStore(db, options = {}) {
  if (!db) throw new Error("ATTEND_DB appointment command state is unavailable");
  const clock = () => Number(options.now?.() ?? Date.now());
  const leaseMs = Number(options.leaseMs ?? 120_000);

  return Object.freeze({
    async claim(input) {
      const now = clock();
      const id = commandId(input.actor, input.idempotencyKey);
      const inserted = await db.prepare(
        `INSERT INTO appointment_commands
          (id, actor, idempotency_key, action, contact_id, source_appointment_id,
           requested_start_time, replacement_appointment_id, status, result_json,
           lease_until, attempts, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'processing', NULL, ?, 1, NULL, ?, ?)
         ON CONFLICT(actor, idempotency_key) DO NOTHING`,
      ).bind(
        id, input.actor, input.idempotencyKey, input.action, input.contactId,
        input.appointmentId, input.requestedStartTime || null,
        now + leaseMs, now, now,
      ).run();

      let row = await read(db, id);
      if (changes(inserted) === 1) {
        await eventStatement(db, row, "claimed", { action: input.action }, now).run();
        return { state: "acquired", command: shape(row) };
      }
      if (!row || !sameCommand(row, input)) return { state: "conflict", command: shape(row) };
      if (row.status === "completed") return { state: "completed", command: shape(row) };
      if (row.status === "manual_review") return { state: "manual_review", command: shape(row) };
      if (row.status === "processing" && Number(row.lease_until) > now) return { state: "in_progress", command: shape(row) };

      const resumed = await db.prepare(
        `UPDATE appointment_commands
            SET status = 'processing', lease_until = ?, attempts = attempts + 1,
                last_error = NULL, updated_at = ?
          WHERE id = ? AND status IN ('processing', 'retryable') AND lease_until <= ?`,
      ).bind(now + leaseMs, now, id, now).run();
      if (changes(resumed) !== 1) return { state: "in_progress", command: shape(await read(db, id)) };
      row = await read(db, id);
      await eventStatement(db, row, "resumed", null, now).run();
      return { state: "acquired", command: shape(row) };
    },

    async checkpointReplacement(id, replacementAppointmentId) {
      const now = clock();
      const row = await read(db, id);
      if (!row) throw new Error("appointment command not found");
      const update = db.prepare(
        `UPDATE appointment_commands
            SET replacement_appointment_id = ?, lease_until = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'
            AND (replacement_appointment_id IS NULL OR replacement_appointment_id = ?)`,
      ).bind(replacementAppointmentId, now + leaseMs, now, id, replacementAppointmentId);
      const [updated] = await db.batch([
        update,
        eventStatement(db, row, "replacement_created", { replacementAppointmentId }, now),
      ]);
      if (changes(updated) !== 1) throw new Error("replacement checkpoint was not accepted");
    },

    async clearReplacement(id, replacementAppointmentId) {
      const now = clock();
      const row = await read(db, id);
      if (!row) throw new Error("appointment command not found");
      const [updated] = await db.batch([
        db.prepare(
          `UPDATE appointment_commands SET replacement_appointment_id = NULL, updated_at = ?
            WHERE id = ? AND status = 'processing' AND replacement_appointment_id = ?`,
        ).bind(now, id, replacementAppointmentId),
        eventStatement(db, row, "replacement_compensated", { replacementAppointmentId }, now),
      ]);
      if (changes(updated) !== 1) throw new Error("replacement checkpoint could not be cleared");
    },

    async complete(id, result) {
      const now = clock();
      const row = await read(db, id);
      if (!row) throw new Error("appointment command not found");
      const [updated] = await db.batch([
        db.prepare(
          `UPDATE appointment_commands
              SET status = 'completed', result_json = ?, lease_until = 0,
                  last_error = NULL, updated_at = ?
            WHERE id = ? AND status = 'processing'`,
        ).bind(JSON.stringify(result), now, id),
        eventStatement(db, row, "completed", result, now),
      ]);
      if (changes(updated) !== 1) throw new Error("appointment command completion was not accepted");
    },

    async fail(id, error, options = {}) {
      const now = clock();
      const row = await read(db, id);
      if (!row) return null;
      const status = options.manualReview ? "manual_review" : "retryable";
      const message = String(error?.message || error || "unknown error").slice(0, 1000);
      const [updated] = await db.batch([
        db.prepare(
          `UPDATE appointment_commands
              SET status = ?, lease_until = 0, last_error = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'`,
        ).bind(status, message, now, id),
        eventStatement(db, row, status, { code: error?.code || "appointment_command_failed", message }, now),
      ]);
      return { ok: changes(updated) === 1, status };
    },
  });
}
