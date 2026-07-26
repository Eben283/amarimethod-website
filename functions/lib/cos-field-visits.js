// Durable, lightweight relationship records for local field-study hosts.
// COS is the capture surface; this module is the source of truth for the
// business, its visit history, and the next in-person touch.

const INDEX_KEY = (user) => `cos:field-partners:${user}:index`;
const PARTNER_KEY = (user, id) => `cos:field-partner:${user}:${id}`;
const VISIT_KEY = (user, id) => `cos:field-visit:${user}:${id}`;
const IMAGE_KEY = (user, visitId, number) => `cos:field-visit-image:${user}:${visitId}:${number}`;
const MAX_INDEX_ENTRIES = 500;
const MAX_IMAGES = 3;

const STAGES = new Set(["host", "engaged_host", "partner", "workshop_opportunity"]);
const STAGE_RANK = { host: 1, engaged_host: 2, partner: 3, workshop_opportunity: 4 };

function string(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizedText(value) {
  return string(value, 280)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function partnerSlug(name, location = "") {
  const normalized = string(name, 120)
    ? normalizedText(name)
    : "unknown-business";
  const normalizedLocation = normalizedText(location);
  return normalizedLocation ? `${normalized}-${normalizedLocation}` : normalized;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function dateOnly(value) {
  const date = string(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function cleanContact(input = {}) {
  return {
    name: string(input.name, 160) || null,
    role: string(input.role, 160) || null,
    phone: string(input.phone, 80) || null,
    email: string(input.email, 254) || null,
  };
}

function cleanImage(image) {
  if (typeof image !== "string" || image.length > 2_000_000) return null;
  return /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(image) ? image : null;
}

async function loadIndex(kv, user) {
  const raw = await kv.get(INDEX_KEY(user));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Store one field visit and upsert its parent business relationship.
 * Images are intentionally kept separately from the small partner summary so
 * the relationship index remains quick to read on a phone.
 */
export async function recordFieldVisit(kv, user, input, images = []) {
  if (!kv) throw new Error("Field visits are unavailable: PORTAL_KV is not configured");

  const businessName = string(input.business_name, 180);
  if (!businessName) throw new Error("business_name is required to record a field visit");

  const now = new Date().toISOString();
  const normalizedName = partnerSlug(businessName);
  const normalizedLocation = normalizedText(input.location);
  const index = await loadIndex(kv, user);
  const sameName = index.filter((entry) => entry.normalized_name === normalizedName);
  const matchingIndex = normalizedLocation
    ? sameName.find((entry) => entry.normalized_location === normalizedLocation)
      // A first visit may have captured only the name. Let its later address
      // enrich that one record, but never merge an already-addressed branch.
      || (sameName.length === 1 && !sameName[0].normalized_location ? sameName[0] : null)
    : (sameName.length === 1 ? sameName[0] : null);
  const partnerId = matchingIndex?.id || `business_${partnerSlug(businessName, input.location)}`;
  const existingRaw = await kv.get(PARTNER_KEY(user, partnerId));
  let existing = null;
  try { existing = existingRaw ? JSON.parse(existingRaw) : null; } catch { /* start clean */ }

  const requestedStage = STAGES.has(input.relationship_stage) ? input.relationship_stage : "host";
  const existingStage = STAGES.has(existing?.relationship_stage) ? existing.relationship_stage : "host";
  // A quick replenishment visit should never demote a business that has already
  // earned a deeper relationship state.
  const stage = STAGE_RANK[requestedStage] >= STAGE_RANK[existingStage] ? requestedStage : existingStage;
  const visitId = newId("visit");
  const cleanImages = images.map(cleanImage).filter(Boolean).slice(0, MAX_IMAGES);
  const imageKeys = cleanImages.map((_, indexNumber) => IMAGE_KEY(user, visitId, indexNumber + 1));
  const contact = cleanContact(input.contact);
  const visit = {
    id: visitId,
    partner_id: partnerId,
    business_name: businessName,
    location: string(input.location, 280) || null,
    study: string(input.study, 160) || null,
    flyer_location: string(input.flyer_location, 280) || null,
    contact,
    relationship_stage: stage,
    notes: string(input.notes, 2000) || null,
    workshop_signal: Boolean(input.workshop_signal),
    next_visit_on: dateOnly(input.next_visit_on),
    event_on: dateOnly(input.event_on),
    event_title: string(input.event_title, 240) || null,
    event_details: string(input.event_details, 1200) || null,
    image_keys: imageKeys,
    created_at: now,
  };

  const existingContact = existing?.contact || {};
  const latestContact = (contact.name || contact.role || contact.phone || contact.email || existing?.contact)
    ? {
        name: contact.name || existingContact.name || null,
        role: contact.role || existingContact.role || null,
        phone: contact.phone || existingContact.phone || null,
        email: contact.email || existingContact.email || null,
      }
    : null;
  const partner = {
    id: partnerId,
    normalized_name: normalizedName,
    normalized_location: normalizedLocation || existing?.normalized_location || null,
    business_name: businessName,
    location: visit.location || existing?.location || null,
    study: visit.study || existing?.study || null,
    flyer_location: visit.flyer_location || existing?.flyer_location || null,
    contact: latestContact,
    relationship_stage: stage,
    workshop_signal: Boolean(visit.workshop_signal || existing?.workshop_signal),
    event_on: visit.event_on || existing?.event_on || null,
    event_title: visit.event_title || existing?.event_title || null,
    event_details: visit.event_details || existing?.event_details || null,
    // Logging a completed visit clears the previous follow-up unless this
    // visit supplied a new date. That prevents old dates staying "due" forever.
    next_visit_on: visit.next_visit_on,
    latest_note: visit.notes || existing?.latest_note || null,
    latest_visit_at: now,
    visit_count: (existing?.visit_count || 0) + 1,
    visit_ids: [...(existing?.visit_ids || []), visitId].slice(-50),
    image_keys: [...(existing?.image_keys || []), ...imageKeys].slice(-12),
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  const nextIndex = [
    ...index.filter((entry) => entry.id !== partnerId),
    {
      id: partnerId,
      normalized_name: normalizedName,
      normalized_location: partner.normalized_location,
      business_name: partner.business_name,
      relationship_stage: partner.relationship_stage,
      next_visit_on: partner.next_visit_on,
      latest_visit_at: partner.latest_visit_at,
    },
  ]
    .sort((a, b) => String(b.latest_visit_at || "").localeCompare(String(a.latest_visit_at || "")))
    .slice(0, MAX_INDEX_ENTRIES);

  await Promise.all([
    kv.put(PARTNER_KEY(user, partnerId), JSON.stringify(partner)),
    kv.put(VISIT_KEY(user, visitId), JSON.stringify(visit)),
    kv.put(INDEX_KEY(user), JSON.stringify(nextIndex)),
    // Photos are part of the business record, not a temporary chat upload.
    ...cleanImages.map((image, indexNumber) => kv.put(imageKeys[indexNumber], image)),
  ]);

  return { partner, visit };
}

export async function listFieldPartners(kv, user, { limit = 25, stage } = {}) {
  if (!kv) throw new Error("Field partners are unavailable: PORTAL_KV is not configured");
  const index = await loadIndex(kv, user);
  // The relationship index retains up to MAX_INDEX_ENTRIES. Consumers that
  // need an operational board (rather than a compact COS preview) must be
  // able to read the whole index so older follow-ups do not disappear.
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), MAX_INDEX_ENTRIES);
  const matching = stage && STAGES.has(stage)
    ? index.filter((entry) => entry.relationship_stage === stage)
    : index;
  const allPartners = await Promise.all(
    matching.map(async (entry) => {
      const raw = await kv.get(PARTNER_KEY(user, entry.id));
      try { return raw ? JSON.parse(raw) : entry; } catch { return entry; }
    })
  );
  // Visits due now (including overdue) come first; unscheduled relationships
  // follow by most recent touch. This makes “who do I revisit?” a real queue.
  return allPartners
    .sort((a, b) => {
      const aDue = a.next_visit_on || "9999-12-31";
      const bDue = b.next_visit_on || "9999-12-31";
      const dueCompare = aDue.localeCompare(bDue);
      return dueCompare || String(b.latest_visit_at || "").localeCompare(String(a.latest_visit_at || ""));
    })
    .slice(0, safeLimit);
}
