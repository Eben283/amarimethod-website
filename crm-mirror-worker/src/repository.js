function id() {
  return crypto.randomUUID();
}

const GHL_FIELD_IDS = Object.freeze({
  sessionsRemaining: "wrQSkx6BhXwDGIn1d0V4",
  sessionsCompleted: "TE0udwVH1Km5RsKaN5H0",
  seriesType: "3i93lTkmuAV49s9nh0q8",
  portalAccess: "O0xmwyRqeNK2EA1GGGye",
  livingPracticeAccess: "1EnVtI70jC5MTshZjWvw",
});

// This is display-only interpretation of already-linked, settled Stripe
// payments. It deliberately does not derive credits or change GHL access.
// Keep it aligned with functions/lib/ghl-products.js's package definitions.
const PACKAGE_ACCESS_EXPECTATIONS = Object.freeze({
  "4-Session Series": { seriesType: "4-session", livingPractice: false },
  "8-Session Series": { seriesType: "8-session", livingPractice: true },
  "The 6-Week Amari Practice": { seriesType: "6-week", livingPractice: true },
  "The 12-Week Amari Practice": { seriesType: "12-week", livingPractice: true },
  "Upgrade Initial→4": { seriesType: "4-session", livingPractice: false },
  "Upgrade Initial→8": { seriesType: "8-session", livingPractice: true },
  "Upgrade 4→8": { seriesType: "8-session", livingPractice: true },
});

function isEnabled(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function seriesSatisfies(actual, expected) {
  return actual === expected || (expected === "4-session" && actual === "8-session");
}

export function paymentAccessState(purchases, importedCurrentState) {
  const payment = (purchases || []).find((purchase) =>
    purchase.provider_status === "succeeded" &&
    Number(purchase.amount_cents || 0) > Number(purchase.amount_refunded_cents || 0) &&
    PACKAGE_ACCESS_EXPECTATIONS[purchase.classification],
  );
  if (!payment) {
    return {
      status: "no_linked_package_payment",
      label: "No linked package payment",
      detail: "No settled Stripe package payment is linked to this client record.",
      payment: null,
    };
  }

  const expected = PACKAGE_ACCESS_EXPECTATIONS[payment.classification];
  const state = importedCurrentState || {};
  const missing = [];
  if (!seriesSatisfies(state.series_type, expected.seriesType)) missing.push("series");
  if (state.sessions_remaining == null || String(state.sessions_remaining).trim() === "") missing.push("session balance");
  if (!isEnabled(state.portal_access)) missing.push("portal access");
  if (expected.livingPractice && !isEnabled(state.living_practice_access)) missing.push("Living Practice access");

  if (missing.length) {
    return {
      status: "review_access_state",
      label: "Review current access",
      detail: `A linked Stripe package payment is recorded, but the GHL access mirror is missing: ${missing.join(", ")}.`,
      payment,
      expected,
      missing,
    };
  }
  return {
    status: "aligned",
    label: "Payment and access aligned",
    detail: "A linked Stripe package payment and the expected current GHL access state are both mirrored.",
    payment,
    expected,
    missing: [],
  };
}

export async function beginSyncRun(db, provider, cursorBefore, now) {
  const runId = id();
  await db.prepare(
    `INSERT INTO sync_runs (id, provider, status, cursor_before, started_at)
     VALUES (?, ?, 'running', ?, ?)`,
  ).bind(runId, provider, cursorBefore, now).run();
  return runId;
}

export async function finishSyncRun(db, runId, result, now) {
  await db.prepare(
    `UPDATE sync_runs
     SET status = ?, cursor_after = ?, records_read = ?, records_written = ?,
         records_skipped = ?, failure_detail = ?, finished_at = ?
     WHERE id = ?`,
  ).bind(
    result.status,
    result.cursorAfter || null,
    result.recordsRead,
    result.recordsWritten,
    result.recordsSkipped,
    result.failureDetail || null,
    now,
    runId,
  ).run();
}

export async function getSyncCursor(db, provider) {
  const row = await db.prepare("SELECT cursor FROM sync_cursors WHERE provider = ?").bind(provider).first();
  return row?.cursor || null;
}

export async function setSyncCursor(db, provider, cursor, now) {
  await db.prepare(
    `INSERT INTO sync_cursors (provider, cursor, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
  ).bind(provider, cursor || null, now).run();
}

async function contactIdForExternalRecord(db, provider, objectType, externalId) {
  const row = await db.prepare(
    "SELECT contact_id FROM external_records WHERE provider = ? AND object_type = ? AND external_id = ?",
  ).bind(provider, objectType, externalId).first();
  return row?.contact_id || null;
}

async function replaceContactFacts(db, contactId, contact, now) {
  const statements = [
    db.prepare("DELETE FROM contact_tags WHERE contact_id = ? AND source = 'ghl'").bind(contactId),
    db.prepare("DELETE FROM contact_roles WHERE contact_id = ? AND source = 'ghl'").bind(contactId),
    db.prepare("DELETE FROM contact_attributes WHERE contact_id = ? AND source = 'ghl'").bind(contactId),
    ...contact.tags.map((tag) => db.prepare(
      "INSERT INTO contact_tags (contact_id, tag, source, created_at) VALUES (?, ?, 'ghl', ?)",
    ).bind(contactId, tag, now)),
    ...contact.roles.map((role) => db.prepare(
      "INSERT INTO contact_roles (contact_id, role, source, created_at) VALUES (?, ?, 'ghl', ?)",
    ).bind(contactId, role, now)),
    ...contact.attributes.map(([key, value]) => db.prepare(
      `INSERT INTO contact_attributes (contact_id, source, attribute_key, attribute_value, updated_at)
       VALUES (?, 'ghl', ?, ?, ?)`,
    ).bind(contactId, key, value, now)),
  ];
  await db.batch(statements);
}

export async function upsertGhlContact(db, contact, now) {
  let contactId = await contactIdForExternalRecord(db, "ghl", "contact", contact.externalId);
  if (contactId) {
    await db.prepare(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, display_name = ?, email_normalized = ?, phone_e164 = ?,
           referral_source_label = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contact.firstName, contact.lastName, contact.displayName, contact.email, contact.phone,
      contact.referralSourceLabel, now, contactId,
    ).run();
  } else {
    contactId = id();
    await db.prepare(
      `INSERT INTO contacts
       (id, first_name, last_name, display_name, email_normalized, phone_e164, referral_source_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      contactId, contact.firstName, contact.lastName, contact.displayName, contact.email, contact.phone,
      contact.referralSourceLabel, now, now,
    ).run();
  }
  // Always refresh last_seen_at. Full-pass completeness counts external_records
  // touched since the cycle started; skipping this on existing contacts made every
  // GHL cycle report ~0 seen and stay stuck in "needs review".
  await db.prepare(
    `INSERT INTO external_records
     (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
     VALUES (?, 'ghl', 'contact', ?, ?, 'contact', ?, ?)
     ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
       contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
  ).bind(id(), contact.externalId, contactId, contactId, now).run();
  await replaceContactFacts(db, contactId, contact, now);
  return contactId;
}

export async function findContactIdByGhlId(db, externalId) {
  return contactIdForExternalRecord(db, "ghl", "contact", externalId);
}

// A stable, source-scoped list keeps historic record import resumable without
// exposing the owned contact directory to GHL pagination semantics. This reads
// only contacts that are already linked to a GHL source record.
export async function listGhlContactExternalIds(db, afterExternalId, limit) {
  const result = await db.prepare(
    `SELECT external_id
     FROM external_records
     WHERE provider = 'ghl' AND object_type = 'contact' AND contact_id IS NOT NULL
       AND (? IS NULL OR external_id > ?)
     ORDER BY external_id ASC
     LIMIT ?`,
  ).bind(afterExternalId || null, afterExternalId || null, limit).all();
  return (result.results || []).map((row) => row.external_id).filter(Boolean);
}

export async function upsertCommunicationThread(db, thread, contactId, now) {
  const existing = await db.prepare(
    "SELECT id FROM communication_threads WHERE provider = 'ghl' AND provider_thread_id = ?",
  ).bind(thread.externalId).first();
  const threadId = existing?.id || id();
  const values = [contactId, thread.channel, thread.lastOccurredAt, thread.lastPreview, thread.lastDirection, thread.unreadInboundCount, now, threadId];
  if (existing) {
    await db.prepare(`UPDATE communication_threads SET contact_id = ?, channel = ?, last_event_at = ?, last_preview = ?, last_direction = ?, unread_inbound_count = ?, updated_at = ? WHERE id = ?`).bind(...values).run();
  } else {
    await db.prepare(`INSERT INTO communication_threads (id, contact_id, provider, provider_thread_id, channel, last_event_at, last_preview, last_direction, unread_inbound_count, created_at, updated_at) VALUES (?, ?, 'ghl', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(threadId, contactId, thread.externalId, thread.channel, thread.lastOccurredAt, thread.lastPreview, thread.lastDirection, thread.unreadInboundCount, now, now).run();
  }
  return threadId;
}

export async function upsertCommunicationEvent(db, event, threadId, contactId, now) {
  const existing = await db.prepare("SELECT id FROM communication_events WHERE provider = 'ghl' AND provider_event_id = ?").bind(event.externalId).first();
  const eventId = existing?.id || id();
  const values = [threadId, contactId, event.channel, event.direction, event.deliveryStatus, event.subject, event.body, event.occurredAt, event.senderLabel, now, eventId];
  if (existing) {
    await db.prepare(`UPDATE communication_events SET thread_id = ?, contact_id = ?, event_kind = ?, direction = ?, delivery_status = ?, subject = ?, body_clean = ?, occurred_at = ?, sender_label = ?, updated_at = ? WHERE id = ?`).bind(...values).run();
  } else {
    await db.prepare(`INSERT INTO communication_events (id, thread_id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status, subject, body_clean, occurred_at, sender_label, created_at, updated_at) VALUES (?, ?, ?, 'ghl', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(eventId, threadId, contactId, event.externalId, event.channel, event.direction, event.deliveryStatus, event.subject, event.body, event.occurredAt, event.senderLabel, now, now).run();
  }
  return eventId;
}

export async function ensureCommunicationThread(db, event, contactId, now) {
  const existing = await db.prepare("SELECT id FROM communication_threads WHERE provider = 'ghl' AND provider_thread_id = ?").bind(event.threadExternalId).first();
  if (existing) return existing.id;
  const threadId = id();
  await db.prepare(`INSERT INTO communication_threads (id, contact_id, provider, provider_thread_id, channel, last_event_at, last_preview, last_direction, unread_inbound_count, created_at, updated_at) VALUES (?, ?, 'ghl', ?, ?, ?, ?, ?, 0, ?, ?)`).bind(threadId, contactId, event.threadExternalId, event.channel, event.occurredAt, event.body, event.direction, now, now).run();
  return threadId;
}

// Webhook deliveries can be retried. Only a newly inserted provider message may
// update the unread count, so retries are harmless.
export async function recordRealtimeGhlMessage(db, event, contactId, now) {
  const prior = await db.prepare("SELECT id FROM communication_events WHERE provider = 'ghl' AND provider_event_id = ?").bind(event.externalId).first();
  if (prior) return { duplicate: true };
  const threadId = await ensureCommunicationThread(db, event, contactId, now);
  await upsertCommunicationEvent(db, event, threadId, contactId, now);
  await db.prepare(
    `UPDATE communication_threads
       SET contact_id = ?, channel = ?,
           last_event_at = CASE WHEN last_event_at IS NULL OR datetime(?) >= datetime(last_event_at) THEN ? ELSE last_event_at END,
           last_preview = CASE WHEN last_event_at IS NULL OR datetime(?) >= datetime(last_event_at) THEN ? ELSE last_preview END,
           last_direction = CASE WHEN last_event_at IS NULL OR datetime(?) >= datetime(last_event_at) THEN ? ELSE last_direction END,
           unread_inbound_count = unread_inbound_count + ?, updated_at = ?
     WHERE id = ?`,
  ).bind(contactId, event.channel, event.occurredAt, event.occurredAt, event.occurredAt, event.body, event.occurredAt, event.direction, event.direction === "inbound" ? 1 : 0, now, threadId).run();
  return { duplicate: false };
}

// Staff-owned sends retain their content in the owned CRM timeline and their
// immutable delivery audit separately. They never write a GHL conversation.
export async function recordOwnedOutboundEmail(db, { contactId, providerEventId, subject, body, actor }, now) {
  const existingThread = await db.prepare(
    `SELECT id FROM communication_threads WHERE contact_id = ? AND channel = 'email' ORDER BY datetime(last_event_at) DESC LIMIT 1`,
  ).bind(contactId).first();
  const threadId = existingThread?.id || id();
  if (!existingThread) {
    await db.prepare(
      `INSERT INTO communication_threads
       (id, contact_id, provider, provider_thread_id, channel, last_event_at, last_preview, last_direction, unread_inbound_count, created_at, updated_at)
       VALUES (?, ?, 'google-workspace', ?, 'email', ?, ?, 'outbound', 0, ?, ?)`,
    ).bind(threadId, contactId, `owned:${contactId}`, now, body, now, now).run();
  }
  const eventId = id();
  await db.batch([
    db.prepare(
      `INSERT INTO communication_events
       (id, thread_id, contact_id, provider, provider_event_id, event_kind, direction, delivery_status, subject, body_clean, occurred_at, sender_label, created_at, updated_at)
       VALUES (?, ?, ?, 'google-workspace', ?, 'email', 'outbound', 'sent', ?, ?, ?, ?, ?, ?)`,
    ).bind(eventId, threadId, contactId, providerEventId, subject, body, now, actor, now, now),
    db.prepare(
      `UPDATE communication_threads SET last_event_at = ?, last_preview = ?, last_direction = 'outbound', updated_at = ? WHERE id = ?`,
    ).bind(now, body, now, threadId),
  ]);
  return { threadId, eventId };
}

export async function recordGhlWebhookEvent(db, webhook, now) {
  const result = await db.prepare(
    `INSERT INTO ghl_webhook_events (webhook_id, event_type, contact_external_id, conversation_external_id, occurred_at, received_at, processing_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(webhook_id) DO NOTHING`,
  ).bind(webhook.id, webhook.type, webhook.contactExternalId, webhook.conversationExternalId, webhook.occurredAt, now, webhook.processingState).run();
  return Number(result.meta?.changes || 0) > 0;
}

// Reading a client record is a staff-owned acknowledgement. It never changes
// GHL's conversation state: the mirror uses it only to keep the Desk's
// attention marker meaningful across refreshes and source re-syncs.
export async function markClientDeskSeen(db, contactId, actor, now) {
  await db.prepare(
    `INSERT INTO client_desk_seen (contact_id, staff_actor, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(contact_id, staff_actor) DO UPDATE SET seen_at = excluded.seen_at`,
  ).bind(contactId, actor, now).run();
}

// Notes and tasks are first-class client records. They are intentionally kept
// separate from the append-only webhook journal so staff can read a current
// workspace without treating delivery metadata as the record itself.
export async function upsertClientNote(db, note, contactId, now) {
  const existing = await db.prepare(
    "SELECT id FROM client_notes WHERE provider_note_id = ?",
  ).bind(note.externalId).first();
  const noteId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE client_notes SET contact_id = ?, body = ?, authored_by = ?, created_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(contactId, note.body, note.authoredBy, note.createdAt || now, now, noteId).run();
  } else {
    await db.prepare(
      `INSERT INTO client_notes (id, contact_id, provider_note_id, body, authored_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(noteId, contactId, note.externalId, note.body, note.authoredBy, note.createdAt || now, now).run();
  }
  return noteId;
}

// Consent evidence is append-only. The source note ID makes a webhook retry or
// repeat backfill harmless while retaining the original GHL evidence reference.
export async function recordConsentObservation(db, observation, contactId, now) {
  const existing = await db.prepare(
    `SELECT id FROM consents
     WHERE contact_id = ? AND channel = ? AND source = ? AND evidence_ref = ?`,
  ).bind(contactId, observation.channel, observation.source, observation.evidenceRef).first();
  if (existing?.id) return { id: existing.id, inserted: false };
  const consentId = id();
  await db.prepare(
    `INSERT INTO consents
     (id, contact_id, channel, state, effective_at, source, evidence_ref, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'crm_mirror')`,
  ).bind(
    consentId,
    contactId,
    observation.channel,
    observation.state,
    observation.effectiveAt || now,
    observation.source,
    observation.evidenceRef,
  ).run();
  return { id: consentId, inserted: true };
}

// Project existing, auditable native-booking notes into the owned ledger. This
// makes no source-provider call or write, and a missing choice remains unknown.
export async function backfillNativeBookingConsents(db, now) {
  const result = await db.prepare(
    `SELECT contact_id, provider_note_id, body, created_at
     FROM client_notes
     WHERE lower(body) LIKE '%native booking flow%'
       AND lower(body) LIKE '%communications consent:%'`,
  ).all();
  let recordsRead = 0;
  let recordsWritten = 0;
  for (const row of result.results || []) {
    recordsRead += 1;
    const matched = String(row.body || "").match(/communications consent:\s*(yes|no\s*\(optional,\s*declined\))/i);
    if (!matched || !row.provider_note_id) continue;
    const state = matched[1].toLowerCase() === "yes" ? "granted" : "revoked";
    for (const channel of ["email", "sms"]) {
      const recorded = await recordConsentObservation(db, {
        channel,
        state,
        source: "ghl_native_booking_note",
        evidenceRef: row.provider_note_id,
        effectiveAt: row.created_at,
      }, row.contact_id, now);
      if (recorded.inserted) recordsWritten += 1;
    }
  }
  return { recordsRead, recordsWritten };
}

export async function deleteClientNote(db, providerNoteId) {
  await db.prepare("DELETE FROM client_notes WHERE provider_note_id = ?").bind(providerNoteId).run();
}

export async function upsertClientTask(db, task, contactId, now) {
  const existing = await db.prepare(
    "SELECT id FROM client_tasks WHERE provider_task_id = ?",
  ).bind(task.externalId).first();
  const taskId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE client_tasks SET contact_id = ?, title = ?, due_at = ?, completed_at = ?, status = ?, created_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(contactId, task.title, task.dueAt, task.completedAt, task.status, task.createdAt || now, now, taskId).run();
  } else {
    await db.prepare(
      `INSERT INTO client_tasks (id, contact_id, provider_task_id, title, due_at, completed_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(taskId, contactId, task.externalId, task.title, task.dueAt, task.completedAt, task.status, task.createdAt || now, now).run();
  }
  return taskId;
}

export async function deleteClientTask(db, providerTaskId) {
  await db.prepare("DELETE FROM client_tasks WHERE provider_task_id = ?").bind(providerTaskId).run();
}

// After a GHL full pass, drop external_records for contacts confirmed deleted in
// GHL so completeness does not stay stuck in "needs review" on ghost rows.
// Mirror contact history is retained; only the provider linkage row is removed.
export async function dropAbsentGhlContacts(db, cycleStartedAt, contactExists) {
  const missing = await db.prepare(
    `SELECT external_id FROM external_records
     WHERE provider = 'ghl' AND object_type = 'contact'
       AND datetime(last_seen_at) < datetime(?)`,
  ).bind(cycleStartedAt).all();
  let dropped = 0;
  for (const row of missing.results || []) {
    if (await contactExists(row.external_id)) continue;
    await db.prepare(
      `DELETE FROM external_records
       WHERE provider = 'ghl' AND object_type = 'contact' AND external_id = ?`,
    ).bind(row.external_id).run();
    dropped += 1;
  }
  return dropped;
}

async function findUniqueContactIdByEmail(db, email) {
  if (!email) return null;
  const result = await db.prepare(
    "SELECT id FROM contacts WHERE email_normalized = ? ORDER BY id LIMIT 2",
  ).bind(email).all();
  const rows = result.results || [];
  return rows.length === 1 ? rows[0].id : null;
}

async function refreshEmailReconciliationCandidate(db, purchaseId, billingEmail, now) {
  // Regeneration is intentionally narrow: this importer owns only its own
  // pending email evidence. A future human review decision must never be erased.
  await db.prepare(
    "DELETE FROM purchase_reconciliation_candidates WHERE purchase_id = ? AND match_basis = 'unique_billing_email' AND state = 'pending_review'",
  ).bind(purchaseId).run();
  const contactId = await findUniqueContactIdByEmail(db, billingEmail);
  if (!contactId) return false;
  await db.prepare(
    `INSERT INTO purchase_reconciliation_candidates
     (id, purchase_id, contact_id, match_basis, state, created_at)
     VALUES (?, ?, ?, 'unique_billing_email', 'pending_review', ?)
     ON CONFLICT(purchase_id, contact_id, match_basis) DO NOTHING`,
  ).bind(id(), purchaseId, contactId, now).run();
  return true;
}

export async function upsertGhlAppointment(db, appointment, contactId, now) {
  const service = appointment.calendarId
    ? await db.prepare("SELECT id FROM services WHERE provider_calendar_id = ?").bind(appointment.calendarId).first()
    : null;
  const existing = await db.prepare(
    "SELECT id FROM appointments WHERE provider_appointment_id = ?",
  ).bind(appointment.externalId).first();
  const appointmentId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE appointments
       SET contact_id = ?, service_id = ?, provider_calendar_id = ?, provider_status_raw = ?, status = ?,
           starts_at = ?, ends_at = ?, timezone = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, service?.id || null, appointment.calendarId, appointment.providerStatusRaw, appointment.status,
      appointment.startsAt, appointment.endsAt, appointment.timezone, now, appointmentId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO appointments
       (id, contact_id, service_id, provider_appointment_id, provider_calendar_id, provider_status_raw,
        status, starts_at, ends_at, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      appointmentId, contactId, service?.id || null, appointment.externalId, appointment.calendarId,
      appointment.providerStatusRaw, appointment.status, appointment.startsAt, appointment.endsAt,
      appointment.timezone, now, now,
    ).run();
  }
  await db.prepare(
    `INSERT INTO external_records
     (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
     VALUES (?, 'ghl', 'appointment', ?, ?, 'appointment', ?, ?)
     ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
       contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
  ).bind(id(), appointment.externalId, contactId, appointmentId, now).run();
  return appointmentId;
}

export async function upsertStripeCharge(db, charge, now) {
  const sourceContactId = charge.contactExternalId
    ? await findContactIdByGhlId(db, charge.contactExternalId)
    : null;
  const existing = await db.prepare(
    "SELECT id, contact_id, package_id, classification, classification_review_state FROM purchases WHERE provider_charge_id = ?",
  ).bind(charge.externalId).first();
  // A direct GHL metadata stamp is authoritative. In every other case retain an
  // existing human-accepted link; importing a charge must not erase it.
  const contactId = sourceContactId || existing?.contact_id || null;
  const purchaseId = existing?.id || id();
  // A human classification is durable mirror data. Provider normalization can
  // improve an unreviewed row, but it must never turn a reviewed legacy record
  // back into "unclassified" on the next Stripe sweep.
  const keepReviewedClassification = Boolean(existing && existing.classification_review_state !== "pending_review");
  const packageId = keepReviewedClassification ? existing.package_id : charge.packageId;
  const classification = keepReviewedClassification ? existing.classification : charge.classification;
  if (existing) {
    await db.prepare(
      `UPDATE purchases
       SET contact_id = ?, package_id = ?, provider_customer_id = ?, provider_status = ?, amount_cents = ?,
           amount_refunded_cents = ?, currency = ?, purchased_at = ?, classification = ?, billing_email_normalized = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, packageId, charge.customerExternalId, charge.providerStatus, charge.amountCents,
      charge.amountRefundedCents, charge.currency, charge.purchasedAt, classification, charge.billingEmail, now, purchaseId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO purchases
       (id, contact_id, package_id, provider_charge_id, provider_customer_id, provider_status, amount_cents,
        amount_refunded_cents, currency, purchased_at, classification, billing_email_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      purchaseId, contactId, packageId, charge.externalId, charge.customerExternalId, charge.providerStatus,
      charge.amountCents, charge.amountRefundedCents, charge.currency, charge.purchasedAt, classification,
      charge.billingEmail, now, now,
    ).run();
  }
  await db.prepare(
    `INSERT INTO external_records
     (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
     VALUES (?, 'stripe', 'charge', ?, ?, 'purchase', ?, ?)
     ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
       contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
  ).bind(id(), charge.externalId, contactId, purchaseId, now).run();
  let hasEmailCandidate = false;
  if (sourceContactId) {
    await db.prepare(
      "DELETE FROM purchase_reconciliation_candidates WHERE purchase_id = ? AND match_basis = 'unique_billing_email' AND state = 'pending_review'",
    ).bind(purchaseId).run();
  } else {
    hasEmailCandidate = await refreshEmailReconciliationCandidate(db, purchaseId, charge.billingEmail, now);
  }
  return { purchaseId, linked: Boolean(contactId), hasEmailCandidate };
}

async function findUniqueContactIdByStripeCustomer(db, customerExternalId) {
  if (!customerExternalId) return null;
  const result = await db.prepare(
    `SELECT DISTINCT contact_id
     FROM purchases
     WHERE provider_customer_id = ? AND contact_id IS NOT NULL
     ORDER BY contact_id
     LIMIT 2`,
  ).bind(customerExternalId).all();
  const rows = result.results || [];
  return rows.length === 1 ? rows[0].contact_id : null;
}

// An invoice can join a client record only through an explicit GHL contact ID
// from Stripe metadata or one unambiguous Stripe-customer association already
// established by an authoritative/reviewed charge. Billing email is never used
// to auto-link an invoice.
export async function upsertStripeInvoice(db, invoice, now) {
  const sourceContactId = invoice.contactExternalId
    ? await findContactIdByGhlId(db, invoice.contactExternalId)
    : null;
  const existing = await db.prepare(
    "SELECT id, contact_id FROM stripe_invoices WHERE provider_invoice_id = ?",
  ).bind(invoice.externalId).first();
  const mappedCustomerContactId = sourceContactId ? null
    : await findUniqueContactIdByStripeCustomer(db, invoice.customerExternalId);
  const contactId = sourceContactId || existing?.contact_id || mappedCustomerContactId || null;
  const invoiceId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE stripe_invoices
       SET contact_id = ?, provider_customer_id = ?, stripe_payment_intent_id = ?, invoice_number = ?,
           description = ?, provider_status = ?, collection_method = ?, amount_due_cents = ?,
           amount_paid_cents = ?, amount_remaining_cents = ?, currency = ?, issued_at = ?, due_at = ?,
           paid_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, invoice.customerExternalId, invoice.paymentIntentExternalId, invoice.invoiceNumber,
      invoice.description, invoice.providerStatus, invoice.collectionMethod, invoice.amountDueCents,
      invoice.amountPaidCents, invoice.amountRemainingCents, invoice.currency, invoice.issuedAt,
      invoice.dueAt, invoice.paidAt, now, invoiceId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO stripe_invoices
       (id, contact_id, provider_invoice_id, provider_customer_id, stripe_payment_intent_id, invoice_number,
        description, provider_status, collection_method, amount_due_cents, amount_paid_cents,
        amount_remaining_cents, currency, issued_at, due_at, paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      invoiceId, contactId, invoice.externalId, invoice.customerExternalId, invoice.paymentIntentExternalId,
      invoice.invoiceNumber, invoice.description, invoice.providerStatus, invoice.collectionMethod,
      invoice.amountDueCents, invoice.amountPaidCents, invoice.amountRemainingCents, invoice.currency,
      invoice.issuedAt, invoice.dueAt, invoice.paidAt, now, now,
    ).run();
  }
  await db.prepare(
    `INSERT INTO external_records
     (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
     VALUES (?, 'stripe', 'invoice', ?, ?, 'stripe_invoice', ?, ?)
     ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
       contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
  ).bind(id(), invoice.externalId, contactId, invoiceId, now).run();
  return { invoiceId, linked: Boolean(contactId) };
}

export const SYNC_STALE_AFTER_MINUTES = 45;

function providerSyncHealth(run, nowMs) {
  if (!run?.finished_at) return { state: "missing", lastRun: run || null, ageMinutes: null };
  const finishedMs = Date.parse(run.finished_at);
  const ageMinutes = Number.isFinite(finishedMs) ? Math.max(0, Math.floor((nowMs - finishedMs) / 60000)) : null;
  if (run.status === "failed") return { state: "failed", lastRun: run, ageMinutes };
  if (ageMinutes == null || ageMinutes > SYNC_STALE_AFTER_MINUTES) return { state: "stale", lastRun: run, ageMinutes };
  // A partial GHL run is normal while a bounded cursor works through contacts.
  return { state: "healthy", lastRun: run, ageMinutes };
}

export function syncHealthForRuns(runs, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const providers = Object.fromEntries(
    ["ghl", "stripe"].map((provider) => [provider, providerSyncHealth(runs?.[provider], nowMs)]),
  );
  const states = Object.values(providers).map((provider) => provider.state);
  const overall = states.includes("failed") ? "failed"
    : states.includes("stale") ? "stale"
      : states.includes("missing") ? "waiting"
        : "healthy";
  return { overall, staleAfterMinutes: SYNC_STALE_AFTER_MINUTES, providers };
}

function completedReadinessEvidence(row, current) {
  if (row) {
    return {
      state: Number(row.missing_records || 0) > 0 ? "review" : "complete",
      ...row,
    };
  }
  if (current?.lastRun?.status === "succeeded") {
    return {
      state: "complete",
      records_seen: null,
      known_records: null,
      missing_records: 0,
      completed_at: current.lastRun.finished_at || null,
    };
  }
  return { state: "in_progress" };
}

export function readinessCompletenessForProvider(row, current) {
  const evidence = completedReadinessEvidence(row, current);
  const currentState = current?.state || "missing";
  return {
    ...evidence,
    state: currentState === "healthy" ? evidence.state : currentState,
    currentSync: {
      state: currentState,
      ageMinutes: current?.ageMinutes ?? null,
      status: current?.lastRun?.status || null,
      finishedAt: current?.lastRun?.finished_at || null,
      failureDetail: current?.lastRun?.failure_detail || null,
    },
  };
}

export async function mirrorStatus(db, now = new Date().toISOString()) {
  const [contacts, appointments, purchases, invoices, threads, events, unread, lastSync, latestGhl, latestStripe, latestInvoiceImport, latestCommunicationImport, latestClientRecordImport] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM contacts"),
    db.prepare("SELECT COUNT(*) AS count FROM appointments"),
    db.prepare("SELECT COUNT(*) AS count FROM purchases"),
    db.prepare("SELECT COUNT(*) AS count FROM stripe_invoices"),
    db.prepare("SELECT COUNT(*) AS count FROM communication_threads"),
    db.prepare("SELECT COUNT(*) AS count FROM communication_events"),
    db.prepare("SELECT COALESCE(SUM(unread_inbound_count), 0) AS count FROM communication_threads"),
    db.prepare("SELECT provider, status, finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT provider, status, finished_at, records_read, records_written, failure_detail FROM sync_runs WHERE provider = 'ghl' ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT provider, status, finished_at, records_read, records_written, failure_detail FROM sync_runs WHERE provider = 'stripe' ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT status, finished_at, records_read, records_written, records_skipped, failure_detail FROM sync_runs WHERE provider = 'stripe' AND cursor_before LIKE 'invoices:%' ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT status, finished_at, records_read, records_written, failure_detail FROM sync_runs WHERE provider = 'ghl' AND (cursor_before = 'message-export' OR cursor_before LIKE 'conversations:%') ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT status, finished_at, records_read, records_written, records_skipped, failure_detail FROM sync_runs WHERE provider = 'ghl' AND cursor_before LIKE 'client-records:%' ORDER BY started_at DESC LIMIT 1"),
  ]);
  return {
    contacts: Number(contacts.results?.[0]?.count || 0),
    appointments: Number(appointments.results?.[0]?.count || 0),
    purchases: Number(purchases.results?.[0]?.count || 0),
    invoices: {
      total: Number(invoices.results?.[0]?.count || 0),
      latestImport: latestInvoiceImport.results?.[0] || null,
    },
    communications: {
      threads: Number(threads.results?.[0]?.count || 0),
      events: Number(events.results?.[0]?.count || 0),
      unreadInbound: Number(unread.results?.[0]?.count || 0),
      latestImport: latestCommunicationImport.results?.[0] || null,
    },
    clientRecords: {
      latestImport: latestClientRecordImport.results?.[0] || null,
    },
    lastSync: lastSync.results?.[0] || null,
    syncHealth: syncHealthForRuns({
      ghl: latestGhl.results?.[0] || null,
      stripe: latestStripe.results?.[0] || null,
    }, now),
  };
}

// Aggregate-only contract for the deterministic monitor and /day. Historical
// completeness/recovery evidence is useful, but a current failed/stale source
// must override it so this endpoint cannot become a false-green snapshot.
export async function mirrorReadiness(db, now = new Date().toISOString()) {
  const result = await db.batch([
    db.prepare(
      `SELECT started_at, completed_at, records_seen, known_records, missing_records
       FROM mirror_sync_cycles WHERE provider = 'ghl' AND status = 'completed'
       ORDER BY datetime(completed_at) DESC LIMIT 1`,
    ),
    db.prepare(
      `SELECT started_at, completed_at, records_seen, known_records, missing_records
       FROM mirror_sync_cycles WHERE provider = 'stripe' AND status = 'completed'
       ORDER BY datetime(completed_at) DESC LIMIT 1`,
    ),
    db.prepare(
      `SELECT status, finished_at, records_read, records_written, failure_detail
       FROM sync_runs
       WHERE provider = 'ghl' AND finished_at IS NOT NULL
         AND (cursor_before IS NULL OR (cursor_before <> 'message-export'
           AND cursor_before NOT LIKE 'conversations:%'
           AND cursor_before NOT LIKE 'client-records:%'))
       ORDER BY datetime(started_at) DESC LIMIT 1`,
    ),
    db.prepare(
      `SELECT status, finished_at, records_read, records_written, failure_detail
       FROM sync_runs
       WHERE provider = 'stripe' AND finished_at IS NOT NULL
         AND (cursor_before IS NULL OR cursor_before NOT LIKE 'invoices:%')
       ORDER BY datetime(started_at) DESC LIMIT 1`,
    ),
    db.prepare("SELECT COUNT(*) AS count FROM communications"),
    db.prepare("SELECT COUNT(*) AS count FROM consents"),
    db.prepare("SELECT COUNT(*) AS count FROM payment_identity_exceptions WHERE state = 'open'"),
    db.prepare("SELECT result, checked_at FROM mirror_recovery_checks ORDER BY datetime(checked_at) DESC LIMIT 1"),
    db.prepare("SELECT health_key, state, detected_at FROM mirror_health_events WHERE resolved_at IS NULL ORDER BY datetime(detected_at) DESC LIMIT 25"),
  ]);
  const syncHealth = syncHealthForRuns({
    ghl: result[2].results?.[0] || null,
    stripe: result[3].results?.[0] || null,
  }, now);
  return {
    shadowOnly: true,
    completeness: {
      ghl: readinessCompletenessForProvider(result[0].results?.[0] || null, syncHealth.providers.ghl),
      stripe: readinessCompletenessForProvider(result[1].results?.[0] || null, syncHealth.providers.stripe),
    },
    communications: Number(result[4].results?.[0]?.count || 0),
    consentObservations: Number(result[5].results?.[0]?.count || 0),
    openPaymentIdentityExceptions: Number(result[6].results?.[0]?.count || 0),
    recovery: result[7].results?.[0] || { result: "unverified", checked_at: null },
    openHealthEvents: result[8].results || [],
    currentSyncOverall: syncHealth.overall,
    staleAfterMinutes: syncHealth.staleAfterMinutes,
  };
}

// This is an operator-facing read model, not a replacement session ledger.
// Until the new CRM is the canonical writer, the imported GHL balance remains
// the only balance shown here and is deliberately labeled as such in the UI.
export async function activeClientOperations(db, limit, now) {
  const [activeClients, upcomingAppointments, totals] = await db.batch([
    db.prepare(
      `SELECT
         contact.id AS contact_id,
         contact.display_name,
         balance.attribute_value AS sessions_remaining,
         series.attribute_value AS series_type,
         appointment.starts_at AS next_appointment_at,
         appointment.status AS next_appointment_status,
         service.name AS next_service_name
       FROM contacts contact
       JOIN contact_attributes balance
         ON balance.contact_id = contact.id
        AND balance.source = 'ghl'
        AND balance.attribute_key = 'wrQSkx6BhXwDGIn1d0V4'
       LEFT JOIN contact_attributes series
         ON series.contact_id = contact.id
        AND series.source = 'ghl'
        AND series.attribute_key = '3i93lTkmuAV49s9nh0q8'
       LEFT JOIN appointments appointment
         ON appointment.id = (
           SELECT future.id
           FROM appointments future
           WHERE future.contact_id = contact.id
             AND future.status IN ('booked', 'confirmed')
             AND datetime(future.starts_at) >= datetime(?)
           ORDER BY datetime(future.starts_at), future.id
           LIMIT 1
         )
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE CAST(TRIM(balance.attribute_value) AS INTEGER) > 0
       ORDER BY appointment.starts_at IS NULL, datetime(appointment.starts_at), contact.display_name
       LIMIT ?`,
    ).bind(now, limit),
    db.prepare(
      `SELECT
         appointment.id AS appointment_id,
         appointment.starts_at,
         appointment.status,
         contact.id AS contact_id,
         contact.display_name,
         service.name AS service_name
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.status IN ('booked', 'confirmed')
         AND datetime(appointment.starts_at) >= datetime(?)
       ORDER BY datetime(appointment.starts_at), appointment.id
       LIMIT ?`,
    ).bind(now, limit),
    db.prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM contacts contact
          JOIN contact_attributes balance
            ON balance.contact_id = contact.id
           AND balance.source = 'ghl'
           AND balance.attribute_key = 'wrQSkx6BhXwDGIn1d0V4'
          WHERE CAST(TRIM(balance.attribute_value) AS INTEGER) > 0) AS active_clients,
         (SELECT COUNT(*)
          FROM appointments appointment
          WHERE appointment.status IN ('booked', 'confirmed')
            AND datetime(appointment.starts_at) >= datetime(?)) AS upcoming_appointments`,
    ).bind(now),
  ]);
  const summary = totals.results?.[0] || {};
  return {
    balanceSource: 'ghl_imported_fields',
    automaticLedgerPosting: false,
    totalActiveClients: Number(summary.active_clients || 0),
    totalUpcomingAppointments: Number(summary.upcoming_appointments || 0),
    activeClients: activeClients.results || [],
    upcomingAppointments: upcomingAppointments.results || [],
  };
}

function likePattern(value) {
  return `%${String(value).replace(/[\\%_]/g, "\\$&").toLowerCase()}%`;
}

export async function searchContacts(db, query, limit) {
  if (!query) return [];
  const result = await db.prepare(
    `SELECT id, display_name, email_normalized, phone_e164
     FROM contacts
     WHERE lower(display_name) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(email_normalized, '')) LIKE ? ESCAPE '\\'
        OR COALESCE(phone_e164, '') LIKE ? ESCAPE '\\'
     ORDER BY display_name, id
     LIMIT ?`,
  ).bind(likePattern(query), likePattern(query), `%${String(query).replace(/[\\%_]/g, "\\$&")}%`, limit).all();
  return result.results || [];
}

// Read-only Client Desk index. A client is any mirrored contact with an
// appointment or settled purchase; this keeps unqualified prospect records out
// of the default daily view while preserving a deliberate "all contacts" mode.
export async function clientDeskContacts(db, { query = null, limit = 50, scope = "clients" } = {}) {
  const filters = [];
  const values = [];
  if (scope !== "all") {
    filters.push(`(
      EXISTS (SELECT 1 FROM appointments appointment WHERE appointment.contact_id = contact.id)
      OR EXISTS (SELECT 1 FROM purchases purchase WHERE purchase.contact_id = contact.id)
    )`);
  }
  if (query) {
    const pattern = likePattern(query);
    filters.push(`(
      lower(contact.display_name) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(contact.email_normalized, '')) LIKE ? ESCAPE '\\'
      OR COALESCE(contact.phone_e164, '') LIKE ? ESCAPE '\\'
    )`);
    values.push(pattern, pattern, `%${String(query).replace(/[\\%_]/g, "\\$&")}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await db.prepare(
    `SELECT contact.id, contact.display_name, contact.email_normalized, contact.phone_e164,
            communication.channel AS last_channel, communication.direction AS last_direction,
            communication.occurred_at AS last_occurred_at, communication.subject_or_preview AS last_preview,
            upcoming.starts_at AS next_appointment_at, upcoming_service.name AS next_service_name
       FROM contacts contact
       LEFT JOIN communications communication ON communication.id = (
         SELECT id FROM communications
         WHERE contact_id = contact.id
         ORDER BY datetime(occurred_at) DESC, id DESC
         LIMIT 1
       )
       LEFT JOIN appointments upcoming ON upcoming.id = (
         SELECT id FROM appointments appointment
         WHERE appointment.contact_id = contact.id
           AND appointment.status IN ('booked', 'confirmed')
           AND datetime(appointment.starts_at) >= datetime('now')
         ORDER BY datetime(appointment.starts_at), id
         LIMIT 1
       )
       LEFT JOIN services upcoming_service ON upcoming_service.id = upcoming.service_id
       ${where}
       ORDER BY CASE WHEN communication.direction = 'inbound' THEN 0 ELSE 1 END,
                CASE WHEN communication.occurred_at IS NULL THEN 1 ELSE 0 END,
                datetime(communication.occurred_at) DESC,
                lower(contact.display_name), contact.id
       LIMIT ?`,
  ).bind(...values, limit).all();
  return result.results || [];
}

// Complete staff communication index: one row for every mirrored contact,
// ordered by the latest observed communication. System and automated events
// remain visible; the Desk is an operating view, not a filtered client queue.
export async function communicationsInbox(db, { query = null, limit = 50, actor = "Staff" } = {}) {
  const values = [];
  const filters = [];
  if (query) {
    const pattern = likePattern(query);
    filters.push(`(lower(contact.display_name) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(contact.email_normalized, '')) LIKE ? ESCAPE '\\'
      OR COALESCE(contact.phone_e164, '') LIKE ? ESCAPE '\\')`);
    values.push(pattern, pattern, `%${String(query).replace(/[\\%_]/g, "\\$&")}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await db.prepare(
    `WITH latest_threads AS (
       SELECT thread.id AS thread_id, thread.contact_id, thread.channel, thread.last_event_at,
              thread.last_preview, thread.last_direction, thread.unread_inbound_count,
              ROW_NUMBER() OVER (
                PARTITION BY thread.contact_id
                ORDER BY datetime(thread.last_event_at) DESC, thread.id DESC
              ) AS recency_rank
       FROM communication_threads thread
     )
     SELECT thread.thread_id, thread.channel, thread.last_event_at, thread.last_preview,
            thread.last_direction,
            CASE WHEN thread.unread_inbound_count > 0
                    AND (seen.seen_at IS NULL OR datetime(thread.last_event_at) > datetime(seen.seen_at))
                 THEN 1 ELSE 0 END AS unread_inbound_count,
            contact.id AS contact_id, contact.display_name, contact.email_normalized, contact.phone_e164
       FROM contacts contact
       LEFT JOIN latest_threads thread
         ON thread.contact_id = contact.id AND thread.recency_rank = 1
       LEFT JOIN client_desk_seen seen
         ON seen.contact_id = contact.id AND seen.staff_actor = ?
       ${where}
       ORDER BY CASE WHEN thread.last_event_at IS NULL THEN 1 ELSE 0 END,
                datetime(thread.last_event_at) DESC,
                datetime(contact.created_at) DESC,
                lower(contact.display_name), contact.id
       LIMIT ?`,
  ).bind(...values, actor, limit).all();
  return result.results || [];
}

// Read-only queue for staff to see which records have no channel-specific
// evidence. It intentionally contains no action to change a source record.
// Per the approved delivery policy, "unknown" is eligible only when the
// channel is otherwise usable and has no explicit DND/opt-out block.
export async function consentReviewQueue(db, limit) {
  const currentConsent = `
    WITH ranked AS (
      SELECT contact_id, channel, state, source, effective_at,
             ROW_NUMBER() OVER (PARTITION BY contact_id, channel ORDER BY datetime(effective_at) DESC, id DESC) AS rank
      FROM consents
      WHERE state <> 'unknown'
    ), current AS (
      SELECT contact_id,
             MAX(CASE WHEN channel = 'email' AND rank = 1 THEN state END) AS email_state,
             MAX(CASE WHEN channel = 'email' AND rank = 1 THEN source END) AS email_source,
             MAX(CASE WHEN channel = 'sms' AND rank = 1 THEN state END) AS sms_state,
             MAX(CASE WHEN channel = 'sms' AND rank = 1 THEN source END) AS sms_source
      FROM ranked
      WHERE rank = 1
      GROUP BY contact_id
    )`;
  const [summary, rows] = await db.batch([
    db.prepare(`${currentConsent}
      SELECT
        SUM(CASE WHEN COALESCE(current.email_state, 'unknown') = 'unknown' THEN 1 ELSE 0 END) AS email_unknown,
        SUM(CASE WHEN COALESCE(current.sms_state, 'unknown') = 'unknown' THEN 1 ELSE 0 END) AS sms_unknown,
        SUM(CASE WHEN COALESCE(current.email_state, 'unknown') = 'granted' THEN 1 ELSE 0 END) AS email_granted,
        SUM(CASE WHEN COALESCE(current.sms_state, 'unknown') = 'granted' THEN 1 ELSE 0 END) AS sms_granted
      FROM contacts contact
      LEFT JOIN current ON current.contact_id = contact.id`).bind(),
    db.prepare(`${currentConsent}
      SELECT contact.id AS contact_id, contact.display_name,
             COALESCE(current.email_state, 'unknown') AS email_state,
             COALESCE(current.email_source, 'no_auditable_evidence') AS email_source,
             COALESCE(current.sms_state, 'unknown') AS sms_state,
             COALESCE(current.sms_source, 'no_auditable_evidence') AS sms_source
      FROM contacts contact
      LEFT JOIN current ON current.contact_id = contact.id
      WHERE COALESCE(current.email_state, 'unknown') = 'unknown'
         OR COALESCE(current.sms_state, 'unknown') = 'unknown'
      ORDER BY lower(contact.display_name), contact.id
      LIMIT ?`).bind(limit),
  ]);
  const counts = summary.results?.[0] || {};
  return {
    readOnly: true,
    summary: {
      emailUnknown: Number(counts.email_unknown || 0),
      smsUnknown: Number(counts.sms_unknown || 0),
      emailGranted: Number(counts.email_granted || 0),
      smsGranted: Number(counts.sms_granted || 0),
    },
    contacts: rows.results || [],
  };
}

export async function contactProfile(db, contactId, limit, now) {
  const [contactResult, tagsResult, rolesResult, attributesResult, stateResult, nextAppointmentResult, appointmentsResult, communicationsResult, timelineResult, purchasesResult, purchaseCandidatesResult, invoicesResult, notesResult, tasksResult, consentResult, messageActivityResult, appointmentActivityResult, paymentActivityResult, invoiceActivityResult, noteActivityResult, taskActivityResult] = await db.batch([
    db.prepare(
      `SELECT contact.id, contact.display_name, contact.email_normalized, contact.phone_e164,
              contact.referral_source_label, contact.created_at,
              source.external_id AS ghl_contact_id
       FROM contacts contact
       LEFT JOIN external_records source
         ON source.contact_id = contact.id
        AND source.provider = 'ghl'
        AND source.object_type = 'contact'
       WHERE contact.id = ?`,
    ).bind(contactId),
    db.prepare(
      "SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag",
    ).bind(contactId),
    db.prepare(
      "SELECT role FROM contact_roles WHERE contact_id = ? ORDER BY role",
    ).bind(contactId),
    db.prepare(
      `SELECT attribute_key, attribute_value, source, updated_at
       FROM contact_attributes
       WHERE contact_id = ?
       ORDER BY source, attribute_key`,
    ).bind(contactId),
    db.prepare(
      `SELECT
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS sessions_remaining,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS sessions_completed,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS series_type,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS portal_access,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS living_practice_access
       FROM contact_attributes
       WHERE contact_id = ? AND source = 'ghl'`,
    ).bind(
      GHL_FIELD_IDS.sessionsRemaining,
      GHL_FIELD_IDS.sessionsCompleted,
      GHL_FIELD_IDS.seriesType,
      GHL_FIELD_IDS.portalAccess,
      GHL_FIELD_IDS.livingPracticeAccess,
      contactId,
    ),
    db.prepare(
      `SELECT appointment.starts_at, appointment.status, service.name AS service_name
       FROM appointments appointment
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.contact_id = ?
         AND appointment.status IN ('booked', 'confirmed')
         AND datetime(appointment.starts_at) >= datetime(?)
       ORDER BY datetime(appointment.starts_at), appointment.id
       LIMIT 1`,
    ).bind(contactId, now),
    db.prepare(
      `SELECT appointment.starts_at, appointment.ends_at, appointment.status, service.name AS service_name
       FROM appointments appointment
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.contact_id = ?
       ORDER BY datetime(appointment.starts_at) DESC, appointment.id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT COALESCE(thread.channel, event.event_kind) AS channel, event.direction,
              event.delivery_status AS provider_status, event.occurred_at,
              COALESCE(event.subject, event.body_clean) AS subject_or_preview
       FROM communication_events event
       LEFT JOIN communication_threads thread ON thread.id = event.thread_id
       WHERE event.contact_id = ?
       ORDER BY datetime(event.occurred_at) DESC, event.id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT event.id, event.event_kind, event.direction, event.delivery_status,
              event.subject, event.body_clean, event.occurred_at, event.sender_label,
              event.read_at, thread.channel AS thread_channel
       FROM communication_events event
       LEFT JOIN communication_threads thread ON thread.id = event.thread_id
       WHERE event.contact_id = ?
       ORDER BY datetime(event.occurred_at) DESC, event.id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT amount_cents, amount_refunded_cents, currency, purchased_at, provider_status,
              classification, classification_review_state
       FROM purchases
       WHERE contact_id = ?
       ORDER BY datetime(purchased_at) DESC, id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT purchase.amount_cents, purchase.amount_refunded_cents, purchase.currency,
              purchase.purchased_at, purchase.provider_status, purchase.classification,
              purchase.classification_review_state, 'match_review' AS identity_status
       FROM purchase_reconciliation_candidates candidate
       JOIN purchases purchase ON purchase.id = candidate.purchase_id
       WHERE candidate.contact_id = ?
         AND candidate.state = 'pending_review'
         AND purchase.contact_id IS NULL
       ORDER BY datetime(purchase.purchased_at) DESC, purchase.id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT invoice_number, description, provider_status, collection_method, amount_due_cents,
              amount_paid_cents, amount_remaining_cents, currency, issued_at, due_at, paid_at
       FROM stripe_invoices
       WHERE contact_id = ?
       ORDER BY datetime(issued_at) DESC, id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT body, authored_by, created_at, updated_at
       FROM client_notes WHERE contact_id = ?
       ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT title, due_at, completed_at, status, created_at, updated_at
       FROM client_tasks WHERE contact_id = ?
       ORDER BY CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,
                datetime(due_at) ASC, datetime(created_at) DESC, id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT channel, state, source, effective_at
       FROM (
         SELECT channel, state, source, effective_at,
                ROW_NUMBER() OVER (PARTITION BY channel ORDER BY datetime(effective_at) DESC, id DESC) AS recency_rank
         FROM consents WHERE contact_id = ? AND state <> 'unknown'
       )
       WHERE recency_rank = 1
       ORDER BY channel`,
    ).bind(contactId),
    db.prepare(
      `SELECT 'message' AS activity_type, event.occurred_at, event.direction,
              COALESCE(thread.channel, event.event_kind) AS channel, event.delivery_status,
              event.subject, event.body_clean AS body, NULL AS status, NULL AS detail,
              NULL AS amount_cents, NULL AS currency
       FROM communication_events event LEFT JOIN communication_threads thread ON thread.id = event.thread_id
       WHERE event.contact_id = ?
       ORDER BY datetime(event.occurred_at) DESC, event.id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT 'appointment' AS activity_type, appointment.starts_at AS occurred_at, NULL AS direction,
              NULL AS channel, NULL AS delivery_status, NULL AS subject, NULL AS body,
              appointment.status, COALESCE(service.name, 'Appointment') AS detail, NULL AS amount_cents, NULL AS currency
       FROM appointments appointment LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.contact_id = ? ORDER BY datetime(appointment.starts_at) DESC, appointment.id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT 'payment' AS activity_type, purchase.purchased_at AS occurred_at, NULL AS direction,
              NULL AS channel, purchase.provider_status AS delivery_status, NULL AS subject,
              purchase.classification AS body, NULL AS status, NULL AS detail,
              purchase.amount_cents, purchase.currency
       FROM purchases purchase WHERE purchase.contact_id = ? ORDER BY datetime(purchase.purchased_at) DESC, purchase.id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT 'invoice' AS activity_type, invoice.issued_at AS occurred_at, NULL AS direction,
              NULL AS channel, invoice.provider_status AS delivery_status, invoice.invoice_number AS subject,
              invoice.description AS body, invoice.collection_method AS status, invoice.due_at AS detail,
              invoice.amount_paid_cents AS amount_cents, invoice.currency
       FROM stripe_invoices invoice WHERE invoice.contact_id = ? ORDER BY datetime(invoice.issued_at) DESC, invoice.id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT 'note' AS activity_type, note.created_at AS occurred_at, NULL AS direction,
              NULL AS channel, NULL AS delivery_status, NULL AS subject, note.body,
              NULL AS status, note.authored_by AS detail, NULL AS amount_cents, NULL AS currency
       FROM client_notes note WHERE note.contact_id = ? ORDER BY datetime(note.created_at) DESC, note.id DESC LIMIT ?`,
    ).bind(contactId, limit),
    db.prepare(
      `SELECT 'task' AS activity_type, task.created_at AS occurred_at, NULL AS direction,
              NULL AS channel, NULL AS delivery_status, task.title AS subject, NULL AS body,
              task.status, task.due_at AS detail, NULL AS amount_cents, NULL AS currency
       FROM client_tasks task WHERE task.contact_id = ? ORDER BY datetime(task.created_at) DESC, task.id DESC LIMIT ?`,
    ).bind(contactId, limit),
  ]);
  const contact = contactResult.results?.[0] || null;
  if (!contact) return null;
  const importedCurrentState = stateResult.results?.[0] || {};
  const purchases = purchasesResult.results || [];
  return {
    contact,
    tags: (tagsResult.results || []).map((row) => row.tag),
    roles: (rolesResult.results || []).map((row) => row.role),
    fields: attributesResult.results || [],
    importedCurrentState,
    paymentAccess: paymentAccessState(purchases, importedCurrentState),
    nextAppointment: nextAppointmentResult.results?.[0] || null,
    appointments: appointmentsResult.results || [],
    purchases,
    purchaseCandidates: purchaseCandidatesResult.results || [],
    invoices: invoicesResult.results || [],
    notes: notesResult.results || [],
    tasks: tasksResult.results || [],
    consents: consentResult.results || [],
    // D1 has a lower compound-SELECT term ceiling than local SQLite. Merge the
    // six independently bounded source queries here instead of a UNION, while
    // keeping the exact same read-only client timeline shape.
    activityTimeline: [messageActivityResult, appointmentActivityResult, paymentActivityResult, invoiceActivityResult, noteActivityResult, taskActivityResult]
      .flatMap((result) => result.results || [])
      .sort((left, right) => String(right.occurred_at || "").localeCompare(String(left.occurred_at || "")))
      .slice(0, limit),
    communications: communicationsResult.results || [],
    communicationTimeline: timelineResult.results || [],
  };
}

export async function ledgerCutoverReview(db, limit) {
  const [candidates, summary, shadowLedger] = await db.batch([
    db.prepare(
      `SELECT candidate.id AS candidate_id, candidate.proposed_credits, candidate.source_updated_at,
              candidate.state, candidate.reviewed_at, candidate.reviewed_by,
              contact.display_name, contact.email_normalized
       FROM ledger_cutover_candidates candidate
       JOIN contacts contact ON contact.id = candidate.contact_id
       ORDER BY CASE candidate.state WHEN 'pending_review' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                contact.display_name
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      `SELECT
         SUM(CASE WHEN state = 'pending_review' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN state = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN state = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM ledger_cutover_candidates`,
    ),
    db.prepare(
      "SELECT COUNT(*) AS opening_entries FROM session_ledger_entries WHERE entry_type = 'cutover_opening_balance'",
    ),
  ]);
  const totals = summary.results?.[0] || {};
  const ledger = shadowLedger.results?.[0] || {};
  return {
    candidates: candidates.results || [],
    pending: Number(totals.pending || 0),
    approved: Number(totals.approved || 0),
    rejected: Number(totals.rejected || 0),
    shadowOnly: true,
    shadowOpeningEntries: Number(ledger.opening_entries || 0),
  };
}

// This intentionally reports only reconciliation state, never contact or purchase
// details. A link is considered authoritative only when Stripe supplied the GHL
// contact ID; unlinked charges stay out of the session ledger for manual review.
export async function reconciliationStatus(db) {
  const [purchaseRow, candidateRow] = await db.batch([
    db.prepare(
    `SELECT
       COUNT(*) AS purchases_total,
       SUM(CASE WHEN contact_id IS NOT NULL THEN 1 ELSE 0 END) AS contact_linked,
       SUM(CASE WHEN contact_id IS NULL THEN 1 ELSE 0 END) AS contact_unlinked,
       SUM(CASE WHEN ledger_import_state = 'pending_reconciliation' THEN 1 ELSE 0 END) AS pending_ledger_review,
       SUM(CASE WHEN classification = 'unclassified' AND classification_review_state = 'pending_review' THEN 1 ELSE 0 END) AS unclassified
     FROM purchases`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS pending_candidates
       FROM purchase_reconciliation_candidates
       WHERE state = 'pending_review'`,
    ),
  ]);
  const row = purchaseRow.results?.[0] || null;
  const pendingCandidates = Number(candidateRow.results?.[0]?.pending_candidates || 0);
  return {
    purchasesTotal: Number(row?.purchases_total || 0),
    contactLinked: Number(row?.contact_linked || 0),
    contactUnlinked: Number(row?.contact_unlinked || 0),
    pendingLedgerReview: Number(row?.pending_ledger_review || 0),
    unclassified: Number(row?.unclassified || 0),
    pendingCandidates,
    automaticLedgerPosting: false,
  };
}

export async function reconciliationQueue(db, limit) {
  const result = await db.prepare(
    `SELECT
       candidate.id AS candidate_id,
       candidate.match_basis,
       candidate.state,
       purchase.provider_charge_id,
       purchase.amount_cents,
       purchase.currency,
       purchase.purchased_at,
       purchase.classification,
       purchase.billing_email_normalized,
       contact.id AS contact_id,
       contact.display_name AS contact_display_name,
       contact.email_normalized AS contact_email_normalized
     FROM purchase_reconciliation_candidates candidate
     JOIN purchases purchase ON purchase.id = candidate.purchase_id
     JOIN contacts contact ON contact.id = candidate.contact_id
     WHERE candidate.state = 'pending_review'
     ORDER BY purchase.purchased_at DESC, candidate.created_at DESC
     LIMIT ?`,
  ).bind(limit).all();
  return result.results || [];
}

export async function reconciliationReview(db, limit) {
  const purchaseFields = `
    purchase.id AS purchase_id,
    purchase.provider_charge_id,
    purchase.amount_cents,
    purchase.currency,
    purchase.purchased_at,
    purchase.classification,
    purchase.billing_email_normalized`;
  const [candidates, unmatched, unclassified, packages] = await db.batch([
    db.prepare(
      `SELECT
         candidate.id AS candidate_id,
         candidate.match_basis,
         ${purchaseFields},
         contact.display_name AS contact_display_name,
         contact.email_normalized AS contact_email_normalized
       FROM purchase_reconciliation_candidates candidate
       JOIN purchases purchase ON purchase.id = candidate.purchase_id
       JOIN contacts contact ON contact.id = candidate.contact_id
       WHERE candidate.state = 'pending_review'
       ORDER BY purchase.purchased_at DESC, candidate.created_at DESC
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      `SELECT ${purchaseFields}
       FROM purchases purchase
       LEFT JOIN purchase_reconciliation_candidates candidate
         ON candidate.purchase_id = purchase.id AND candidate.state = 'pending_review'
       WHERE purchase.contact_id IS NULL AND candidate.id IS NULL
       ORDER BY purchase.purchased_at DESC
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      `SELECT
         ${purchaseFields},
         CASE
           WHEN purchase.contact_id IS NOT NULL THEN 'source_linked'
           WHEN candidate.id IS NOT NULL THEN 'candidate_pending'
           ELSE 'unmatched'
         END AS identity_status,
         contact.display_name AS contact_display_name,
         contact.email_normalized AS contact_email_normalized
       FROM purchases purchase
       LEFT JOIN purchase_reconciliation_candidates candidate
         ON candidate.purchase_id = purchase.id AND candidate.state = 'pending_review'
       LEFT JOIN contacts contact ON contact.id = COALESCE(purchase.contact_id, candidate.contact_id)
       WHERE purchase.classification = 'unclassified'
         AND purchase.classification_review_state = 'pending_review'
       ORDER BY purchase.purchased_at DESC
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      "SELECT id, name FROM packages WHERE active = 1 ORDER BY name",
    ),
  ]);
  return {
    candidates: candidates.results || [],
    unmatched: unmatched.results || [],
    unclassified: unclassified.results || [],
    packages: packages.results || [],
  };
}

function reviewActor(value) {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 100) throw new Error("reviewedBy is required and must be 100 characters or fewer");
  return actor;
}

async function recordOperationalEvent(db, eventType, entityType, entityId, detail, now) {
  await db.prepare(
    `INSERT INTO operational_events (id, event_type, entity_type, entity_id, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id(), eventType, entityType, entityId, JSON.stringify(detail), now).run();
}

export async function decideLedgerCutoverCandidate(db, candidateId, decision, reviewedBy, now) {
  if (decision !== "approve" && decision !== "reject") throw new Error("decision must be approve or reject");
  const actor = reviewActor(reviewedBy);
  const candidate = await db.prepare(
    "SELECT id, contact_id, proposed_credits, state FROM ledger_cutover_candidates WHERE id = ?",
  ).bind(candidateId).first();
  if (!candidate || candidate.state !== "pending_review") throw new Error("cutover candidate is not pending review");
  const state = decision === "approve" ? "approved" : "rejected";
  await db.prepare(
    `UPDATE ledger_cutover_candidates
     SET state = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(state, now, actor, now, candidateId).run();
  await recordOperationalEvent(
    db,
    `ledger_cutover_candidate_${state}`,
    "ledger_cutover_candidate",
    candidateId,
    { contactId: candidate.contact_id, proposedCredits: candidate.proposed_credits, reviewedBy: actor },
    now,
  );
  return { candidateId, decision, state, ledgerEntryCreated: false };
}

export async function decideReconciliationCandidate(db, candidateId, decision, reviewedBy, now) {
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const actor = reviewActor(reviewedBy);
  const candidate = await db.prepare(
    `SELECT candidate.id, candidate.purchase_id, candidate.contact_id, candidate.state, purchase.contact_id AS purchase_contact_id
     FROM purchase_reconciliation_candidates candidate
     JOIN purchases purchase ON purchase.id = candidate.purchase_id
     WHERE candidate.id = ?`,
  ).bind(candidateId).first();
  if (!candidate || candidate.state !== "pending_review") throw new Error("candidate is not pending review");
  if (decision === "accept" && candidate.purchase_contact_id) throw new Error("purchase already has a contact link");

  if (decision === "accept") {
    await db.batch([
      db.prepare(
        `UPDATE purchase_reconciliation_candidates
         SET state = 'accepted', reviewed_at = ?, reviewed_by = ?
         WHERE id = ?`,
      ).bind(now, actor, candidateId),
      db.prepare("UPDATE purchases SET contact_id = ?, updated_at = ? WHERE id = ?")
        .bind(candidate.contact_id, now, candidate.purchase_id),
      db.prepare(
        `UPDATE external_records SET contact_id = ?
         WHERE provider = 'stripe' AND record_type = 'purchase' AND record_id = ?`,
      ).bind(candidate.contact_id, candidate.purchase_id),
    ]);
  } else {
    await db.prepare(
      `UPDATE purchase_reconciliation_candidates
       SET state = 'rejected', reviewed_at = ?, reviewed_by = ?
       WHERE id = ?`,
    ).bind(now, actor, candidateId).run();
  }
  await recordOperationalEvent(
    db,
    `purchase_reconciliation_candidate_${decision}ed`,
    "purchase_reconciliation_candidate",
    candidateId,
    { purchaseId: candidate.purchase_id, contactId: candidate.contact_id, reviewedBy: actor },
    now,
  );
  return { candidateId, decision, purchaseId: candidate.purchase_id };
}

export async function classifyPurchase(db, purchaseId, resolution, packageId, reviewedBy, now) {
  const actor = reviewActor(reviewedBy);
  const purchase = await db.prepare(
    "SELECT id, classification FROM purchases WHERE id = ?",
  ).bind(purchaseId).first();
  if (!purchase || purchase.classification !== "unclassified") {
    throw new Error("only an unclassified purchase can be classified");
  }
  let classification;
  let nextPackageId = null;
  let reviewState;
  if (resolution === "package") {
    const pack = await db.prepare("SELECT id, name FROM packages WHERE id = ? AND active = 1").bind(packageId).first();
    if (!pack) throw new Error("packageId must identify an active package");
    classification = pack.name;
    nextPackageId = pack.id;
    reviewState = "confirmed";
  } else if (resolution === "legacy_package") {
    // Historical offerings predate the current price list. They are known to be
    // packages, but their session count must not be inferred or ledgered.
    classification = "Legacy package — pre-current pricing";
    reviewState = "confirmed";
  } else if (resolution === "not_a_package") {
    classification = "Not a session package";
    reviewState = "not_a_package";
  } else {
    throw new Error("resolution must be package, legacy_package, or not_a_package");
  }
  await db.prepare(
    `UPDATE purchases
     SET package_id = ?, classification = ?, classification_review_state = ?,
         classification_reviewed_at = ?, classification_reviewed_by = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(nextPackageId, classification, reviewState, now, actor, now, purchaseId).run();
  await recordOperationalEvent(
    db,
    "purchase_classification_confirmed",
    "purchase",
    purchaseId,
    { resolution, packageId: nextPackageId, reviewedBy: actor },
    now,
  );
  return { purchaseId, classification, reviewState, packageId: nextPackageId };
}
