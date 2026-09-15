const ALLOWED_STATES = new Set(["done", "spam", "open"]);

export class ClientDeskDispositionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ClientDeskDispositionError";
    this.code = code;
    this.status = status;
  }
}

export async function setClientDeskDisposition(db, { contactId, state, actor, now }) {
  if (!ALLOWED_STATES.has(state)) {
    throw new ClientDeskDispositionError("invalid_disposition", "Disposition must be done, spam, or open.");
  }
  if (state === "open") {
    await db.prepare(
      "DELETE FROM client_desk_conversation_dispositions WHERE contact_id = ?",
    ).bind(contactId).run();
    return { state: "open", resolvedEventAt: null };
  }

  const latest = await db.prepare(
    `SELECT id AS thread_id, last_event_at
       FROM communication_threads
      WHERE contact_id = ? AND last_event_at IS NOT NULL
      ORDER BY datetime(last_event_at) DESC, id DESC
      LIMIT 1`,
  ).bind(contactId).first();
  if (!latest?.last_event_at) {
    throw new ClientDeskDispositionError("conversation_has_no_events", "This conversation has no event to resolve.", 409);
  }

  await db.prepare(
    `INSERT INTO client_desk_conversation_dispositions
       (contact_id, state, resolved_thread_id, resolved_event_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(contact_id) DO UPDATE SET
       state = excluded.state,
       resolved_thread_id = excluded.resolved_thread_id,
       resolved_event_at = excluded.resolved_event_at,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(contactId, state, latest.thread_id, latest.last_event_at, actor, now).run();
  return { state, resolvedThreadId: latest.thread_id, resolvedEventAt: latest.last_event_at };
}
