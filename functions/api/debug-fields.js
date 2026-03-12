// TEMPORARY — fetch all custom field IDs from GHL. DELETE after use.
import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

export async function onRequestGet(context) {
  try {
    const token = await getGhlToken(context);
    const res = await fetch(
      "https://services.leadconnectorhq.com/locations/7pIO7FHVAyBT1jKGhfQM/customFields",
      { headers: ghlHeaders(token) }
    );
    const data = await res.json();
    const fields = (data.customFields || []).map(f => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
    }));
    return new Response(JSON.stringify(fields, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
