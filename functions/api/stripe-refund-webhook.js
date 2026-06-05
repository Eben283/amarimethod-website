// Cloudflare Pages Function: POST /api/stripe-refund-webhook
//
// Catches Stripe `charge.refunded` events. The GHL-order ledger and the
// sessions_remaining / portal_access / living_practice_access fields never see
// a Stripe refund (the order still reads "completed"), so a refunded client
// keeps their balance + portal access. This closes that hole.
//
// Policy (decideRefundAction, confirmed with Eben 2026-06-05): AUTO-REVOKE only
// the clean case (full refund of an un-drawn full series); everything else is
// left untouched and flagged for manual review. EITHER way we write a GHL note
// + a KV record so the daily audit surfaces it — refunds are never silent.
//
// Activation (not done by this code): register the endpoint via the Stripe API
// and set STRIPE_WEBHOOK_SECRET in Cloudflare Pages env. See PR description.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { decideRefundAction } from "../lib/refund-policy.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Session-tracking field IDs (canonical — see CLAUDE.md / reconcile.js FIELD_IDS).
const FIELD = {
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  portal_access: "O0xmwyRqeNK2EA1GGGye",
  living_practice_access: "1EnVtI70jC5MTshZjWvw",
};

// Verify Stripe's `Stripe-Signature` header (scheme: t=<ts>,v1=<hmac>).
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("=").map((s) => s.trim())),
  );
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

function readSessionsRemaining(contact) {
  const cf = (contact.customFields || []).find((x) => x.id === FIELD.sessions_remaining);
  const raw = cf ? (cf.value ?? cf.field_value) : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function lookupContactIdByEmail(email, token) {
  if (!email) return null;
  try {
    const url = `${GHL_API_BASE}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: ghlHeaders(token) });
    if (res.ok) {
      const d = await res.json();
      if (d.contact?.id) return d.contact.id;
      if (d.contacts?.[0]?.id) return d.contacts[0].id;
    }
  } catch (err) {
    console.error(`[stripe-refund-webhook] email lookup failed: ${err.message}`);
  }
  return null;
}

async function addNote(contactId, body, token) {
  try {
    await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: ghlHeaders(token),
      body: JSON.stringify({ body }),
    });
  } catch (err) {
    console.error(`[stripe-refund-webhook] note write failed: ${err.message}`);
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost(context) {
  // Stripe needs the raw body for signature verification.
  const rawBody = await context.request.text();
  const sig = context.request.headers.get("Stripe-Signature");
  const secret = context.env.STRIPE_WEBHOOK_SECRET;

  if (!(await verifyStripeSignature(rawBody, sig, secret))) {
    console.error("[stripe-refund-webhook] signature verification failed");
    return json({ error: "Invalid signature" }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (event.type !== "charge.refunded") {
    return json({ received: true, ignored: event.type });
  }

  const charge = event.data?.object || {};
  const kv = context.env.PORTAL_KV;
  const idemKey = `refund:${event.id}`;

  // Idempotency — Stripe retries deliveries.
  if (kv) {
    try {
      if (await kv.get(idemKey)) return json({ received: true, duplicate: true });
    } catch (err) {
      console.error(`[stripe-refund-webhook] KV read failed: ${err.message}`);
    }
  }

  const token = await getGhlToken(context);
  const email = charge.billing_details?.email || charge.receipt_email || null;
  const contactId =
    charge.metadata?.contactId || (await lookupContactIdByEmail(email, token));

  const dateStamp = new Date().toISOString().slice(0, 10);
  const amountStr = `$${((charge.amount_refunded || 0) / 100).toFixed(2)}`;

  // Couldn't tie the refund to a contact — record + return 200 (don't make
  // Stripe retry forever) but make the orphan loud via KV for the daily audit.
  if (!contactId) {
    console.error(`[stripe-refund-webhook] no contact for charge ${charge.id} (${email || "no email"})`);
    if (kv) {
      try {
        await kv.put(
          idemKey,
          JSON.stringify({ at: dateStamp, action: "no-contact", chargeId: charge.id, email }),
          { expirationTtl: 90 * 86400 },
        );
        await kv.put(`ops:refund-review:${event.id}`, JSON.stringify({ at: dateStamp, reason: "no contact match", chargeId: charge.id, email, amount: amountStr }), { expirationTtl: 30 * 86400 });
      } catch (err) {
        console.error(`[stripe-refund-webhook] KV write failed: ${err.message}`);
      }
    }
    return json({ received: true, contact: null });
  }

  // Fetch current balance to decide.
  let contact = null;
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers: ghlHeaders(token) });
    if (res.ok) contact = (await res.json()).contact;
  } catch (err) {
    console.error(`[stripe-refund-webhook] contact fetch failed: ${err.message}`);
  }
  const sessionsRemaining = contact ? readSessionsRemaining(contact) : null;

  const decision = decideRefundAction(charge, { sessionsRemaining });

  if (decision.action === "revoke") {
    try {
      await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        headers: ghlHeaders(token),
        body: JSON.stringify({
          customFields: [
            { id: FIELD.sessions_remaining, value: 0 },
            { id: FIELD.portal_access, value: [] },
            { id: FIELD.living_practice_access, value: [] },
          ],
        }),
      });
    } catch (err) {
      console.error(`[stripe-refund-webhook] revoke PUT failed: ${err.message}`);
    }
    await addNote(
      contactId,
      `[stripe-refund-webhook ${dateStamp}] REFUND — AUTO-REVOKED. ${amountStr} refunded (charge ${charge.id}). ${decision.reason}. Set sessions_remaining=0, portal_access off, living_practice_access off. Reverse manually if this was not intended.`,
      token,
    );
  } else {
    await addNote(
      contactId,
      `[stripe-refund-webhook ${dateStamp}] REFUND — MANUAL REVIEW NEEDED. ${amountStr} refunded (charge ${charge.id}). ${decision.reason}. No automatic change was made — please review sessions_remaining / portal access and adjust if needed.`,
      token,
    );
  }

  if (kv) {
    try {
      await kv.put(
        idemKey,
        JSON.stringify({ at: dateStamp, action: decision.action, contactId, chargeId: charge.id, reason: decision.reason }),
        { expirationTtl: 90 * 86400 },
      );
      // Surface every refund for the daily audit, not just orphans.
      await kv.put(
        `ops:refund-review:${event.id}`,
        JSON.stringify({ at: dateStamp, action: decision.action, contactId, chargeId: charge.id, amount: amountStr, reason: decision.reason }),
        { expirationTtl: 30 * 86400 },
      );
    } catch (err) {
      console.error(`[stripe-refund-webhook] KV write failed: ${err.message}`);
    }
  }

  return json({ received: true, action: decision.action, contactId });
}
