// Provider-neutral contact reads for nurture branching, guards, and message rendering.
// Provider contact IDs are accepted only as a transition lookup through external_records;
// every returned identity is the owned CRM contact ID.

const LEGACY_PRIMARY_PAIN_LOCATION = "vKZTVAG7601lgV8413du";
const LEGACY_PAIN_PATTERN_SIGNATURE = "BvTGZ9O9ayecw5f0Nj76";
const LEGACY_PAIN_DURATION = "wrYzlW0ta2SGD8cI5iTM";
const OWNED_PRIMARY_PAIN_LOCATION = "primaryPainLocation";
const OWNED_PAIN_PATTERN_SIGNATURE = "painPatternSignature";
const OWNED_PAIN_DURATION = "painDuration";

const NURTURE_FIELDS = Object.freeze({
  primaryPainLocation: Object.freeze({
    owned: OWNED_PRIMARY_PAIN_LOCATION,
    legacy: LEGACY_PRIMARY_PAIN_LOCATION,
  }),
  painPatternSignature: Object.freeze({
    owned: OWNED_PAIN_PATTERN_SIGNATURE,
    legacy: LEGACY_PAIN_PATTERN_SIGNATURE,
  }),
  painDuration: Object.freeze({
    owned: OWNED_PAIN_DURATION,
    legacy: LEGACY_PAIN_DURATION,
  }),
});

async function resolveRows(db, contactReference) {
  if (!db) throw new Error("owned CRM contact store is not configured");
  const reference = String(contactReference || "").trim();
  if (!reference) throw new Error("contact reference is required");
  const result = await db.prepare(`
    SELECT DISTINCT contact.id, contact.first_name, contact.email_normalized
      FROM contacts contact
      LEFT JOIN external_records source
        ON source.contact_id = contact.id
       AND source.provider = 'ghl'
       AND source.object_type = 'contact'
     WHERE contact.archived_at IS NULL
       AND (contact.id = ? OR source.external_id = ?)
     ORDER BY CASE WHEN contact.id = ? THEN 0 ELSE 1 END, contact.id
     LIMIT 2
  `).bind(reference, reference, reference).all();
  return result?.results || [];
}

export async function resolveOwnedNurtureContact(db, contactReference) {
  const rows = await resolveRows(db, contactReference);
  if (!rows.length) throw new Error("owned CRM contact was not found");
  if (rows.length > 1) throw new Error("owned CRM contact reference is ambiguous");
  const row = rows[0];
  return Object.freeze({
    id: String(row.id),
    firstName: typeof row.first_name === "string" ? row.first_name.trim() : "",
    email: typeof row.email_normalized === "string" ? row.email_normalized.trim().toLowerCase() : "",
  });
}

export async function readOwnedContactTags(db, contactReference) {
  const contact = await resolveOwnedNurtureContact(db, contactReference);
  const result = await db.prepare(
    "SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY lower(tag), tag",
  ).bind(contact.id).all();
  return (result?.results || []).map((row) => String(row.tag || "").trim()).filter(Boolean);
}

export async function readOwnedContactFields(db, contactReference) {
  const contact = await resolveOwnedNurtureContact(db, contactReference);
  const result = await db.prepare(`
    SELECT source, attribute_key, attribute_value
      FROM contact_attributes
     WHERE contact_id = ?
       AND attribute_key IN (?, ?, ?, ?, ?, ?)
     ORDER BY updated_at DESC
  `).bind(
    contact.id,
    OWNED_PRIMARY_PAIN_LOCATION,
    LEGACY_PRIMARY_PAIN_LOCATION,
    OWNED_PAIN_PATTERN_SIGNATURE,
    LEGACY_PAIN_PATTERN_SIGNATURE,
    OWNED_PAIN_DURATION,
    LEGACY_PAIN_DURATION,
  ).all();
  const rows = result?.results || [];
  const valueFor = ({ owned, legacy }) => {
    const candidates = [
      rows.find((row) => row.source === "owned" && row.attribute_key === owned),
      rows.find((row) => row.attribute_key === owned),
      rows.find((row) => row.attribute_key === legacy),
    ];
    const match = candidates.find((row) => row?.attribute_value != null && String(row.attribute_value).trim());
    return match ? String(match.attribute_value).trim() : null;
  };
  return Object.freeze(Object.fromEntries(
    Object.entries(NURTURE_FIELDS).map(([key, definition]) => [key, valueFor(definition)]),
  ));
}

export async function readOwnedContactRecipient(db, contactReference) {
  const contact = await resolveOwnedNurtureContact(db, contactReference);
  if (!contact.firstName) throw new Error("owned CRM contact first name is missing");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    throw new Error("owned CRM contact email is missing or invalid");
  }
  return contact;
}

export async function addOwnedContactTags(db, contactReference, tags, nowMs = Date.now()) {
  const contact = await resolveOwnedNurtureContact(db, contactReference);
  const cleaned = [...new Set((tags || []).map((tag) => String(tag || "").trim()).filter(Boolean))];
  if (!cleaned.length) return { contactId: contact.id, added: 0 };
  const results = await db.batch(cleaned.map((tag) => db.prepare(`
    INSERT OR IGNORE INTO contact_tags (contact_id, tag, source, created_at)
    VALUES (?, ?, 'owned:nurture', ?)
  `).bind(contact.id, tag, new Date(nowMs).toISOString())));
  return {
    contactId: contact.id,
    added: results.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0),
  };
}
