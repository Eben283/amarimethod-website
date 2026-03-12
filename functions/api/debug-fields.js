// Temporary debug endpoint: GET /api/debug-fields
// Lists all GHL custom fields with their IDs. DELETE after use.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

export async function onRequestGet(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/html; charset=utf-8",
  };

  try {
    const token = await getGhlToken(context);
    const res = await fetch(
      `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`,
      { headers: ghlHeaders(token) }
    );

    if (!res.ok) {
      const errText = await res.text();
      return new Response(`<h1>GHL API Error ${res.status}</h1><pre>${errText}</pre>`, {
        status: 200,
        headers: corsHeaders,
      });
    }

    const data = await res.json();
    const fields = data.customFields || [];

    const rows = fields
      .map((f) => {
        const key = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        return `<tr>
          <td style="padding:4px 12px;border:1px solid #ccc;font-weight:bold">${f.name || ""}</td>
          <td style="padding:4px 12px;border:1px solid #ccc;font-family:monospace">${f.id}</td>
          <td style="padding:4px 12px;border:1px solid #ccc">${key}</td>
          <td style="padding:4px 12px;border:1px solid #ccc">${f.dataType || f.type || ""}</td>
        </tr>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html><head><title>GHL Custom Fields</title></head>
<body style="font-family:sans-serif;padding:20px">
<h1>GHL Custom Fields (${fields.length})</h1>
<table style="border-collapse:collapse">
<tr style="background:#f0f0f0">
  <th style="padding:4px 12px;border:1px solid #ccc">Name</th>
  <th style="padding:4px 12px;border:1px solid #ccc">Field ID</th>
  <th style="padding:4px 12px;border:1px solid #ccc">Key</th>
  <th style="padding:4px 12px;border:1px solid #ccc">Type</th>
</tr>
${rows}
</table>
<p style="margin-top:20px;color:#999">⚠️ Delete this endpoint after use: functions/api/debug-fields.js</p>
</body></html>`;

    return new Response(html, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(`<h1>Error</h1><pre>${err.message}</pre>`, {
      status: 200,
      headers: corsHeaders,
    });
  }
}
