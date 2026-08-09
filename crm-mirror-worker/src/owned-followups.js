const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CONTACT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const STAFF_ACTOR = /^[A-Za-z][A-Za-z .'-]{0,78}$/;
const MAX_TITLE_LENGTH = 280;

function validDateOnly(value) {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateOwnedFollowupInput(input) {
  const contactExternalId = String(input?.contactExternalId || "").trim();
  const title = String(input?.title || "").trim();
  const dueOn = String(input?.dueOn || "").trim();
  const actor = String(input?.actor || "").trim();
  if (!CONTACT_ID.test(contactExternalId)) throw new Error("valid contactId required");
  if (!title) throw new Error("follow-up text required");
  if (title.length > MAX_TITLE_LENGTH) throw new Error(`follow-up text must be ${MAX_TITLE_LENGTH} characters or fewer`);
  if (!validDateOnly(dueOn)) throw new Error("valid due date required");
  if (!STAFF_ACTOR.test(actor)) throw new Error("valid staff actor required");
  return { contactExternalId, title, dueOn, actor };
}

function publicFollowup(row) {
  return {
    id: row.id,
    contactId: row.contact_external_id,
    contactName: row.display_name || "Unknown",
    title: row.title,
    dueOn: row.due_on,
    completedAt: row.completed_at || null,
    createdBy: row.created_by,
    completedBy: row.completed_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function followupById(db, id) {
  const row = await db.prepare(
    `SELECT followup.id, followup.title, followup.due_on, followup.completed_at,
            followup.created_by, followup.completed_by, followup.created_at, followup.updated_at,
            contact.display_name, external.external_id AS contact_external_id
     FROM owned_followups followup
     JOIN contacts contact ON contact.id = followup.contact_id
     JOIN external_records external
       ON external.contact_id = contact.id AND external.provider = 'ghl' AND external.object_type = 'contact'
     WHERE followup.id = ?`,
  ).bind(id).first();
  return row ? publicFollowup(row) : null;
}

export async function createOwnedFollowup(db, input, now = new Date().toISOString(), followupId = crypto.randomUUID()) {
  const value = validateOwnedFollowupInput(input);
  const contact = await db.prepare(
    `SELECT contact.id, contact.display_name, external.external_id
     FROM external_records external
     JOIN contacts contact ON contact.id = external.contact_id
     WHERE external.provider = 'ghl' AND external.object_type = 'contact' AND external.external_id = ?`,
  ).bind(value.contactExternalId).first();
  if (!contact) throw new Error("contact is not mirrored");

  await db.prepare(
    `INSERT INTO owned_followups
       (id, contact_id, title, due_on, completed_at, created_by, completed_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
  ).bind(followupId, contact.id, value.title, value.dueOn, value.actor, now, now).run();
  return followupById(db, followupId);
}

export async function listOwnedFollowups(db, { state = "open", limit = 50 } = {}) {
  const normalizedState = state === "completed" || state === "all" ? state : "open";
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const result = await db.prepare(
    `SELECT followup.id, followup.title, followup.due_on, followup.completed_at,
            followup.created_by, followup.completed_by, followup.created_at, followup.updated_at,
            contact.display_name, external.external_id AS contact_external_id
     FROM owned_followups followup
     JOIN contacts contact ON contact.id = followup.contact_id
     JOIN external_records external
       ON external.contact_id = contact.id AND external.provider = 'ghl' AND external.object_type = 'contact'
     WHERE (? = 'all')
        OR (? = 'open' AND followup.completed_at IS NULL)
        OR (? = 'completed' AND followup.completed_at IS NOT NULL)
     ORDER BY CASE WHEN followup.completed_at IS NULL THEN 0 ELSE 1 END,
              followup.due_on ASC, datetime(followup.updated_at) DESC, followup.id
     LIMIT ?`,
  ).bind(normalizedState, normalizedState, normalizedState, normalizedLimit).all();
  return (result.results || []).map(publicFollowup);
}

export async function setOwnedFollowupCompletion(db, followupId, completed, actor, now = new Date().toISOString()) {
  const id = String(followupId || "").trim();
  const cleanActor = String(actor || "").trim();
  if (!CONTACT_ID.test(id)) throw new Error("valid follow-up id required");
  if (!STAFF_ACTOR.test(cleanActor)) throw new Error("valid staff actor required");
  if (!await followupById(db, id)) throw new Error("follow-up not found");
  await db.prepare(
    `UPDATE owned_followups
     SET completed_at = ?, completed_by = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(completed ? now : null, completed ? cleanActor : null, now, id).run();
  return followupById(db, id);
}
