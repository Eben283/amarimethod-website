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
    "SELECT id, contact_id FROM purchases WHERE provider_charge_id = ?",
  ).bind(charge.externalId).first();
  // A direct GHL metadata stamp is authoritative. In every other case retain an
  // existing human-accepted link; importing a charge must not erase it.
  const contactId = sourceContactId || existing?.contact_id || null;
  const purchaseId = existing?.id || id();
  if (existing) {
    await db.prepare(
      `UPDATE purchases
       SET contact_id = ?, package_id = ?, provider_customer_id = ?, provider_status = ?, amount_cents = ?,
           amount_refunded_cents = ?, currency = ?, purchased_at = ?, classification = ?, billing_email_normalized = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, charge.packageId, charge.customerExternalId, charge.providerStatus, charge.amountCents,
      charge.amountRefundedCents, charge.currency, charge.purchasedAt, charge.classification, charge.billingEmail, now, purchaseId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO purchases
       (id, contact_id, package_id, provider_charge_id, provider_customer_id, provider_status, amount_cents,
        amount_refunded_cents, currency, purchased_at, classification, billing_email_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      purchaseId, contactId, charge.packageId, charge.externalId, charge.customerExternalId, charge.providerStatus,
      charge.amountCents, charge.amountRefundedCents, charge.currency, charge.purchasedAt, charge.classification,
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
       SUM(CASE WHEN classification = 'unclassified' THEN 1 ELSE 0 END) AS unclassified
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
  } else if (resolution === "not_a_package") {
    classification = "Not a session package";
    reviewState = "not_a_package";
  } else {
    throw new Error("resolution must be package or not_a_package");
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
