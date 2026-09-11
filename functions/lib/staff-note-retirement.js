// Shared provider-free response for retired standalone Staff note entry points.

export const RETIRED_STAFF_NOTE = Object.freeze({
  error: "Staff note writes moved to Amari CRM",
  code: "staff_note_path_retired",
  destination: "/staff/client-desk",
});

export function retiredStaffNoteResponse(headers = {}) {
  return new Response(JSON.stringify(RETIRED_STAFF_NOTE), { status: 410, headers });
}

