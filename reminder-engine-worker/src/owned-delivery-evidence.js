const DIGEST = /^[a-f0-9]{64}$/;
const CHANNELS = new Set(["email", "sms"]);
const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

const clean = (value) => String(value || "").trim();
const changesOf = (result) => Number(result?.meta?.changes ?? result?.meta?.rows_written ?? result?.changes ?? 0);

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalRequest(input) {
  return JSON.stringify({
    flowKey: input.flowKey,
    enrollmentId: input.enrollmentId,
    stepIndex: input.stepIndex,
    definitionVersion: input.definitionVersion,
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
    recipient: input.recipient,
    provider: input.provider,
    subject: input.subject || "",
    text: input.text,
  });
}

function validInput(input) {
  return clean(input?.flowKey)
    && clean(input?.enrollmentId)
    && Number.isInteger(input?.stepIndex)
    && input.stepIndex >= 0
    && Number.isInteger(input?.definitionVersion)
    && input.definitionVersion > 0
    && clean(input?.idempotencyKey)
    && CHANNELS.has(input?.channel)
    && clean(input?.recipient)
    && clean(input?.provider)
    && clean(input?.text);
}

async function exactAttempt(db, effectId) {
  return db.prepare(
    `SELECT effect_id, flow_key, enrollment_id, step_index, definition_version,
            idempotency_key, channel, recipient_sha256, request_sha256, provider,
            state, provider_reference, error_code, prepared_at, updated_at, retention_until
       FROM owned_delivery_attempts WHERE effect_id = ?`,
  ).bind(effectId).first();
}

function sameIdentity(row, effect) {
  return row
    && row.effect_id === effect.effectId
    && row.flow_key === effect.flowKey
    && row.enrollment_id === effect.enrollmentId
    && Number(row.step_index) === effect.stepIndex
    && Number(row.definition_version) === effect.definitionVersion
    && row.idempotency_key === effect.idempotencyKey
    && row.channel === effect.channel
    && row.recipient_sha256 === effect.recipientSha256
    && row.request_sha256 === effect.requestSha256
    && row.provider === effect.provider;
}

async function acceptedReceiptExists(db, effect, providerReference) {
  const row = await db.prepare(
    `SELECT provider_receipt_id, evidence_sha256
       FROM owned_delivery_receipts
      WHERE effect_id = ? AND provider = ? AND provider_reference = ?
        AND proof_level = 'accepted'
      LIMIT 2`,
  ).bind(effect.effectId, effect.provider, providerReference).all();
  const receipts = row?.results || [];
  return receipts.length === 1 && DIGEST.test(receipts[0].evidence_sha256);
}

export async function describeOwnedDeliveryEffect(input) {
  const safe = {
    flowKey: clean(input?.flowKey),
    enrollmentId: clean(input?.enrollmentId),
    stepIndex: Number(input?.stepIndex),
    definitionVersion: Number(input?.definitionVersion),
    idempotencyKey: clean(input?.idempotencyKey),
    channel: clean(input?.channel),
    recipient: clean(input?.recipient),
    provider: clean(input?.provider),
    subject: clean(input?.subject),
    text: clean(input?.text),
  };
  if (!validInput(safe)) throw new Error("owned delivery effect is incomplete");
  const [idempotencySha256, recipientSha256, requestSha256] = await Promise.all([
    sha256(safe.idempotencyKey),
    sha256(safe.recipient.toLowerCase()),
    sha256(canonicalRequest(safe)),
  ]);
  return Object.freeze({
    ...safe,
    effectId: `ode_${idempotencySha256}`,
    recipientSha256,
    requestSha256,
  });
}

export async function prepareOwnedDeliveryEffect(db, input, nowMs = Date.now()) {
  if (!db?.prepare || !db?.batch) return { status: "refused", reason: "delivery evidence store unavailable" };
  let effect;
  try { effect = await describeOwnedDeliveryEffect(input); } catch (error) {
    return { status: "refused", reason: String(error?.message || error) };
  }
  const preparedEvidence = await sha256(JSON.stringify({
    effectId: effect.effectId,
    requestSha256: effect.requestSha256,
    transition: "prepared",
  }));
  const retentionUntil = nowMs + RETENTION_MS;
  try {
    const results = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO owned_delivery_attempts
           (effect_id, flow_key, enrollment_id, step_index, definition_version,
            idempotency_key, channel, recipient_sha256, request_sha256, provider,
            state, prepared_at, updated_at, retention_until)
         SELECT ?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?
          WHERE EXISTS (
            SELECT 1
              FROM reminder_steps step
              JOIN reminder_enrollments enrollment
                ON enrollment.enrollment_id = step.enrollment_id
             WHERE step.enrollment_id = ? AND step.step_index = ? AND step.status = 'pending'
               AND enrollment.flow_key = ? AND enrollment.definition_version = ?
               AND enrollment.status = 'active'
          )`,
      ).bind(
        effect.effectId, effect.flowKey, effect.enrollmentId, effect.stepIndex,
        effect.definitionVersion, effect.idempotencyKey, effect.channel,
        effect.recipientSha256, effect.requestSha256, effect.provider, nowMs, nowMs, retentionUntil,
        effect.enrollmentId, effect.stepIndex, effect.flowKey, effect.definitionVersion,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO owned_delivery_effect_events
           (event_id, effect_id, sequence, transition, evidence_sha256, occurred_at, retention_until)
         SELECT ?, effect_id, 1, 'prepared', ?, ?, retention_until
           FROM owned_delivery_attempts
          WHERE effect_id = ? AND request_sha256 = ?`,
      ).bind(`${effect.effectId}:prepared`, preparedEvidence, nowMs, effect.effectId, effect.requestSha256),
    ]);
    const row = await exactAttempt(db, effect.effectId);
    if (!sameIdentity(row, effect)) return { status: "refused", reason: "delivery effect identity collision", effectId: effect.effectId };
    if (!row || !["prepared", "submitted", "accepted", "ambiguous", "failed_terminal"].includes(row.state)) {
      return { status: "refused", reason: "delivery effect projection is invalid", effectId: effect.effectId };
    }
    return {
      status: changesOf(results?.[0]) === 1 ? "prepared" : "replayed",
      effectId: effect.effectId,
      state: row.state,
      providerReference: row.provider_reference || null,
      dispatchAllowed: false,
      effect,
    };
  } catch (error) {
    return { status: "refused", reason: String(error?.message || error), effectId: effect.effectId };
  }
}

export async function claimOwnedDeliveryEffect(db, prepared, nowMs = Date.now()) {
  const effect = prepared?.effect;
  if (!effect || !DIGEST.test(effect.requestSha256)) return { status: "refused", dispatchAllowed: false };
  const evidence = await sha256(JSON.stringify({
    effectId: effect.effectId,
    requestSha256: effect.requestSha256,
    transition: "submitted",
  }));
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE owned_delivery_attempts
            SET state = 'submitted', updated_at = ?
          WHERE effect_id = ? AND state = 'prepared' AND request_sha256 = ?`,
      ).bind(nowMs, effect.effectId, effect.requestSha256),
      db.prepare(
        `INSERT INTO owned_delivery_effect_events
           (event_id, effect_id, sequence, transition, evidence_sha256, occurred_at, retention_until)
         SELECT ?, effect_id, 2, 'submitted', ?, ?, retention_until
           FROM owned_delivery_attempts
          WHERE effect_id = ? AND state = 'submitted' AND request_sha256 = ?`,
      ).bind(`${effect.effectId}:submitted`, evidence, nowMs, effect.effectId, effect.requestSha256),
    ]);
    const claimed = changesOf(results?.[0]) === 1;
    const row = await exactAttempt(db, effect.effectId);
    if (!sameIdentity(row, effect)) return { status: "refused", dispatchAllowed: false };
    if (claimed && changesOf(results?.[1]) === 1) {
      return { status: "claimed", state: "submitted", effectId: effect.effectId, dispatchAllowed: true };
    }
    return {
      status: row.state === "accepted" ? "accepted_replay" : "held",
      state: row.state,
      effectId: effect.effectId,
      providerReference: row.provider_reference || null,
      dispatchAllowed: false,
    };
  } catch (error) {
    return { status: "refused", reason: String(error?.message || error), dispatchAllowed: false };
  }
}

export async function recordOwnedDeliveryAcceptance(db, prepared, providerReference, nowMs = Date.now()) {
  const effect = prepared?.effect;
  const reference = clean(providerReference);
  if (!effect || !reference) return { status: "refused", outcomeProven: false };
  const evidenceSha256 = await sha256(JSON.stringify({
    effectId: effect.effectId,
    provider: effect.provider,
    providerReference: reference,
    proofLevel: "accepted",
  }));
  const receiptId = `odr_${await sha256(`${effect.effectId}:${effect.provider}:${reference}:accepted`)}`;
  try {
    const before = await exactAttempt(db, effect.effectId);
    if (!sameIdentity(before, effect)) return { status: "refused", outcomeProven: false };
    if (before.state === "accepted") {
      return before.provider_reference === reference && await acceptedReceiptExists(db, effect, reference)
        ? { status: "replayed", outcomeProven: true, providerReference: reference }
        : { status: "refused", outcomeProven: false };
    }
    const results = await db.batch([
      db.prepare(
        `INSERT INTO owned_delivery_receipts
           (provider_receipt_id, effect_id, provider, provider_reference,
            proof_level, evidence_sha256, observed_at, retention_until)
         SELECT ?, effect_id, provider, ?, 'accepted', ?, ?, retention_until
           FROM owned_delivery_attempts
          WHERE effect_id = ? AND state = 'submitted' AND request_sha256 = ?`,
      ).bind(receiptId, reference, evidenceSha256, nowMs, effect.effectId, effect.requestSha256),
      db.prepare(
        `UPDATE owned_delivery_attempts
            SET state = 'accepted', provider_reference = ?, error_code = NULL, updated_at = ?
          WHERE effect_id = ? AND state = 'submitted' AND request_sha256 = ?
            AND EXISTS (
              SELECT 1 FROM owned_delivery_receipts
               WHERE provider_receipt_id = ? AND effect_id = owned_delivery_attempts.effect_id
            )`,
      ).bind(reference, nowMs, effect.effectId, effect.requestSha256, receiptId),
      db.prepare(
        `INSERT INTO owned_delivery_effect_events
           (event_id, effect_id, sequence, transition, evidence_sha256, occurred_at, retention_until)
         SELECT ?, effect_id, 3, 'accepted', ?, ?, retention_until
           FROM owned_delivery_attempts
          WHERE effect_id = ? AND state = 'accepted' AND provider_reference = ?`,
      ).bind(`${effect.effectId}:accepted`, evidenceSha256, nowMs, effect.effectId, reference),
    ]);
    const row = await exactAttempt(db, effect.effectId);
    const recorded = changesOf(results?.[0]) === 1 && changesOf(results?.[1]) === 1 && changesOf(results?.[2]) === 1;
    if (!recorded || !sameIdentity(row, effect) || row.state !== "accepted" || row.provider_reference !== reference) {
      return { status: "refused", outcomeProven: false };
    }
    return { status: "recorded", outcomeProven: true, providerReference: reference };
  } catch (error) {
    return { status: "refused", reason: String(error?.message || error), outcomeProven: false };
  }
}

export async function recordOwnedDeliveryAmbiguity(db, prepared, errorCode, nowMs = Date.now()) {
  const effect = prepared?.effect;
  const code = clean(errorCode) || "transport_outcome_unknown";
  if (!effect) return { status: "refused", outcomeProven: false };
  const evidence = await sha256(JSON.stringify({
    effectId: effect.effectId,
    errorCode: code,
    transition: "ambiguous",
  }));
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE owned_delivery_attempts
            SET state = 'ambiguous', error_code = ?, updated_at = ?
          WHERE effect_id = ? AND state = 'submitted' AND request_sha256 = ?`,
      ).bind(code, nowMs, effect.effectId, effect.requestSha256),
      db.prepare(
        `INSERT INTO owned_delivery_effect_events
           (event_id, effect_id, sequence, transition, evidence_sha256, occurred_at, retention_until)
         SELECT ?, effect_id, 3, 'ambiguous', ?, ?, retention_until
           FROM owned_delivery_attempts
          WHERE effect_id = ? AND state = 'ambiguous' AND error_code = ?`,
      ).bind(`${effect.effectId}:ambiguous`, evidence, nowMs, effect.effectId, code),
    ]);
    const row = await exactAttempt(db, effect.effectId);
    if (!sameIdentity(row, effect) || row.state !== "ambiguous") return { status: "refused", outcomeProven: false };
    return {
      status: changesOf(results?.[0]) === 1 && changesOf(results?.[1]) === 1 ? "recorded" : "replayed",
      outcomeProven: false,
      dispatchAllowed: false,
    };
  } catch (error) {
    return { status: "refused", reason: String(error?.message || error), outcomeProven: false };
  }
}

export async function executeOwnedDeliveryEffect(db, input, transport, now = () => Date.now()) {
  const prepared = await prepareOwnedDeliveryEffect(db, input, now());
  if (prepared.status === "refused") return { success: false, error: prepared.reason || "delivery evidence preparation refused" };
  if (prepared.state === "accepted") {
    const receipt = await recordOwnedDeliveryAcceptance(db, prepared, prepared.providerReference, now());
    return receipt.outcomeProven
      ? { success: true, messageId: prepared.providerReference, replayed: true, evidence: "accepted" }
      : { success: false, error: "accepted delivery projection lacks exact receipt evidence", ambiguous: true };
  }
  const claim = await claimOwnedDeliveryEffect(db, prepared, now());
  if (!claim.dispatchAllowed) {
    if (claim.state === "accepted") {
      const receipt = await recordOwnedDeliveryAcceptance(db, prepared, claim.providerReference, now());
      if (receipt.outcomeProven) return { success: true, messageId: claim.providerReference, replayed: true, evidence: "accepted" };
    }
    return { success: false, error: "delivery effect requires manual reconciliation", ambiguous: true };
  }
  let result;
  try { result = await transport(); } catch (error) {
    await recordOwnedDeliveryAmbiguity(db, prepared, "transport_exception", now());
    return { success: false, error: String(error?.message || error), ambiguous: true };
  }
  if (result?.success === true && clean(result?.messageId)) {
    const receipt = await recordOwnedDeliveryAcceptance(db, prepared, result.messageId, now());
    if (receipt.outcomeProven) return { ...result, evidence: "accepted" };
    return { success: false, error: "delivery acceptance could not be durably recorded", ambiguous: true };
  }
  await recordOwnedDeliveryAmbiguity(db, prepared, "transport_outcome_unknown", now());
  return { success: false, error: result?.error || "delivery outcome is unknown", ambiguous: true };
}
