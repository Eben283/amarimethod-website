// Cloudflare Pages Function: POST /api/staff-partner-update-field
//
// Inline-edit a single field on a partner contact from the staff app.
// Whitelisted fields only — anything not in EDITABLE_FIELDS is rejected so
// the endpoint can't be used to overwrite system fields like partner_stage
// or partner_touch_count (those have dedicated flows).
//
// Request body: { contactId: string, field: string, value: string }
// Empty string = clear the field.
//
// Side effect: every successful edit also writes a GHL note for audit trail.
//
// Auth: JWT bearer.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Whitelist: which fields the staff app is allowed to inline-edit.
// 'kind' = 'standard' (on contact root) or 'custom' (in customFields[id]).
// 'label' is used in the audit note text.
const EDITABLE_FIELDS = {
  phone:               { kind: "standard", label: "Phone" },
  email:               { kind: "standard", label: "Email" },
  website:             { kind: "standard", label: "Website" },
  companyName:         { kind: "standard", label: "Business name" },
  address1:            { kind: "standard", label: "Address" },
  city:                { kind: "standard", label: "City" },
  state:               { kind: "standard", label: "State" },
  postalCode:          { kind: "standard", label: "Zip" },
  partnerInstagram:    { kind: "custom",   id: "4Y2f2SnTMK28kl6kNbPR", label: "Instagram" },
  partnerLinkedinUrl:  { kind: "custom",   id: "Zea1f8Z43bfkXvhYmcQj", label: "LinkedIn" },
  partnerFacility:     { kind: "custom",   id: "eYBj61zgMnIFMIesoDR5", label: "Facility" },
  partnerFacilityRole: { kind: "custom",   id: "FGakk9CgiRqeY0tleGQD", label: "Role" },
  partnerOtherUrls:    { kind: "custom",   id: "7KvhcBornVP0k0vT2h68", label: "Other URLs" },
  partnerRundown:      { kind: "custom",   id: "Yd3lsw6fAxl0HVCxr1cD", label: "Rundown" },
};


export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

// Per-field validators. Return null = valid, return string = error message.
function validateValue(field, value) {
  if (value === "") return null; // clearing is always allowed
  if (field === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Not a valid email";
  }
  if (field === "website" || field === "partnerLinkedinUrl") {
    if (!/^(https?:\/\/)?[^\s/$.?#].[^\s]*$/.test(value)) return "Not a valid URL";
  }
  if (field === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return "Phone must be 10-15 digits";
  }
  return null;
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const payload = await context.request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
    }
    const { contactId, field } = payload;
    let { value } = payload;
    if (!contactId || typeof contactId !== "string") {
      return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    }
    if (!field || !(field in EDITABLE_FIELDS)) {
      return new Response(JSON.stringify({ error: `field must be one of: ${Object.keys(EDITABLE_FIELDS).join(", ")}` }), { status: 400, headers });
    }
    if (typeof value !== "string") {
      return new Response(JSON.stringify({ error: "value must be a string (use empty string to clear)" }), { status: 400, headers });
    }
    value = value.trim();
    const validationError = validateValue(field, value);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), { status: 400, headers });
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });

    // Read current value for the audit note (so we can record what changed)
    let previousValue = "";
    try {
      const getRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers: ghlHeaders(ghlToken) });
      if (getRes.ok) {
        const cdata = await getRes.json();
        const contact = cdata.contact || cdata;
        const spec = EDITABLE_FIELDS[field];
        if (spec.kind === "standard") {
          previousValue = contact[field] || "";
        } else {
          const cf = (contact.customFields || []).find((f) => f.id === spec.id);
          previousValue = (cf?.value ?? cf?.field_value ?? "") + "";
        }
      }
    } catch (err) {
      // Non-fatal — note will just say "set to <new>" without "from <old>"
      console.error("[update-field] read prev failed:", err instanceof Error ? err.message : String(err));
    }

    // Idempotent: if value didn't change, no-op
    if ((previousValue || "") === value) {
      return new Response(JSON.stringify({ success: true, contactId, field, value, changed: false }), { status: 200, headers });
    }

    // Build PUT body for the single field
    const spec = EDITABLE_FIELDS[field];
    const body = {};
    if (spec.kind === "standard") {
      body[field] = value || null;
    } else {
      body.customFields = [{ id: spec.id, value: value }];
    }
    const updateRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => "");
      throw new Error(`GHL PUT ${updateRes.status}: ${text.slice(0, 250)}`);
    }

    // Audit note (best-effort — don't fail the request if note fails)
    const noteBody = value
      ? `Field edit: ${spec.label} = "${value}"${previousValue ? ` (was "${previousValue}")` : ""}`
      : `Field cleared: ${spec.label}${previousValue ? ` (was "${previousValue}")` : ""}`;
    try {
      await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody }),
      });
    } catch (err) {
      console.error("[update-field] note write failed:", err instanceof Error ? err.message : String(err));
    }

    return new Response(JSON.stringify({ success: true, contactId, field, value, previousValue, changed: true }), { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-partner-update-field] failed:", detail);
    return new Response(JSON.stringify({ error: `Failed to update field: ${detail}` }), { status: 500, headers });
  }
}
