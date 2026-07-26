import {
  beginSyncRun,
  finishSyncRun,
  findContactIdByGhlId,
  getSyncCursor,
  setSyncCursor,
  upsertGhlAppointment,
  upsertGhlContact,
  upsertStripeCharge,
} from "./repository.js";
import { normalizeGhlAppointment, normalizeGhlContact, normalizeStripeCharge } from "./normalizers.js";
import { fetchGhlAppointmentsForContact, fetchGhlContactsPage, fetchStripeChargesPage } from "./providers.js";

function result(status = "succeeded") {
  return { status, recordsRead: 0, recordsWritten: 0, recordsSkipped: 0, cursorAfter: null, failureDetail: null };
}

export async function syncGhl(env, limit, now) {
  const cursorBefore = await getSyncCursor(env.CRM_DB, "ghl");
  const runId = await beginSyncRun(env.CRM_DB, "ghl", cursorBefore, now);
  const outcome = result();
  try {
    const page = await fetchGhlContactsPage(env, cursorBefore, limit);
    for (const rawContact of page.contacts) {
      outcome.recordsRead += 1;
      const contact = normalizeGhlContact(rawContact);
      if (!contact) {
        outcome.recordsSkipped += 1;
        continue;
      }
      const contactId = await upsertGhlContact(env.CRM_DB, contact, now);
      outcome.recordsWritten += 1;
      const rawAppointments = await fetchGhlAppointmentsForContact(env, contact.externalId);
      for (const rawAppointment of rawAppointments) {
        outcome.recordsRead += 1;
        const appointment = normalizeGhlAppointment(rawAppointment, contact.externalId);
        if (!appointment) {
          outcome.recordsSkipped += 1;
          continue;
        }
        await upsertGhlAppointment(env.CRM_DB, appointment, contactId, now);
        outcome.recordsWritten += 1;
      }
    }
    outcome.cursorAfter = page.nextCursor;
    outcome.status = page.nextCursor ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, "ghl", page.nextCursor, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

export async function syncStripe(env, limit, now) {
  const cursorBefore = await getSyncCursor(env.CRM_DB, "stripe");
  const runId = await beginSyncRun(env.CRM_DB, "stripe", cursorBefore, now);
  const outcome = result();
  try {
    const page = await fetchStripeChargesPage(env, cursorBefore, limit);
    for (const rawCharge of page.charges) {
      outcome.recordsRead += 1;
      const charge = normalizeStripeCharge(rawCharge);
      if (!charge) {
        outcome.recordsSkipped += 1;
        continue;
      }
      const upserted = await upsertStripeCharge(env.CRM_DB, charge, now);
      outcome.recordsWritten += 1;
      if (!upserted.linked) outcome.recordsSkipped += 1;
    }
    outcome.cursorAfter = page.nextCursor;
    outcome.status = page.nextCursor ? "partial" : "succeeded";
    await setSyncCursor(env.CRM_DB, "stripe", page.nextCursor, now);
  } catch (error) {
    outcome.status = "failed";
    outcome.failureDetail = error instanceof Error ? error.message : String(error);
  }
  await finishSyncRun(env.CRM_DB, runId, outcome, now);
  if (outcome.status === "failed") throw new Error(outcome.failureDetail);
  return outcome;
}

export async function syncRequestedProviders(env, sources, limit, now) {
  const selected = new Set(sources);
  const results = {};
  if (selected.has("ghl")) results.ghl = await syncGhl(env, limit, now);
  if (selected.has("stripe")) results.stripe = await syncStripe(env, limit, now);
  return results;
}

export async function contactIdFromGhl(env, externalId) {
  return findContactIdByGhlId(env.CRM_DB, externalId);
}
