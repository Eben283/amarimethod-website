function id() {
  return crypto.randomUUID();
}

const GHL_FIELD_IDS = Object.freeze({
  sessionsRemaining: "wrQSkx6BhXwDGIn1d0V4",
  sessionsCompleted: "TE0udwVH1Km5RsKaN5H0",
  seriesType: "3i93lTkmuAV49s9nh0q8",
});

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

export async function beginMirrorSyncCycle(db, provider, now, startsAtBeginning) {
  const running = await db.prepare(
    "SELECT id, started_at FROM mirror_sync_cycles WHERE provider = ? AND status = 'running' ORDER BY datetime(started_at) DESC LIMIT 1",
  ).bind(provider).first();
  if (running) return running;
  // A cursor inherited from an earlier Worker version represents an unknown
  // partial traversal. Do not certify it as a full pass; wait until the cursor
  // resets and the next traversal demonstrably begins at the provider's head.
  if (!startsAtBeginning) return null;
  const cycle = { id: id(), started_at: now };
  await db.prepare(
    `INSERT INTO mirror_sync_cycles (id, provider, started_at, status)
     VALUES (?, ?, ?, 'running')`,
  ).bind(cycle.id, provider, cycle.started_at).run();
  return cycle;
}

export async function completeMirrorSyncCycle(db, cycle, provider, now) {
  if (!cycle) return;
  const objectType = provider === "ghl" ? "contact" : "charge";
  const totals = await db.prepare(
    `SELECT COUNT(*) AS known_records,
            SUM(CASE WHEN datetime(last_seen_at) >= datetime(?) THEN 1 ELSE 0 END) AS records_seen
     FROM external_records WHERE provider = ? AND object_type = ?`,
  ).bind(cycle.started_at, provider, objectType).first();
  const knownRecords = Number(totals?.known_records || 0);
  const recordsSeen = Number(totals?.records_seen || 0);
  await db.prepare(
    `UPDATE mirror_sync_cycles
     SET status = 'completed', completed_at = ?, records_seen = ?, known_records = ?, missing_records = ?
     WHERE id = ?`,
  ).bind(now, recordsSeen, knownRecords, Math.max(0, knownRecords - recordsSeen), cycle.id).run();
}

export async function mirrorCompleteness(db) {
  const result = await db.batch(["ghl", "stripe"].map((provider) => db.prepare(
    `SELECT started_at, completed_at, records_seen, known_records, missing_records
     FROM mirror_sync_cycles WHERE provider = ? AND status = 'completed'
     ORDER BY datetime(completed_at) DESC LIMIT 1`,
  ).bind(provider)));
  return Object.fromEntries(["ghl", "stripe"].map((provider, index) => {
    const row = result[index].results?.[0] || null;
    return [provider, row ? { state: row.missing_records ? "review" : "complete", ...row } : { state: "in_progress" }];
  }));
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

function importedSessionsRemaining(contact) {
  const value = contact.attributes.find(([key]) => key === GHL_FIELD_IDS.sessionsRemaining)?.[1];
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const sessions = Number(value.trim());
  return Number.isSafeInteger(sessions) ? sessions : null;
}

async function recordBalanceSourceObservation(db, contactId, contact, now) {
  const sessionsRemaining = importedSessionsRemaining(contact);
  if (sessionsRemaining == null) return;
  const latest = await db.prepare(
    `SELECT sessions_remaining FROM balance_source_observations
     WHERE contact_id = ? ORDER BY datetime(observed_at) DESC, id DESC LIMIT 1`,
  ).bind(contactId).first();
  if (Number(latest?.sessions_remaining) === sessionsRemaining) return;
  await db.prepare(
    `INSERT INTO balance_source_observations
     (id, contact_id, source, sessions_remaining, observed_at, source_key)
     VALUES (?, ?, 'ghl', ?, ?, ?)`,
  ).bind(id(), contactId, sessionsRemaining, now, `ghl-balance:${contactId}:${now}`).run();
}

async function recordGhlConsentObservations(db, contactId, consents, now) {
  for (const consent of consents || []) {
    const latest = await db.prepare(
      `SELECT state FROM consents WHERE contact_id = ? AND channel = ?
       ORDER BY datetime(effective_at) DESC, id DESC LIMIT 1`,
    ).bind(contactId, consent.channel).first();
    if (latest?.state === consent.state) continue;
    await db.prepare(
      `INSERT INTO consents (id, contact_id, channel, state, effective_at, source, evidence_ref, recorded_by)
       VALUES (?, ?, ?, ?, ?, 'ghl_contact_dnd', 'GHL contact DND settings', 'crm-mirror-import')`,
    ).bind(id(), contactId, consent.channel, consent.state, now).run();
  }
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
  await recordBalanceSourceObservation(db, contactId, contact, now);
  await recordGhlConsentObservations(db, contactId, contact.consents, now);
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
  const latestObservation = await db.prepare(
    `SELECT provider_calendar_id, status, starts_at, ends_at
     FROM appointment_source_observations
     WHERE appointment_id = ? ORDER BY datetime(observed_at) DESC, id DESC LIMIT 1`,
  ).bind(appointmentId).first();
  const unchanged = latestObservation
    && latestObservation.provider_calendar_id === appointment.calendarId
    && latestObservation.status === appointment.status
    && latestObservation.starts_at === appointment.startsAt
    && latestObservation.ends_at === appointment.endsAt;
  if (!unchanged) {
    await db.prepare(
      `INSERT INTO appointment_source_observations
       (id, appointment_id, contact_id, source, provider_calendar_id, status, starts_at, ends_at, observed_at, source_key)
       VALUES (?, ?, ?, 'ghl', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), appointmentId, contactId, appointment.calendarId, appointment.status,
      appointment.startsAt, appointment.endsAt, now, `ghl-appointment:${appointmentId}:${now}`,
    ).run();
  }
  return appointmentId;
}

async function recordPaymentSourceEvents(db, purchaseId, contactId, charge, now) {
  // The charge event is idempotently backfilled on the next import after this
  // migration. Refunds are recorded only as the newly observed cumulative delta.
  await db.prepare(
    `INSERT OR IGNORE INTO payment_source_events
     (id, purchase_id, contact_id, source, event_type, amount_cents, currency, occurred_at, observed_at, source_key)
     VALUES (?, ?, ?, 'stripe', 'charge', ?, ?, ?, ?, ?)`,
  ).bind(
    id(), purchaseId, contactId, charge.amountCents, charge.currency, charge.purchasedAt, now,
    `stripe-charge:${charge.externalId}`,
  ).run();
  const refunds = await db.prepare(
    `SELECT COALESCE(-SUM(amount_cents), 0) AS refunded_cents
     FROM payment_source_events WHERE purchase_id = ? AND event_type = 'refund_delta'`,
  ).bind(purchaseId).first();
  const alreadyObserved = Number(refunds?.refunded_cents || 0);
  const refundDelta = charge.amountRefundedCents - alreadyObserved;
  if (refundDelta <= 0) return;
  await db.prepare(
    `INSERT INTO payment_source_events
     (id, purchase_id, contact_id, source, event_type, amount_cents, currency, occurred_at, observed_at, source_key)
     VALUES (?, ?, ?, 'stripe', 'refund_delta', ?, ?, ?, ?, ?)`,
  ).bind(
    id(), purchaseId, contactId, -refundDelta, charge.currency, charge.purchasedAt, now,
    `stripe-refund:${charge.externalId}:${charge.amountRefundedCents}`,
  ).run();
}

async function recordPaymentIdentityException(db, purchaseId, contactId, charge, now) {
  const linked = contactId
    ? await db.prepare("SELECT email_normalized FROM contacts WHERE id = ?").bind(contactId).first()
    : null;
  const exceptionType = !contactId
    ? "unlinked_charge"
    : charge.billingEmail && linked?.email_normalized && charge.billingEmail !== linked.email_normalized
      ? "metadata_contact_email_conflict"
      : null;
  if (!exceptionType) return;
  await db.prepare(
    `INSERT INTO payment_identity_exceptions
     (id, purchase_id, exception_type, state, detail_json, detected_at)
     VALUES (?, ?, ?, 'open', ?, ?)
     ON CONFLICT(purchase_id) DO UPDATE SET exception_type = excluded.exception_type,
       detail_json = excluded.detail_json, detected_at = excluded.detected_at`,
  ).bind(
    id(), purchaseId, exceptionType,
    JSON.stringify({ billingEmail: charge.billingEmail || null, linkedContactEmail: linked?.email_normalized || null, metadataContactId: charge.contactExternalId || null }),
    now,
  ).run();
}

function messageChannel(raw) {
  const type = String(raw?.messageType || raw?.type || "").toUpperCase();
  if (type.includes("EMAIL") || raw?.type === 3) return "email";
  if (type.includes("SMS") || raw?.type === 2) return "sms";
  return null;
}

function messageDirection(raw) {
  if (raw?.direction === 1 || raw?.direction === "1" || raw?.direction === "inbound") return "inbound";
  if (raw?.status === "received") return "inbound";
  return "outbound";
}

export async function upsertGhlCommunication(db, contactId, raw, now) {
  const externalId = String(raw?.id || "").trim();
  const channel = messageChannel(raw);
  if (!externalId || !channel) return false;
  const existing = await db.prepare(
    "SELECT record_id FROM external_records WHERE provider = 'ghl' AND object_type = 'message' AND external_id = ?",
  ).bind(externalId).first();
  if (existing?.record_id) return true;
  const communicationId = id();
  const occurred = raw.date || raw.dateAdded || raw.createdAt || now;
  const preview = String(raw.body || raw.message || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  await db.batch([
    db.prepare(
      `INSERT INTO communications
       (id, contact_id, channel, direction, provider_status, occurred_at, recorded_by, subject_or_preview)
       VALUES (?, ?, ?, ?, ?, ?, 'ghl_import', ?)`,
    ).bind(communicationId, contactId, channel, messageDirection(raw), raw.status || raw.deliveryStatus || null, occurred, preview),
    db.prepare(
      `INSERT INTO external_records
       (id, provider, object_type, external_id, contact_id, record_type, record_id, last_seen_at)
       VALUES (?, 'ghl', 'message', ?, ?, 'communication', ?, ?)
       ON CONFLICT(provider, object_type, external_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    ).bind(id(), externalId, contactId, communicationId, now),
  ]);
  return true;
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
           amount_refunded_cents = ?, currency = ?, purchased_at = ?, classification = ?, billing_email_normalized = ?,
           stripe_payment_intent_id = ?, ghl_invoice_id = ?, ghl_transaction_id = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      contactId, packageId, charge.customerExternalId, charge.providerStatus, charge.amountCents,
      charge.amountRefundedCents, charge.currency, charge.purchasedAt, classification, charge.billingEmail,
      charge.stripePaymentIntentId, charge.ghlInvoiceId, charge.ghlTransactionId, now, purchaseId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO purchases
       (id, contact_id, package_id, provider_charge_id, provider_customer_id, provider_status, amount_cents,
        amount_refunded_cents, currency, purchased_at, classification, billing_email_normalized,
        stripe_payment_intent_id, ghl_invoice_id, ghl_transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      purchaseId, contactId, packageId, charge.externalId, charge.customerExternalId, charge.providerStatus,
      charge.amountCents, charge.amountRefundedCents, charge.currency, charge.purchasedAt, classification,
      charge.billingEmail, charge.stripePaymentIntentId, charge.ghlInvoiceId, charge.ghlTransactionId, now, now,
    ).run();
  }
  await recordPaymentSourceEvents(db, purchaseId, contactId, charge, now);
  await recordPaymentIdentityException(db, purchaseId, contactId, charge, now);
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

export async function mirrorStatus(db, now = new Date().toISOString()) {
  const [contacts, appointments, purchases, lastSync, latestGhl, latestStripe] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM contacts"),
    db.prepare("SELECT COUNT(*) AS count FROM appointments"),
    db.prepare("SELECT COUNT(*) AS count FROM purchases"),
    db.prepare("SELECT provider, status, finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT provider, status, finished_at, records_read, records_written, failure_detail FROM sync_runs WHERE provider = 'ghl' ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT provider, status, finished_at, records_read, records_written, failure_detail FROM sync_runs WHERE provider = 'stripe' ORDER BY started_at DESC LIMIT 1"),
  ]);
  return {
    contacts: Number(contacts.results?.[0]?.count || 0),
    appointments: Number(appointments.results?.[0]?.count || 0),
    purchases: Number(purchases.results?.[0]?.count || 0),
    lastSync: lastSync.results?.[0] || null,
    syncHealth: syncHealthForRuns({
      ghl: latestGhl.results?.[0] || null,
      stripe: latestStripe.results?.[0] || null,
    }, now),
  };
}

export async function mirrorReadiness(db) {
  const [completeness, totals] = await Promise.all([
    mirrorCompleteness(db),
    db.batch([
      db.prepare("SELECT COUNT(*) AS count FROM communications"),
      db.prepare("SELECT COUNT(*) AS count FROM consents"),
      db.prepare("SELECT COUNT(*) AS count FROM payment_identity_exceptions WHERE state = 'open'"),
      db.prepare("SELECT result, checked_at, bookmark FROM mirror_recovery_checks ORDER BY datetime(checked_at) DESC LIMIT 1"),
      db.prepare("SELECT health_key, state, detail, detected_at FROM mirror_health_events WHERE resolved_at IS NULL ORDER BY datetime(detected_at) DESC LIMIT 25"),
    ]),
  ]);
  return {
    completeness,
    communications: Number(totals[0].results?.[0]?.count || 0),
    consentObservations: Number(totals[1].results?.[0]?.count || 0),
    openPaymentIdentityExceptions: Number(totals[2].results?.[0]?.count || 0),
    recovery: totals[3].results?.[0] || { result: "unverified" },
    openHealthEvents: totals[4].results || [],
    shadowOnly: true,
  };
}

async function recordMirrorHealthEvent(db, healthKey, state, detail, now) {
  const open = await db.prepare(
    `SELECT id, state, detail FROM mirror_health_events
     WHERE health_key = ? AND resolved_at IS NULL ORDER BY datetime(detected_at) DESC LIMIT 1`,
  ).bind(healthKey).first();
  if (open?.state === state && open?.detail === detail) return;
  const statements = [];
  if (open) statements.push(db.prepare("UPDATE mirror_health_events SET resolved_at = ? WHERE id = ?").bind(now, open.id));
  statements.push(db.prepare(
    `INSERT INTO mirror_health_events (id, health_key, state, detail, detected_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id(), healthKey, state, detail, now));
  await db.batch(statements);
}

export async function refreshMirrorHealth(db, now) {
  const [readiness, operations] = await Promise.all([mirrorReadiness(db), shadowOperations(db, 1, now)]);
  for (const provider of ["ghl", "stripe"]) {
    const source = readiness.completeness[provider];
    await recordMirrorHealthEvent(
      db,
      `completeness:${provider}`,
      source.state === "complete" ? "healthy" : "review",
      source.state === "complete"
        ? `Latest full ${provider.toUpperCase()} pass saw ${source.records_seen}/${source.known_records} known records.`
        : source.state === "review"
          ? `Latest full ${provider.toUpperCase()} pass saw ${source.records_seen}/${source.known_records}; missing source records need review.`
          : `${provider.toUpperCase()} full-pass completeness is still in progress.`,
      now,
    );
  }
  await recordMirrorHealthEvent(
    db,
    "balance-drift",
    operations.balances.driftCount ? "review" : "healthy",
    operations.balances.driftCount ? `${operations.balances.driftCount} approved opening balance comparison(s) differ.` : "Approved opening balances match imported GHL balances.",
    now,
  );
  await recordMirrorHealthEvent(
    db,
    "payment-identity",
    readiness.openPaymentIdentityExceptions ? "review" : "healthy",
    readiness.openPaymentIdentityExceptions ? `${readiness.openPaymentIdentityExceptions} payment identity exception(s) need review.` : "No payment identity exceptions are open.",
    now,
  );
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

// This is the pre-cutover staff-operations view. It deliberately exposes
// source observations and gaps, rather than offering attendance or balance
// controls. A "showed" appointment is evidence from GHL, not permission to
// infer a session debit in the shadow ledger.
export async function shadowOperations(db, limit, now) {
  const [balanceComparisons, paymentTotals, paymentEvents, pastOutcomeGaps, pastOutcomeTotal, upcomingBookings] = await db.batch([
    db.prepare(
      `SELECT candidate.contact_id, contact.display_name, contact.email_normalized,
              ledger.credits AS shadow_credits,
              observation.sessions_remaining AS imported_sessions_remaining,
              observation.observed_at
       FROM ledger_cutover_candidates candidate
       JOIN contacts contact ON contact.id = candidate.contact_id
       LEFT JOIN (
         SELECT contact_id, SUM(credits) AS credits
         FROM session_ledger_entries
         GROUP BY contact_id
       ) ledger ON ledger.contact_id = candidate.contact_id
       LEFT JOIN balance_source_observations observation ON observation.id = (
         SELECT latest.id
         FROM balance_source_observations latest
         WHERE latest.contact_id = candidate.contact_id
         ORDER BY datetime(latest.observed_at) DESC, latest.id DESC
         LIMIT 1
       )
       WHERE candidate.state = 'approved'
       ORDER BY contact.display_name
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      `SELECT
         COUNT(*) AS event_count,
         COALESCE(SUM(CASE WHEN event_type = 'charge' THEN amount_cents ELSE 0 END), 0) AS charges_cents,
         COALESCE(SUM(CASE WHEN event_type = 'refund_delta' THEN -amount_cents ELSE 0 END), 0) AS refunds_cents
       FROM payment_source_events`,
    ),
    db.prepare(
      `SELECT event.event_type, event.amount_cents, event.currency, event.occurred_at, event.observed_at,
              purchase.classification, purchase.provider_status,
              contact.display_name, contact.email_normalized
       FROM payment_source_events event
       JOIN purchases purchase ON purchase.id = event.purchase_id
       LEFT JOIN contacts contact ON contact.id = event.contact_id
       ORDER BY datetime(event.observed_at) DESC, event.id DESC
       LIMIT ?`,
    ).bind(limit),
    db.prepare(
      `SELECT appointment.id AS appointment_id, appointment.starts_at, appointment.status,
              service.name AS service_name, contact.display_name
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.status IN ('booked', 'confirmed')
         AND appointment.starts_at IS NOT NULL
         AND datetime(appointment.starts_at) < datetime(?)
       ORDER BY datetime(appointment.starts_at) DESC, appointment.id DESC
       LIMIT ?`,
    ).bind(now, limit),
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM appointments appointment
       WHERE appointment.status IN ('booked', 'confirmed')
         AND appointment.starts_at IS NOT NULL
         AND datetime(appointment.starts_at) < datetime(?)`,
    ).bind(now),
    db.prepare(
      `SELECT appointment.id AS appointment_id, appointment.starts_at, appointment.status,
              service.name AS service_name, contact.display_name
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
       WHERE appointment.status IN ('booked', 'confirmed')
         AND appointment.starts_at IS NOT NULL
         AND datetime(appointment.starts_at) >= datetime(?)
       ORDER BY datetime(appointment.starts_at), appointment.id
       LIMIT ?`,
    ).bind(now, limit),
  ]);
  const comparisons = (balanceComparisons.results || []).map((row) => {
    const shadowCredits = Number(row.shadow_credits || 0);
    const importedSessionsRemaining = row.imported_sessions_remaining == null
      ? null
      : Number(row.imported_sessions_remaining);
    return {
      ...row,
      shadow_credits: shadowCredits,
      imported_sessions_remaining: importedSessionsRemaining,
      difference: importedSessionsRemaining == null ? null : importedSessionsRemaining - shadowCredits,
      state: importedSessionsRemaining == null ? "awaiting_source_observation"
        : importedSessionsRemaining === shadowCredits ? "in_sync"
          : "drift_review",
    };
  });
  const totals = paymentTotals.results?.[0] || {};
  const chargesCents = Number(totals.charges_cents || 0);
  const refundsCents = Number(totals.refunds_cents || 0);
  return {
    shadowOnly: true,
    automaticLedgerPosting: false,
    balances: {
      comparisons,
      driftCount: comparisons.filter((row) => row.state === "drift_review").length,
      awaitingObservationCount: comparisons.filter((row) => row.state === "awaiting_source_observation").length,
    },
    payments: {
      sourceEventCount: Number(totals.event_count || 0),
      chargesCents,
      refundsCents,
      netCents: chargesCents - refundsCents,
      events: paymentEvents.results || [],
    },
    bookings: {
      pastOutcomeGaps: pastOutcomeGaps.results || [],
      pastOutcomeGapCount: Number(pastOutcomeTotal.results?.[0]?.count || 0),
      upcoming: upcomingBookings.results || [],
    },
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

export async function contactProfile(db, contactId, limit, now) {
  const [contactResult, tagsResult, rolesResult, stateResult, nextAppointmentResult, appointmentsResult, purchasesResult] = await db.batch([
    db.prepare(
      `SELECT id, display_name, email_normalized, phone_e164, referral_source_label, created_at
       FROM contacts WHERE id = ?`,
    ).bind(contactId),
    db.prepare(
      "SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag",
    ).bind(contactId),
    db.prepare(
      "SELECT role FROM contact_roles WHERE contact_id = ? ORDER BY role",
    ).bind(contactId),
    db.prepare(
      `SELECT
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS sessions_remaining,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS sessions_completed,
         MAX(CASE WHEN attribute_key = ? THEN attribute_value END) AS series_type
       FROM contact_attributes
       WHERE contact_id = ? AND source = 'ghl'`,
    ).bind(GHL_FIELD_IDS.sessionsRemaining, GHL_FIELD_IDS.sessionsCompleted, GHL_FIELD_IDS.seriesType, contactId),
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
      `SELECT amount_cents, amount_refunded_cents, currency, purchased_at, provider_status,
              classification, classification_review_state
       FROM purchases
       WHERE contact_id = ?
       ORDER BY datetime(purchased_at) DESC, id DESC
       LIMIT ?`,
    ).bind(contactId, limit),
  ]);
  const contact = contactResult.results?.[0] || null;
  if (!contact) return null;
  return {
    contact,
    tags: (tagsResult.results || []).map((row) => row.tag),
    roles: (rolesResult.results || []).map((row) => row.role),
    importedCurrentState: stateResult.results?.[0] || {},
    nextAppointment: nextAppointmentResult.results?.[0] || null,
    appointments: appointmentsResult.results || [],
    purchases: purchasesResult.results || [],
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
