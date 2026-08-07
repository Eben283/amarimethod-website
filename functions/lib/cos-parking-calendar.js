import { deriveParkingReminderPlan } from "./cos-parking.js";

const activeReminderKey = (user) => `cos:active-parking-reminder:${user}`;

async function retireTrackedEvents(deleteEvent, ids) {
  const failed = [];
  for (const id of [...new Set(ids.filter(Boolean))]) {
    try {
      const result = await deleteEvent(id);
      if (result !== true && result?.ok !== true) failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}

// This module is the single seam for parking-calendar replacement. It makes a
// new event first, then retires the old tracked event, so a Calendar outage
// never silently removes the user's existing reminder.
export async function replaceParkingCalendarReminder({ kv, createEvent, deleteEvent }, user, parking) {
  const key = activeReminderKey(user);
  let prior = null;
  try {
    const raw = await kv?.get(key);
    prior = raw ? JSON.parse(raw) : null;
  } catch {
    prior = null;
  }

  const priorIds = [prior?.id, ...(prior?.pending_delete_ids || [])];
  const plan = deriveParkingReminderPlan(parking);
  if (!plan) {
    const staleEventIds = await retireTrackedEvents(deleteEvent, priorIds);
    if (staleEventIds.length > 0) {
      await kv?.put(key, JSON.stringify({ pending_delete_ids: staleEventIds }));
    } else {
      await kv?.delete?.(key);
    }
    return { scheduled: false, reason: "No calculable parking deadline", stale_event_ids: staleEventIds };
  }

  let created;
  try {
    created = await createEvent({
      title: `Move car — ${parking.location}`,
      starts_at: plan.starts_at,
      reminder_minutes: plan.reminder_minutes,
      description: parking.rule_detail || "Parking deadline",
    });
  } catch (error) {
    return { scheduled: false, reason: error instanceof Error ? error.message : "Calendar reminder failed" };
  }
  if (!created?.id) return { scheduled: false, reason: created?.error || "Calendar reminder failed" };

  const staleEventIds = await retireTrackedEvents(deleteEvent, priorIds);
  await kv?.put(key, JSON.stringify({
    id: created.id,
    title: created.title || `Move car — ${parking.location}`,
    start: created.start || plan.starts_at,
    ...(staleEventIds.length > 0 ? { pending_delete_ids: staleEventIds } : {}),
  }));

  return { scheduled: true, event_id: created.id, stale_event_ids: staleEventIds, ...plan };
}
