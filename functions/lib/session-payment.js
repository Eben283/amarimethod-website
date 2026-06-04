// Per-session payment record — one record per (contact, appointment) capturing
// whether that specific session was paid, comped, drawn from a package, etc.
//
// Why this exists: the rest of the system tracks payment per CONTACT (the
// sessionPrepaid boolean, the sessions_remaining balance), which can't say
// "this session on this date was a comp" or "that one's still owed." This is
// the per-session truth the staff app renders and the owed list reads.
//
// Storage: PURCHASE_KV under `payment:{contactId}:{appointmentId}`, mirroring
// the staff-checkin attestation pattern (KV record + a backup GHL note written
// by the caller). It deliberately does NOT touch `sessions_remaining` (five
// writers + the published Living-Practice workflow triggers on the raw value)
// or `session_prepaid` (documented dead/ambiguous field).

export const PAYMENT_STATUSES = Object.freeze([
  'paid',           // confirmed paid (cash, venmo, a matched Stripe charge, …)
  'comped',         // intentionally free — Garrett's call; carries a note
  'on-package',     // drawn from an active prepaid series
  'pay-next-visit', // owed but expected next visit (recent — not yet a problem)
  'owed',           // attended, no payment, aged — needs collection
  'unknown',        // nothing recorded yet
]);

export const PAYMENT_METHODS = Object.freeze([
  'stripe', 'cash', 'venmo', 'check', 'other',
]);

const SOURCES = Object.freeze(['manual', 'stripe-auto']);
const NOTE_MAX = 1000;
const PREFIX = 'payment:';

export function paymentKey(contactId, appointmentId) {
  if (!contactId || typeof contactId !== 'string') throw new Error('paymentKey: contactId required');
  if (!appointmentId || typeof appointmentId !== 'string') throw new Error('paymentKey: appointmentId required');
  return `${PREFIX}${contactId}:${appointmentId}`;
}

export function contactPrefix(contactId) {
  if (!contactId || typeof contactId !== 'string') throw new Error('contactPrefix: contactId required');
  return `${PREFIX}${contactId}:`;
}

// Build a validated, normalized payment record. Pure: returns a new frozen
// object and never mutates its input. Throws on invalid input (fail fast at the
// boundary) so a bad status/method can never reach KV.
export function buildPaymentRecord(input = {}) {
  const {
    contactId,
    appointmentId,
    status,
    method = null,
    note = null,
    amount = null,
    recordedBy = null,
    source = 'manual',
    at = null,
  } = input;

  if (!contactId) throw new Error('buildPaymentRecord: contactId required');
  if (!appointmentId) throw new Error('buildPaymentRecord: appointmentId required');
  if (!PAYMENT_STATUSES.includes(status)) throw new Error(`buildPaymentRecord: invalid status "${status}"`);
  if (method !== null && !PAYMENT_METHODS.includes(method)) throw new Error(`buildPaymentRecord: invalid method "${method}"`);
  if (!SOURCES.includes(source)) throw new Error(`buildPaymentRecord: invalid source "${source}"`);
  if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) {
    throw new Error('buildPaymentRecord: amount must be a non-negative number or null');
  }

  return Object.freeze({
    contactId,
    appointmentId,
    status,
    method,
    note: note ? String(note).slice(0, NOTE_MAX) : null,
    amount,
    recordedBy,
    source,
    at,
  });
}

// Decide what (if anything) to record for a session at mark-attended time.
// Pure — returns an input object ready for buildPaymentRecord, or null when
// there's nothing to record (no human answer and not package-covered, so the
// session reads as "unknown" until someone resolves it).
//
//   1. Garrett answered "how was this paid?" → honor it verbatim.
//   2. No answer, but an active package covers it → auto "on-package" (no prompt
//      is shown for these in the UI, so this is the silent default).
//   3. Otherwise → null. Absence of a record is meaningful: it's the pool the
//      owed list draws from.
export function resolveSessionPayment({
  contactId,
  appointmentId,
  explicitStatus = null,
  method = null,
  note = null,
  amount = null,
  drawsFromPackage = false,
  currentRemaining = 0,
  recordedBy = null,
  at = null,
}) {
  if (explicitStatus) {
    return { contactId, appointmentId, status: explicitStatus, method, note, amount, recordedBy, source: 'manual', at };
  }
  if (drawsFromPackage && currentRemaining > 0) {
    return { contactId, appointmentId, status: 'on-package', method: null, note: null, amount: null, recordedBy, source: 'manual', at };
  }
  return null;
}

// ── KV I/O ────────────────────────────────────────────────────────────────────
// Thin wrappers over the Cloudflare KV surface (get/put/list). Reads are
// fail-soft (return null/{} so a KV hiccup renders "unknown", never crashes a
// page). Writes surface errors to the caller, which logs and continues — the
// payment record must never block marking a session attended.

export async function readPaymentRecord(kv, contactId, appointmentId) {
  if (!kv) return null;
  try {
    return await kv.get(paymentKey(contactId, appointmentId), 'json');
  } catch {
    return null;
  }
}

export async function writePaymentRecord(kv, record) {
  if (!kv) throw new Error('writePaymentRecord: KV binding required');
  const key = paymentKey(record.contactId, record.appointmentId);
  await kv.put(key, JSON.stringify(record));
  return key;
}

export async function listPaymentRecordsForContact(kv, contactId) {
  if (!kv) return {};
  const out = {};
  try {
    const list = await kv.list({ prefix: contactPrefix(contactId) });
    for (const k of (list.keys || [])) {
      const rec = await kv.get(k.name, 'json');
      if (rec && rec.appointmentId) out[rec.appointmentId] = rec;
    }
  } catch {
    // Non-fatal — caller renders "unknown" on a read failure.
  }
  return out;
}
