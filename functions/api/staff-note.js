// Cloudflare Pages Function: POST/PUT /api/staff-note
// Create or update an ordinary Staff note on a GHL contact.

import { ghlFetch } from "../lib/ghl.js";
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { isEditableStaffNote } from "../../shared/staff-note-policy.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function noteText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildNoteUpdatePath(contactId, noteId) {
  return `${GHL_API_BASE}/contacts/${contactId}/notes/${noteId}`;
}

export function validateNoteUpdate({ contactId, noteId, body }) {
  if (!noteText(contactId)) return { error: "Contact ID required" };
  if (!noteText(noteId)) return { error: "Note ID required" };
  if (!noteText(body)) return { error: "Note body required" };
  if (noteText(body).length > 5000) return { error: "Note too long (max 5000 chars)" };
  return { contactId: noteText(contactId), noteId: noteText(noteId), body: noteText(body) };
}

export function editableExistingNote(noteResponse) {
  const note = noteResponse?.note || noteResponse;
  return typeof note?.body === "string" && isEditableStaffNote(note.body);
}

function validationResponse(validation, headers) {
  return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), "POST, PUT, OPTIONS"),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const { body, error: parseError } = await parseJsonBody(context.request, headers);



    if (parseError) return parseError;
    const validation = validateNoteUpdate({ contactId: body.contactId, noteId: "new", body: body.body });
    if (validation.error) return validationResponse(validation, headers);

    const noteRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${validation.contactId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: validation.body }),
    });

    if (!noteRes.ok) {
      const errText = await noteRes.text();
      console.error(`[staff-note] GHL note create error: ${noteRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to save note" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-note] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}

// Update an existing, visible Staff note in place. This intentionally keeps the
// original GHL note ID, timestamp, and list position rather than creating a
// second note that would leave the stale text behind.
export async function onRequestPut(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, PUT, OPTIONS"), "Content-Type": "application/json" };

  try {
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;

    const { body, error: parseError } = await parseJsonBody(context.request, headers);
    if (parseError) return parseError;

    const validation = validateNoteUpdate(body);
    if (validation.error) return validationResponse(validation, headers);

    // Never rely on the browser to protect audit, automation, or signed notes.
    // GHL owns the record, so read the requested note before authorizing its edit.
    const existingRes = await ghlFetch(context, buildNoteUpdatePath(validation.contactId, validation.noteId));
    if (!existingRes.ok) {
      const errText = await existingRes.text();
      console.error(`[staff-note] GHL note read before update error: ${existingRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Could not verify note for editing" }), { status: 422, headers });
    }
    const existingNote = await existingRes.json();
    if (!editableExistingNote(existingNote)) {
      return new Response(JSON.stringify({ error: "Only ordinary Staff notes can be edited" }), { status: 403, headers });
    }

    const noteRes = await ghlFetch(context, buildNoteUpdatePath(validation.contactId, validation.noteId), {
      method: "PUT",
      body: JSON.stringify({ body: validation.body }),
    });

    if (!noteRes.ok) {
      const errText = await noteRes.text();
      console.error(`[staff-note] GHL note update error: ${noteRes.status} ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to update note" }), { status: 422, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-note] Unexpected update error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
