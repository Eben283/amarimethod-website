import { renderOwnedAppointmentCalendar } from "../lib/appointment-calendar.js";
import { resolveClientAppointmentManageContext } from "../lib/client-appointment-manage.js";

const BASE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export async function onRequestGet(context) {
  const token = new URL(context.request.url).searchParams.get("token") || "";
  try {
    const resolved = await resolveClientAppointmentManageContext(context, token, "calendar");
    return new Response(renderOwnedAppointmentCalendar(resolved.identity), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="amari-appointment.ics"',
      },
    });
  } catch (error) {
    const status = [401, 403, 404, 409, 503].includes(Number(error?.status)) ? Number(error.status) : 503;
    return new Response("This appointment calendar link is unavailable.", {
      status,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
