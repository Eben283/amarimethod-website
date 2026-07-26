function id() {
  return crypto.randomUUID();
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
    await db.batch([
      db.prepare(
        `INSERT INTO contacts
         (id, first_name, last_name, display_name, email_normalized, phone_e164, referral_source_label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        contactId, contact.firstName, contact.lastName, contact.displayName, contact.email, contact.phone,
        contact.referralSourceLabel, now, now,
      ),
      db.prepare(
        `INSERT INTO external_records
         (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
         VALUES (?, 'ghl', 'contact', ?, ?, 'contact', ?, ?)`,
      ).bind(id(), contact.externalId, contactId, contactId, now),
    ]);
  }
  await replaceContactFacts(db, contactId, contact, now);
  return contactId;
}

export async function findContactIdByGhlId(db, externalId) {
  return contactIdForExternalRecord(db, "ghl", "contact", externalId);
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
  const contactId = charge.contactExternalId
    ? await findContactIdByGhlId(db, charge.contactExternalId)
    : null;
  const existing = await db.prepare("SELECT id FROM purchases WHERE provider_charge_id = ?").bind(charge.externalId).first();
  const purchaseId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE purchases
       SET contact_id = ?, package_id = ?, provider_customer_id = ?, provider_status = ?, amount_cents = ?,
           amount_refunded_cents = ?, currency = ?, purchased_at = ?, classification = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, charge.packageId, charge.customerExternalId, charge.providerStatus, charge.amountCents,
      charge.amountRefundedCents, charge.currency, charge.purchasedAt, charge.classification, now, purchaseId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO purchases
       (id, contact_id, package_id, provider_charge_id, provider_customer_id, provider_status, amount_cents,
        amount_refunded_cents, currency, purchased_at, classification, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      purchaseId, contactId, charge.packageId, charge.externalId, charge.customerExternalId, charge.providerStatus,
      charge.amountCents, charge.amountRefundedCents, charge.currency, charge.purchasedAt, charge.classification,
      now, now,
    ).run();
  }
  await db.prepare(
    `INSERT INTO external_records
     (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
     VALUES (?, 'stripe', 'charge', ?, ?, 'purchase', ?, ?)
     ON CONFLICT(provider, object_type, external_id) DO UPDATE SET
       contact_id = excluded.contact_id, record_id = excluded.record_id, last_seen_at = excluded.last_seen_at`,
  ).bind(id(), charge.externalId, contactId, purchaseId, now).run();
  return { purchaseId, linked: Boolean(contactId) };
}

export async function mirrorStatus(db) {
  const [contacts, appointments, purchases, lastSync] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM contacts"),
    db.prepare("SELECT COUNT(*) AS count FROM appointments"),
    db.prepare("SELECT COUNT(*) AS count FROM purchases"),
    db.prepare("SELECT provider, status, finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1"),
  ]);
  return {
    contacts: Number(contacts.results?.[0]?.count || 0),
    appointments: Number(appointments.results?.[0]?.count || 0),
    purchases: Number(purchases.results?.[0]?.count || 0),
    lastSync: lastSync.results?.[0] || null,
  };
}
