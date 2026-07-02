// Cloud port of coach-template.mjs (runtime version, 2026-06-28).
// Reads/writes KV directly instead of using wrangler CLI subprocesses.
// State:
//   reads  coach:records:snapshot  (KV mirror of what's currently in coach:{contactId})
//   reads  coach:personalized      (hand-authored cards; never overwritten)
//   writes coach:{contactId}       (individual cards read by the Follow-Up panel)
//   writes coach:records:snapshot  (updated mirror after writes/deletes)
//
// Per-contact copy comes from the angle ladder (./angles.js) — see
// ops/drafts/fable-5-review-2026-07-01.md. Cold-variant contacts get a
// step-indexed angle (identity → gift → honest-why → substance → gentle-no);
// this file owns only the KV read/write/diff orchestration around it.

import { getRung, renderAngle, renderGuaranteeFallback, elapsedPhrase, isPhone, firstName } from "./angles.js";

// "breakup" (the final step's state) must stay in these sets — see
// cadence.js: isBreakup ? "breakup" : ... — or the ladder's gentle-no rung
// never reaches this filter at all.
const TARGET_STATES = new Set(["one-touch-no-reply", "no-reply", "breakup"]);
const LINK_STALL_STATES = new Set(["one-touch-no-reply", "no-reply", "gone-quiet", "breakup"]);
const DELETE_FLOOR_RATIO = 0.5;

const UNTEXTABLE = new Set(["landline", "toll_free", "voip"]);
const isUntextable = (lineType) => UNTEXTABLE.has(lineType);

// Compares every field the ladder can change — a coincidental match on just
// message/whyNow/variations must not hide a real angle/channel/email/
// callScript change (that would leave stale content in KV with no write).
export function recordsEqual(a, b) {
  return !!a && !!b &&
    a.message === b.message && a.whyNow === b.whyNow &&
    JSON.stringify(a.variations || []) === JSON.stringify(b.variations || []) &&
    a.angle === b.angle && a.channel === b.channel &&
    JSON.stringify(a.email || null) === JSON.stringify(b.email || null) &&
    JSON.stringify(a.callScript || null) === JSON.stringify(b.callScript || null);
}

// Only called with a rendered ladder rung, which today is always cold (5
// steps) — getRung() returns null for 'warm', so buildDesiredRecord never
// reaches here with anything else.
function buildWhyNow(rendered, label, days, channel, untextableOverride, lineType) {
  const verb = channel === "email" ? "Email" : channel === "call" ? "Call" : "Text";
  let msg = `${verb} ${label} now — step ${rendered.step} of 5: ${rendered.angleLabel}. You reached out ${elapsedPhrase(days)}.`;
  if (untextableOverride) msg += ` This is a ${lineType} number, so this step becomes a call instead of a text.`;
  return msg;
}

// Pure — no KV access. Builds everything about a contact's card EXCEPT
// generatedAt (which depends on prior KV history, tracked by the caller).
export function buildDesiredRecord(d, overlays = {}) {
  const { stall, priceFlag } = overlays;
  const days = Math.round(d.sinceLastTouchDays);
  const untextable = isUntextable(d.lineType);
  const label = isPhone(d.name) ? "this contact" : firstName(d.name);

  const rendered = renderAngle(d.variant, d.step, {
    name: d.name,
    days,
    overlay: stall ? "link-stall" : null,
    product: stall?.product,
    untextable,
  });

  if (!rendered) {
    // Outside the cold ladder's scope (any warm-variant contact — the warm
    // ladder is a deferred fast-follow, see ops/drafts/fable-5-review-2026-07-01.md).
    // TARGET_STATES now includes "breakup" (needed for the cold gentle-no
    // rung), which also admits WARM contacts at their own breakup step with
    // no stall at all — the fallback below has nothing to render without a
    // product to reference (a real regression caught by a second-pass
    // review: it rendered "I sent you the undefined link"). Bail out with no
    // card rather than a broken one; the caller must skip null records.
    if (!stall?.product) return null;
    const lines = renderGuaranteeFallback({ name: d.name, days, product: stall.product });
    const channel = untextable ? "call" : "text";
    const whyNow = untextable
      ? `Call ${label} — this is a ${d.lineType} number. You sent the ${stall?.product} link ${elapsedPhrase(days)}. If they pick up, lead with the guarantee: come in, find what's causing the pain, no relief = keep working at no charge.`
      : `Text ${label} now. You sent the ${stall?.product} link ${elapsedPhrase(days)} and they haven't booked. Lead with the guarantee — come in, find out what's causing the pain, if no noticeable relief keep working at no charge. This is the price-objection play.`;
    return {
      contactId: d.contactId, name: d.name, bucket: "link-sent", channel, whyNow,
      message: lines[0], variations: lines,
      angle: "guarantee-fallback", angleLabel: "The guarantee (pre-ladder fallback)", step: d.step ?? null, variant: d.variant,
      sms: channel === "text" ? lines : null, email: null, callScript: channel === "call" ? lines : null,
    };
  }

  let { channel, sms, email, callScript } = rendered;
  let untextableOverride = false;
  // A text-shaped rung can't reach a landline/VoIP number — fall back to a
  // call instead. Prefer the rung's own purpose-written callScript (some
  // rungs, e.g. the gift, provide one distinct from the sms wording, since
  // sms text can reference texting itself — "feel free to call or text" —
  // which reads as nonsensical read aloud on a call already in progress).
  // Fall back to reusing the sms content only if the rung has no dedicated
  // call script (true today for the link-stall overlay and the breakup,
  // both already channel-neutral wording). Email rungs are unaffected by
  // line type.
  if (channel === "text" && untextable) {
    channel = "call";
    callScript = callScript || sms;
    sms = null;
    untextableOverride = true;
  }

  let whyNow = buildWhyNow(rendered, label, days, channel, untextableOverride, d.lineType);
  if (priceFlag) {
    whyNow += ` Heads up: they raised cost or insurance on a call. If it comes up, lead with the relief guarantee. Come in, we find out what's actually causing your pain, and if you don't feel noticeable relief, we keep working until you do, at no extra charge.`;
  }

  const bucket = stall ? "link-sent" : "called-no-connect";
  // message/variations mirror whichever content is the primary payload —
  // matches historical behavior (these fields held call-script content for
  // call-channel cards before this change too), so anything else reading
  // them keeps working during rollout.
  const primary = sms || callScript || (email ? [email.body] : []);

  return {
    contactId: d.contactId, name: d.name, bucket, channel, whyNow,
    message: primary[0] || "", variations: primary,
    angle: rendered.angle, angleLabel: rendered.angleLabel, step: rendered.step, variant: rendered.variant,
    sms, email, callScript,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = false; }
    }
  });
  await Promise.all(workers);
  return out;
}

// Returns the updated records array (confirmed KV reality after writes/deletes).
export async function runTemplate(env, due, priceFlags, linkStalls) {
  const kv = env.PORTAL_KV;
  const log = (...a) => console.error("[template]", ...a);

  const [recs, personalized] = await Promise.all([
    kv.get("coach:records:snapshot", "json").then((v) => v || []),
    kv.get("coach:personalized", "json").then((v) => v || []),
  ]);

  const protectedIds = new Set(personalized.map((p) => p.contactId));

  const existingTemplated = new Map(
    recs.filter((r) => r.source !== "personalized" && !protectedIds.has(r.contactId))
        .map((r) => [r.contactId, r])
  );
  const existingById = new Map(recs.map((r) => [r.contactId, r]));

  const today = new Date().toISOString().slice(0, 10);
  const targets = due.filter((d) => {
    if (!d.contactId || protectedIds.has(d.contactId)) return false;
    if (linkStalls.has(d.contactId)) return LINK_STALL_STATES.has(d.state);
    return TARGET_STATES.has(d.state);
  });

  const desired = new Map();
  for (const d of targets) {
    const prev = existingTemplated.get(d.contactId);
    const rec = buildDesiredRecord(d, {
      stall: linkStalls.get(d.contactId),
      priceFlag: priceFlags.has(d.contactId),
    });
    // null means: outside the ladder's scope with nothing safe to render
    // (a warm contact at its breakup step with no stall) — no card, not a
    // broken one.
    if (!rec) continue;
    desired.set(d.contactId, { ...rec, generatedAt: prev?.generatedAt || today });
  }

  const toWrite = [], unchanged = [];
  for (const [id, rec] of desired) {
    if (recordsEqual(existingTemplated.get(id), rec)) unchanged.push(rec);
    else toWrite.push(rec);
  }
  const toDelete = [...existingTemplated.keys()].filter((id) => !desired.has(id));
  const persToWrite = personalized.filter((p) => !recordsEqual(existingById.get(p.contactId), p));

  log(`desired ${desired.size} | new/changed ${toWrite.length} | unchanged ${unchanged.length} | delete ${toDelete.length}`);
  log(`personalized ${personalized.length} | needing write ${persToWrite.length}`);

  // Safety valve: skip deletes if the due-set collapsed (likely upstream truncation).
  const existingCount = existingTemplated.size;
  const collapsed = existingCount > 0 && desired.size < existingCount * DELETE_FLOOR_RATIO;
  const safeToDelete = desired.size > 0 && !collapsed;

  if (collapsed) {
    log(`WARN: due-set collapsed (${desired.size} vs ${existingCount} prior) — skipping ${toDelete.length} deletes`);
  }

  // Track confirmed KV state — only update on success.
  const kvTemplated = new Map(existingTemplated);

  const writeResults = await mapLimit(toWrite, 10, async (r) => {
    try {
      await kv.put(`coach:${r.contactId}`, JSON.stringify(r));
      kvTemplated.set(r.contactId, r);
      return true;
    } catch (e) {
      log(`WRITE FAIL ${r.name}: ${e.message?.slice(0, 80)}`);
      return false;
    }
  });
  const wrote = writeResults.filter(Boolean).length;

  const kvPers = new Map(
    recs.filter((r) => r.source === "personalized" || protectedIds.has(r.contactId))
        .map((r) => [r.contactId, r])
  );
  const persResults = await mapLimit(persToWrite, 10, async (r) => {
    try {
      await kv.put(`coach:${r.contactId}`, JSON.stringify(r));
      kvPers.set(r.contactId, r);
      return true;
    } catch (e) {
      log(`PERS WRITE FAIL ${r.name}: ${e.message?.slice(0, 80)}`);
      return false;
    }
  });
  const wroteP = persResults.filter(Boolean).length;

  let deleted = 0;
  if (safeToDelete) {
    const delResults = await mapLimit(toDelete, 5, async (id) => {
      try {
        await kv.delete(`coach:${id}`);
        kvTemplated.delete(id);
        return true;
      } catch (e) {
        log(`DEL FAIL ${existingTemplated.get(id)?.name || id}: ${e.message?.slice(0, 80)}`);
        return false;
      }
    });
    deleted = delResults.filter(Boolean).length;
  }

  const merged = [...kvPers.values(), ...kvTemplated.values()];
  await kv.put("coach:records:snapshot", JSON.stringify(merged));
  log(`wrote ${wrote}/${toWrite.length} templated + ${wroteP}/${persToWrite.length} personalized; deleted ${deleted}/${toDelete.length}. snapshot: ${merged.length} cards`);
  return merged;
}
