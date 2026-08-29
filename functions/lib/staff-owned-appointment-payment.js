const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/appointments";
const TIMEOUT_MS = 10_000;

export async function writeOwnedAppointmentPayment(context, record) {
  if (!context?.env?.WORKER_AUTH_SECRET) throw new Error("Owned appointment payment is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const amountCents = record.amount == null ? null : Math.round(Number(record.amount) * 100);
    const response = await fetch(`${WORKER_URL}/${encodeURIComponent(record.appointmentId)}/payment`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactId: record.contactId,
        status: record.status,
        method: record.method,
        note: record.note,
        amountCents,
        source: record.source,
        recordedBy: record.recordedBy,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Owned appointment payment failed (${response.status}).`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}
