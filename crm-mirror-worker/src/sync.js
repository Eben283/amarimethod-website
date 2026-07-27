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
import { normalizeGhlAppointment, normalizeGhlContact, normalizeStripeCharge, normalizedEmail } from "./normalizers.js";
import { fetchGhlAppointmentsForContact, fetchGhlContactsPage, fetchStripeChargesPage, fetchStripeCustomer } from "./providers.js";

function result(status = "succeeded") {
  return { status, recordsRead: 0, recordsWritten: 0, recordsSkipped: 0, cursorAfter: null, failureDetail: null };
}

// A cron pass remains deliberately bounded. GHL contacts are paginated, so the
// cursor advances through the full mirror across runs instead of doing one large
// provider read. This is observation-only: these functions write only CRM_DB.
export const SCHEDULED_SYNC_LIMIT = 50;

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
  const customerEmailCache = new Map();
  try {
    const page = await fetchStripeChargesPage(env, cursorBefore, limit);
    for (const rawCharge of page.charges) {
      outcome.recordsRead += 1;
      const charge = normalizeStripeCharge(rawCharge);
      if (!charge) {
        outcome.recordsSkipped += 1;
        continue;
      }
      let enrichedCharge = charge;
      // This only improves evidence for an otherwise-unlinked charge. A Stripe
      // customer email can create a review candidate, never an automatic link.
      if (!charge.contactExternalId && !charge.billingEmail && charge.customerExternalId) {
        let customerEmail = customerEmailCache.get(charge.customerExternalId);
        if (customerEmail === undefined) {
          try {
            const customer = await fetchStripeCustomer(env, charge.customerExternalId);
            customerEmail = normalizedEmail(customer?.email);
          } catch (error) {
            customerEmail = null;
            console.warn(JSON.stringify({
              event: "crm_mirror_stripe_customer_lookup_failed",
              customerId: charge.customerExternalId,
              message: error instanceof Error ? error.message : String(error),
            }));
          }
          customerEmailCache.set(charge.customerExternalId, customerEmail);
        }
        if (customerEmail) enrichedCharge = { ...charge, billingEmail: customerEmail };
      }
      const upserted = await upsertStripeCharge(env.CRM_DB, enrichedCharge, now);
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

export async function runScheduledSync(env, now) {
  const results = {};
  for (const [provider, sync] of [["ghl", syncGhl], ["stripe", syncStripe]]) {
    try {
      results[provider] = await sync(env, SCHEDULED_SYNC_LIMIT, now);
    } catch (error) {
      // Each provider records its own failed sync run. Keep the other source
      // moving so a transient GHL failure cannot make Stripe stale too.
      results[provider] = {
        status: "failed",
        failureDetail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  console.log(JSON.stringify({ event: "crm_mirror_scheduled_sync", limit: SCHEDULED_SYNC_LIMIT, results }));
  return results;
}

export async function contactIdFromGhl(env, externalId) {
  return findContactIdByGhlId(env.CRM_DB, externalId);
}
