// Staff-owned manual partner-reward ledger. It never sends, charges, or writes GHL.
import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { rewardForPracticePurchase } from "../lib/partner-reward-ledger.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const iso = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
function headers(context) { return { ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" }; }
function event(id, rewardId, actor, type, detail) { return [id, rewardId, Date.now(), actor, type, JSON.stringify(detail)]; }
function insert(db, rewardId, actor, type, detail) {
  return db.prepare("INSERT INTO partner_reward_events (id,reward_id,ts,actor,type,detail) VALUES (?,?,?,?,?,?)").bind(...event(crypto.randomUUID(), rewardId, actor, type, detail));
}

export async function onRequestOptions(context) { return new Response(null, { status: 204, headers: headers(context) }); }
export async function onRequestGet(context) {
  const out = headers(context); const auth = await requireStaffAuth(context, out); if (auth.error) return auth.error;
  const db = context.env.AUTOMATION_DB; if (!db) return new Response(JSON.stringify({ configured: false, rewards: [] }), { headers: out });
  const rows = await db.prepare("SELECT id, reward_id, ts, actor, type, detail FROM partner_reward_events ORDER BY ts DESC LIMIT 200").all();
  return new Response(JSON.stringify({ configured: true, rewards: (rows.results || []).map(r => ({ ...r, detail: JSON.parse(r.detail) })) }), { headers: out });
}
export async function onRequestPost(context) {
  const out = headers(context); const auth = await requireStaffAuth(context, out); if (auth.error) return auth.error;
  const parsed = await parseJsonBody(context.request, out); if (parsed.error) return parsed.error;
  const db = context.env.AUTOMATION_DB; if (!db) return new Response(JSON.stringify({ error: "Partner reward ledger is not configured" }), { status: 422, headers: out });
  const { action, rewardId, partnerContactId, referredContactId, referralAt, purchasedAt, sessionCount, payoutReference, reason, correctionType } = parsed.body;
  const actor = String(auth.payload?.user || "Staff").slice(0, 80);
  if (action === "attribute") {
    if (![partnerContactId, referredContactId, rewardId].every(v => ID.test(String(v || "")))) return new Response(JSON.stringify({ error: "Valid reward, partner, and referred-contact IDs are required" }), { status: 400, headers: out });
    const referredAt = iso(referralAt);
    if (!referredAt) return new Response(JSON.stringify({ error: "A valid referral date is required" }), { status: 400, headers: out });
    const existing = await db.prepare("SELECT id FROM partner_reward_events WHERE reward_id=? AND type='attributed' LIMIT 1").bind(rewardId).first();
    if (existing) return new Response(JSON.stringify({ error: "Reward is already attributed; use a correction event to preserve the history" }), { status: 409, headers: out });
    const detail = { partnerContactId, referredContactId, referralAt: referredAt };
    await insert(db, rewardId, actor, "attributed", detail).run();
    return new Response(JSON.stringify({ success: true, state: "attributed" }), { status: 201, headers: out });
  }
  if (action === "qualify") {
    if (!ID.test(String(rewardId || ""))) return new Response(JSON.stringify({ error: "Valid reward ID is required" }), { status: 400, headers: out });
    const attribution = await db.prepare("SELECT detail FROM partner_reward_events WHERE reward_id=? AND type='attributed' ORDER BY ts ASC LIMIT 1").bind(rewardId).first();
    if (!attribution) return new Response(JSON.stringify({ error: "Reward must be attributed before it can qualify" }), { status: 422, headers: out });
    const existing = await db.prepare("SELECT id FROM partner_reward_events WHERE reward_id=? AND type='qualifying_purchase' LIMIT 1").bind(rewardId).first();
    if (existing) return new Response(JSON.stringify({ error: "Reward is already qualified; use a correction event to preserve the history" }), { status: 409, headers: out });
    const policy = rewardForPracticePurchase({ referralAt: JSON.parse(attribution.detail).referralAt, purchasedAt, sessionCount: Number(sessionCount) });
    if (!policy.qualifies) return new Response(JSON.stringify({ error: policy.reason }), { status: 422, headers: out });
    const detail = { purchasedAt: iso(purchasedAt), sessionCount: Number(sessionCount), amountCents: policy.amountCents, holdUntil: policy.holdUntil };
    await db.batch(["qualifying_purchase", "chargeback_hold"].map(type => insert(db, rewardId, actor, type, detail)));
    return new Response(JSON.stringify({ success: true, state: "chargeback_hold", ...detail }), { status: 201, headers: out });
  }
  if (action === "pay") {
    if (!ID.test(String(rewardId || "")) || !String(payoutReference || "").trim()) return new Response(JSON.stringify({ error: "Valid reward ID and payout reference are required" }), { status: 400, headers: out });
    const last = await db.prepare("SELECT detail FROM partner_reward_events WHERE reward_id=? AND type='chargeback_hold' ORDER BY ts DESC LIMIT 1").bind(rewardId).first();
    const hold = last && JSON.parse(last.detail).holdUntil;
    if (!hold || Date.now() < Date.parse(hold)) return new Response(JSON.stringify({ error: "Chargeback hold has not elapsed" }), { status: 422, headers: out });
    const paid = await db.prepare("SELECT id FROM partner_reward_events WHERE reward_id=? AND type='paid' LIMIT 1").bind(rewardId).first();
    if (paid) return new Response(JSON.stringify({ error: "Reward has already been paid" }), { status: 409, headers: out });
    const blocked = await db.prepare("SELECT type FROM partner_reward_events WHERE reward_id=? AND type IN ('expired','refunded','disputed','voided') ORDER BY ts DESC LIMIT 1").bind(rewardId).first();
    if (blocked) return new Response(JSON.stringify({ error: `Reward cannot be paid after ${blocked.type}` }), { status: 422, headers: out });
    const detail = { payoutReference: String(payoutReference).trim().slice(0, 160), paidAt: new Date().toISOString(), holdUntil: hold };
    await db.batch(["payable", "paid"].map(type => insert(db, rewardId, actor, type, detail)));
    return new Response(JSON.stringify({ success: true, state: "paid" }), { status: 201, headers: out });
  }
  if (action === "correct") {
    const type = String(correctionType || "correction");
    if (!ID.test(String(rewardId || "")) || !["expired", "refunded", "disputed", "voided", "correction"].includes(type) || !String(reason || "").trim()) return new Response(JSON.stringify({ error: "Reward ID, correction type, and evidence note are required" }), { status: 400, headers: out });
    await insert(db, rewardId, actor, type, { reason: String(reason).trim().slice(0, 500), recordedAt: new Date().toISOString() }).run();
    return new Response(JSON.stringify({ success: true, state: type }), { status: 201, headers: out });
  }
  return new Response(JSON.stringify({ error: "Unsupported partner-reward action" }), { status: 400, headers: out });
}
