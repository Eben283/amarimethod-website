function cleanIdentity(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= 160 ? text : "";
}

export class OwnedContactIdentityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OwnedContactIdentityError";
    this.code = code;
  }
}

/**
 * Resolve every exact identifier by which one owned person can appear in the
 * transition-era Reminder store. Provider webhooks still use the GHL contact
 * id so dual ingress converges on the same enrollment. Owned Google Calendar
 * events use the stable CRM id. A confirmed rebooking must close both forms,
 * but only after the CRM proves they identify one and the same person.
 */
export async function ownedContactAliases(env, event) {
  const eventContactId = cleanIdentity(event?.contactId);
  if (!eventContactId) {
    throw new OwnedContactIdentityError("appointment contact identity is missing", "contact_identity_missing");
  }
  if (event?.context?.source !== "owned_crm") return Object.freeze([eventContactId]);

  const ownedContactId = cleanIdentity(event.context.ownedContactId);
  const contextProviderContactId = cleanIdentity(event.context.providerContactId);
  const provider = cleanIdentity(event.context.provider);
  if (!ownedContactId || !new Set(["ghl", "google_calendar"]).has(provider)) {
    throw new OwnedContactIdentityError("owned appointment contact identity is incomplete", "owned_contact_identity_incomplete");
  }
  if (!env?.CRM_DB?.prepare) {
    throw new OwnedContactIdentityError("owned CRM contact crosswalk is unavailable", "owned_contact_crosswalk_unavailable");
  }

  const result = await env.CRM_DB.prepare(
    `SELECT contact.id AS owned_contact_id, external.external_id AS ghl_contact_id
       FROM contacts contact
       LEFT JOIN external_records external
         ON external.contact_id = contact.id
        AND external.provider = 'ghl'
        AND external.object_type = 'contact'
      WHERE contact.id = ? AND contact.archived_at IS NULL
      ORDER BY external.external_id
      LIMIT 2`,
  ).bind(ownedContactId).all();
  const rows = result.results || [];
  if (!rows.length) {
    throw new OwnedContactIdentityError("owned appointment contact was not found", "owned_contact_not_found");
  }
  if (rows.length > 1) {
    throw new OwnedContactIdentityError("owned appointment contact has ambiguous GHL identity", "owned_contact_alias_ambiguous");
  }

  const ghlContactId = cleanIdentity(rows[0].ghl_contact_id);
  if (provider === "ghl") {
    if (!ghlContactId || contextProviderContactId !== ghlContactId || eventContactId !== ghlContactId) {
      throw new OwnedContactIdentityError("GHL appointment contact does not match the owned CRM", "owned_contact_alias_mismatch");
    }
  } else if (contextProviderContactId || eventContactId !== ownedContactId) {
    throw new OwnedContactIdentityError("Google appointment contact does not match the owned CRM", "owned_contact_alias_mismatch");
  }

  return Object.freeze([...new Set([eventContactId, ownedContactId, ghlContactId].filter(Boolean))]);
}
