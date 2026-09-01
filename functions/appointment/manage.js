import {
  clientAppointmentAvailability,
  executeClientAppointmentManage,
  resolveClientAppointmentManageContext,
} from "../lib/client-appointment-manage.js";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function response(body, status = 200) {
  return new Response(body, { status, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}

function frame(content, title = "Manage your appointment") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Amari Method</title><style>
  :root{color-scheme:light;--ink:#18211c;--muted:#5d675f;--paper:#f7f2e9;--card:#fffdf8;--accent:#b55532;--line:#d8d0c3}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,sans-serif}main{max-width:720px;margin:0 auto;padding:48px 20px 80px}.mark{font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700}.card{margin-top:18px;padding:clamp(24px,5vw,46px);background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 16px 50px #4d3c2a12}h1{font:500 clamp(34px,7vw,56px)/1.02 Georgia,serif;margin:8px 0 18px}.summary{color:var(--muted);margin:0 0 28px}.facts{border-block:1px solid var(--line);padding:18px 0;margin:22px 0}.facts p{margin:4px 0}label{display:block;font-weight:650;margin:14px 0 7px}select{width:100%;padding:13px;border:1px solid var(--line);border-radius:9px;background:white;font:inherit}button,.button{display:inline-block;margin-top:18px;padding:13px 20px;border:0;border-radius:999px;background:var(--ink);color:white;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.danger{background:#8d3028}.secondary{background:transparent;color:var(--ink);border:1px solid var(--line);margin-left:8px}.note{font-size:14px;color:var(--muted);margin-top:20px}.error{color:#8d3028;font-weight:650}@media(max-width:520px){.secondary{display:block;margin-left:0}}
  </style></head><body><main><div class="mark">Amari Method</div><section class="card">${content}</section></main></body></html>`;
}

function dateTime(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

function appointmentFacts(identity) {
  return `<div class="facts"><p><strong>${escapeHtml(identity.serviceName || "Amari Method Session")}</strong></p><p>${escapeHtml(dateTime(identity.startsAt, identity.timezone))}</p><p>${escapeHtml(identity.meetingLocation || "662 8th Ave, San Francisco")}</p></div>`;
}

function unavailable(error) {
  const status = [400, 401, 403, 404, 409, 413, 503].includes(Number(error?.status)) ? Number(error.status) : 503;
  return response(frame('<h1>This link is unavailable.</h1><p class="summary">The appointment may have changed, passed, or already been managed. Please email <a href="mailto:hello@amarimethod.com">hello@amarimethod.com</a> if you need help.</p>', "Link unavailable"), status);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("token") || "";
  const action = url.searchParams.get("action") || "";
  if (!new Set(["cancel", "reschedule"]).has(action)) return unavailable({ status: 400 });
  try {
    const resolved = await resolveClientAppointmentManageContext(context, token, action);
    const identity = resolved.identity;
    if (action === "cancel") {
      return response(frame(`<h1>Cancel this appointment?</h1><p class="summary">Nothing changes until you confirm below.</p>${appointmentFacts(identity)}<form method="post" action="/appointment/manage"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="action" value="cancel"><button class="danger" type="submit">Yes, cancel appointment</button><a class="button secondary" href="/">Keep appointment</a></form><p class="note">Opening this link never cancels an appointment. Only the confirmation button does.</p>`));
    }
    const availability = await clientAppointmentAvailability(resolved);
    const options = availability.slots.map((slot) =>
      `<option value="${escapeHtml(slot.datetime)}">${escapeHtml(dateTime(slot.datetime, availability.timezone))}</option>`,
    ).join("");
    return response(frame(`<h1>Choose a new time.</h1><p class="summary">Your current appointment stays in place until a new time is confirmed.</p>${appointmentFacts(identity)}${options ? `<form method="post" action="/appointment/manage"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="action" value="reschedule"><label for="startTime">Available times</label><select id="startTime" name="startTime" required>${options}</select><button type="submit">Confirm new time</button><a class="button secondary" href="/">Keep current time</a></form>` : '<p class="error">No new times are available right now. Your current appointment has not changed.</p>'}<p class="note">Changing the time does not send a payment or create an extra appointment.</p>`));
  } catch (error) {
    return unavailable(error);
  }
}

export async function onRequestPost(context) {
  const requestOrigin = context.request.headers.get("Origin");
  if (requestOrigin !== new URL(context.request.url).origin) return unavailable({ status: 403 });
  if (!String(context.request.headers.get("Content-Type") || "").toLowerCase()
    .startsWith("application/x-www-form-urlencoded")) return unavailable({ status: 400 });
  const length = Number(context.request.headers.get("Content-Length") || 0);
  if (length > 10_000) return unavailable({ status: 413 });
  let form;
  try { form = await context.request.formData(); } catch { return unavailable({ status: 400 }); }
  const token = String(form.get("token") || "");
  const action = String(form.get("action") || "");
  const startTime = String(form.get("startTime") || "");
  try {
    const result = await executeClientAppointmentManage(context, token, action, startTime);
    const message = action === "cancel"
      ? "Your appointment is cancelled."
      : "Your appointment has been rescheduled.";
    const detail = action === "reschedule" && result?.newStartTime
      ? `<p class="summary">New time: ${escapeHtml(dateTime(result.newStartTime, "America/Los_Angeles"))}</p>`
      : '<p class="summary">You are all set.</p>';
    return response(frame(`<h1>${escapeHtml(message)}</h1>${detail}<p><a class="button" href="mailto:hello@amarimethod.com">Contact Amari</a></p>`, "Appointment updated"));
  } catch (error) {
    return unavailable(error);
  }
}
