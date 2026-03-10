// Cloudflare Pages Function: POST /api/referral-complete
// Called by a GHL webhook when a referred contact completes a session purchase.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";

// Flow:
// 1. Fetch the purchasing contact from GHL
// 2. Read referred_by_client_id — if unset, return early (not a referral or already credited)
// 3. Clear referred_by_client_id on the referred contact (prevents double-counting)
// 4. Fetch the referrer, read client_referral_count, increment by 1, PUT back
// 5. If new count >= 3 AND no referral_reward_code set yet:
//    a. Generate coupon code: AMARI- + last 6 chars of referrer contactId
//    b. Attempt to create a real GHL coupon via /payments/coupons (requires payments scope)
//    c. Store the code in referral_reward_code custom field on referrer
//    d. Add tag client-referral-milestone (triggers reward email workflow in GHL)
//
// GHL webhook setup (manual, post-deploy):
//   In each session purchase workflow, add a conditional HTTP POST step:
//   - Condition: referred_by_client_id is set / not empty
//   - URL: https://www.amarimethod.com/api/referral-complete
//   - Body: { "contactId": "{{contact.id}}" }
//
// ⚠️  GHL coupon creation (step 5b) requires the GHL_API_KEY to have "payments" scope.
//     If the key lacks this scope, coupon creation fails gracefully and the code is still
//     stored in the GHL field — Garrett can honor it manually until the scope is added.

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const REFERRAL_MILESTONE = 3;

// Fetch all custom field definitions and return a map of shortKey → fieldId.
async function fetchFieldDefs(apiKey) {
  try {
    const res = await fetch(`${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
      headers: ghlHeaders(apiKey),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const fieldDefs = {};
    for (const f of (data.customFields || [])) {
      const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
      if (shortKey) fieldDefs[shortKey] = f.id;
    }
    return fieldDefs;
  } catch (err) {
    console.error("[referral-complete] fetchFieldDefs error:", err.message);
    return {};
  }
}

// Read a single custom field value from a contact object.
function getCustomField(contact, fieldId) {
  if (!contact.customFields || !fieldId) return null;
  const field = contact.customFields.find((f) => f.id === fieldId);
  return field ? (field.value ?? field.field_value ?? null) : null;
}

// Update one or more custom fields on a contact.
async function putContactFields(apiKey, contactId, fieldUpdates) {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(apiKey),
    body: JSON.stringify({ customFields: fieldUpdates }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PUT contact ${contactId} failed (${res.status}): ${errText}`);
  }
  return res;
}

// Add a tag to a contact (appends to existing tags).
async function addContactTag(apiKey, contactId, tag) {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: ghlHeaders(apiKey),
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[referral-complete] addTag "${tag}" failed for ${contactId} (${res.status}): ${errText}`);
  }
}

// Attempt to create a real GHL coupon via the Payments API.
// Requires GHL_API_KEY to have "payments" scope — fails gracefully if not.
// Returns true on success, false on failure.
async function createGhlCoupon(apiKey, code) {
  try {
    const res = await fetch(`${GHL_API_BASE}/payments/coupons`, {
      method: "POST",
      headers: ghlHeaders(apiKey),
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        code,
        discount: {
          type: "percentage",
          amount: 100,
        },
        redemptionLimit: 1,
        // NOTE: Add productId here to scope the coupon to a specific session product
        // once you have the product ID from GHL → Payments → Products.
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[referral-complete] GHL coupon creation failed (${res.status}): ${errText}`);
      console.warn("[referral-complete] This likely means the API key needs 'payments' scope — add it in GHL → Settings → Private Integrations → Cloudflare Portal.");
      return false;
    }
    console.log(`[referral-complete] GHL coupon created successfully: ${code}`);
    return true;
  } catch (err) {
    console.error(`[referral-complete] createGhlCoupon error: ${err.message}`);
    return false;
  }
}

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  try {
    const GHL_API_KEY = await getGhlToken(context);

    if (!GHL_API_KEY) {
      console.error("[referral-complete] GHL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers }
      );
    }

    const body = await context.request.json();
    const { contactId } = body;

    if (!contactId || typeof contactId !== "string" || contactId.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "contactId is required" }),
        { status: 400, headers }
      );
    }

    const sanitizedContactId = contactId.trim().slice(0, 50);

    // ── Fetch field defs and referred contact in parallel ──
    const [fieldDefs, contactRes] = await Promise.all([
      fetchFieldDefs(GHL_API_KEY),
      fetch(`${GHL_API_BASE}/contacts/${sanitizedContactId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
    ]);

    if (!contactRes.ok) {
      console.error(`[referral-complete] Referred contact not found: ${sanitizedContactId} (${contactRes.status})`);
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers }
      );
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    const referredByFieldId = fieldDefs["referred_by_client_id"];
    const referralCountFieldId = fieldDefs["client_referral_count"];
    const rewardCodeFieldId = fieldDefs["referral_reward_code"];

    if (!referredByFieldId || !referralCountFieldId || !rewardCodeFieldId) {
      console.error("[referral-complete] One or more referral custom fields missing from GHL. Check that client_referral_count, referred_by_client_id, and referral_reward_code fields exist.");
      return new Response(
        JSON.stringify({ error: "Referral fields not configured" }),
        { status: 500, headers }
      );
    }

    const referrerId = getCustomField(contact, referredByFieldId);

    if (!referrerId) {
      // Not a referred contact, or already credited — nothing to do.
      console.log(`[referral-complete] Contact ${sanitizedContactId} has no referred_by_client_id — skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true }), { status: 200, headers });
    }

    console.log(`[referral-complete] Processing referral: referred=${sanitizedContactId}, referrer=${referrerId}`);

    // ── Clear referred_by_client_id on the referred contact ──
    // This prevents double-counting if the referred person makes additional purchases.
    try {
      await putContactFields(GHL_API_KEY, sanitizedContactId, [
        { id: referredByFieldId, field_value: "" },
      ]);
      console.log(`[referral-complete] Cleared referred_by_client_id on contact ${sanitizedContactId}`);
    } catch (err) {
      console.error(`[referral-complete] Failed to clear referred_by_client_id: ${err.message}`);
      // Non-fatal — continue processing
    }

    // ── Fetch the referrer contact ──
    const referrerRes = await fetch(`${GHL_API_BASE}/contacts/${referrerId}`, {
      headers: ghlHeaders(GHL_API_KEY),
    });

    if (!referrerRes.ok) {
      console.error(`[referral-complete] Referrer not found: ${referrerId} (${referrerRes.status})`);
      return new Response(
        JSON.stringify({ error: "Referrer contact not found" }),
        { status: 404, headers }
      );
    }

    const referrerData = await referrerRes.json();
    const referrer = referrerData.contact;

    // ── Read and increment client_referral_count ──
    const currentCountRaw = getCustomField(referrer, referralCountFieldId);
    const currentCount = parseInt(currentCountRaw ?? "0", 10) || 0;
    const newCount = currentCount + 1;

    try {
      await putContactFields(GHL_API_KEY, referrerId, [
        { id: referralCountFieldId, field_value: String(newCount) },
      ]);
      console.log(`[referral-complete] Updated referral count for ${referrerId}: ${currentCount} → ${newCount}`);
    } catch (err) {
      console.error(`[referral-complete] Failed to update referral count: ${err.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to update referral count" }),
        { status: 500, headers }
      );
    }

    // ── Milestone: create reward coupon ──
    const existingRewardCode = getCustomField(referrer, rewardCodeFieldId);

    if (newCount >= REFERRAL_MILESTONE && !existingRewardCode) {
      // Generate unique code from last 6 chars of referrer's contactId
      const codeSuffix = referrerId.slice(-6).toUpperCase();
      const rewardCode = `AMARI-${codeSuffix}`;

      console.log(`[referral-complete] Milestone reached for ${referrerId} — generating reward code: ${rewardCode}`);

      // Attempt to create a real GHL coupon (best-effort)
      const couponCreated = await createGhlCoupon(GHL_API_KEY, rewardCode);

      if (!couponCreated) {
        console.log(`[referral-complete] GHL coupon creation failed — code will be honored manually by Garrett`);
      }

      // Always store the code in GHL field and add milestone tag
      // (even if GHL coupon creation failed — Garrett honours it manually)
      try {
        await putContactFields(GHL_API_KEY, referrerId, [
          { id: rewardCodeFieldId, field_value: rewardCode },
        ]);
        console.log(`[referral-complete] Stored reward code ${rewardCode} for referrer ${referrerId}`);
      } catch (err) {
        console.error(`[referral-complete] Failed to store reward code: ${err.message}`);
      }

      // Add tag to trigger the reward email workflow in GHL
      await addContactTag(GHL_API_KEY, referrerId, "client-referral-milestone");
      console.log(`[referral-complete] Added client-referral-milestone tag to ${referrerId}`);
    }

    return new Response(
      JSON.stringify({ success: true, newCount }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error("[referral-complete] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
}
