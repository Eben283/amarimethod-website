// Provider-neutral contact reads for nurture branching, guards, and message rendering.
// Provider contact IDs are accepted only as a transition lookup through external_records;
// every returned identity is the owned CRM contact ID.

const LEGACY_PRIMARY_PAIN_LOCATION = "vKZTVAG7601lgV8413du";
const OWNED_PRIMARY_PAIN_LOCATION = "primaryPainLocation";

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
       AND attribute_key IN (?, ?)
     ORDER BY CASE WHEN attribute_key = ? THEN 0 ELSE 1 END,
              CASE WHEN source = 'owned' THEN 0 ELSE 1 END,
              updated_at DESC
  `).bind(
    contact.id,
    OWNED_PRIMARY_PAIN_LOCATION,
    LEGACY_PRIMARY_PAIN_LOCATION,
    OWNED_PRIMARY_PAIN_LOCATION,
  ).all();
  const value = (result?.results || [])
    .map((row) => row.attribute_value)
    .find((candidate) => candidate != null && String(candidate).trim() !== "");
  return Object.freeze({
    primaryPainLocation: value == null ? null : String(value).trim(),
  });
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
