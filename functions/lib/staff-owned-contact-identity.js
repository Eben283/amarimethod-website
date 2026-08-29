// Resolve a Staff-facing person reference through Amari's owned CRM before a
// temporary provider adapter is allowed to act. Browser callers use the owned
// contact ID. Provider IDs remain accepted only as a migration compatibility
// input for older Staff surfaces and never become the command's durable owner.

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/contacts";
const TIMEOUT_MS = 10_000;

function clean(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function identityError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

export async function resolveOwnedContactIdentity(context, contactReference) {
  const reference = clean(contactReference);
  if (!reference) throw identityError("Choose a person.", "contact_reference_required", 400);
  if (!context?.env?.WORKER_AUTH_SECRET) {
    throw identityError("Owned CRM identity is not configured.", "owned_identity_unavailable", 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}?limit=20&query=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw identityError("Owned CRM identity is unavailable.", "owned_identity_unavailable", 503);
    }
    const body = await response.json().catch(() => ({}));
    const exact = (Array.isArray(body.contacts) ? body.contacts : []).filter((contact) =>
      clean(contact?.id) === reference || clean(contact?.provider_contact_id) === reference,
    );
    const ownedIds = new Set(exact.map((contact) => clean(contact?.id)).filter(Boolean));
    if (ownedIds.size > 1) {
      throw identityError("This person reference is ambiguous in the owned CRM.", "owned_identity_ambiguous", 409);
    }
    const contact = exact[0];
    const ownedContactId = clean(contact?.id);
    if (!ownedContactId) {
      throw identityError("This person was not found in the owned CRM.", "owned_contact_not_found", 404);
    }
    return Object.freeze({
      ownedContactId,
      providerContactId: clean(contact?.provider_contact_id) || null,
    });
  } catch (error) {
    if (error?.code) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw identityError("Owned CRM identity lookup timed out.", "owned_identity_unavailable", 503);
    }
    throw identityError("Owned CRM identity is unavailable.", "owned_identity_unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
}

export function requireProviderContactIdentity(identity) {
  if (!clean(identity?.ownedContactId)) {
    throw identityError("This person was not found in the owned CRM.", "owned_contact_not_found", 404);
  }
  const providerContactId = clean(identity?.providerContactId);
  if (!providerContactId) {
    throw identityError(
      "This owned person is not connected to the current calendar provider.",
      "provider_identity_missing",
      409,
    );
  }
  return providerContactId;
}
