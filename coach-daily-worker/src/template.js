// Cloud port of coach-template.mjs (runtime version, 2026-06-28).
// Reads/writes KV directly instead of using wrangler CLI subprocesses.
// State:
//   reads  coach:records:snapshot  (KV mirror of what's currently in coach:{contactId})
//   reads  coach:personalized      (hand-authored cards; never overwritten)
//   writes coach:{contactId}       (individual cards read by the Follow-Up panel)
//   writes coach:records:snapshot  (updated mirror after writes/deletes)

const TARGET_STATES = new Set(["one-touch-no-reply", "no-reply"]);
const LINK_STALL_STATES = new Set(["one-touch-no-reply", "no-reply", "gone-quiet"]);
const DELETE_FLOOR_RATIO = 0.5;

const isPhone = (n) => /^\(?\d[\d\s().-]{6,}$/.test((n || "").trim());
const isBusiness = (n) =>
  /\b(fitness|gym|studio|training|crossfit|pilates|yoga|wellness|club|barre|strength|performance|athletic)\b/i.test(n || "");
const firstName = (n) => (n || "").trim().split(/\s+/)[0];
const UNTEXTABLE = new Set(["landline", "toll_free", "voip"]);
const isUntextable = (lineType) => UNTEXTABLE.has(lineType);

function recordsEqual(a, b) {
  return !!a && !!b && a.message === b.message && a.whyNow === b.whyNow &&
    JSON.stringify(a.variations || []) === JSON.stringify(b.variations || []);
}

function opener(name, days) {
  const biz = isBusiness(name) || isPhone(name);
  const who = biz ? "Hi, it's Garrett with Amari Method!" : `Hi ${firstName(name)}, it's Garrett!`;
  let gap;
  if (days <= 3)  gap = "I gave you a call earlier but didn't catch you.";
  else if (days <= 14) gap = "I called a week or so back but didn't get to connect.";
  else if (days <= 35) gap = "I reached out a few weeks ago and never properly followed up, my apologies.";
  else gap = "It's been a while since I tried to reach you, and I dropped the ball on following up, sorry about that.";
  return `${who} ${gap}`;
}

function elapsedPhrase(days) {
  if (days <= 3)  return "in the last few days";
  if (days <= 14) return "about a week ago";
  if (days <= 35) return "a few weeks ago";
  return "over a month ago";
}

function bodies(name) {
  if (isBusiness(name)) {
    return [
      "I teach at-home protocols that keep clients out of pain, and I partner with gyms to help keep members training pain free. I'd love to gift one of your trainers a session to feel the work. Who's the best person to talk to about it?",
      "I partner with gyms to keep members healthy and training longer, with a nice incentive for the gym too. I'd love to set up a session for someone on your team to feel the work. Who's the best person to reach about it?",
    ];
  }
  return [
    "I'm a body alignment specialist here in SF and I teach at-home protocols that are amazing for low back and joint pain. I'd love to gift you a session so you can feel the work for yourself. Feel free to call or text whenever's good!",
    "I teach at-home protocols that get rid of low back and joint pain, and I'd love to gift you a session to try them. If you're inspired, we could even talk about partnering. Feel free to call or text when you have time.",
  ];
}
const variationsFor = (name, days) => bodies(name).map((b) => `${opener(name, days)} ${b}`);

function guaranteeVariations(name, product, days) {
  const biz = isBusiness(name) || isPhone(name);
  const fn = firstName(name);
  let gap;
  if (days <= 3)  gap = "the other day";
  else if (days <= 14) gap = "last week";
  else if (days <= 35) gap = "a few weeks ago";
  else gap = "a while back";
  if (biz) {
    return [
      `Hi, it's Garrett with Amari Method! I sent over the ${product} link ${gap} and wanted to follow up. If you're wondering whether it's worth it: the trainer comes in, we find exactly what's going on in their body, and if they don't feel real relief I keep working with them until they do — no extra charge. Want to find a time?`,
      `Hi, it's Garrett with Amari Method! Reaching back out about the ${product} link I sent ${gap}. If the cost feels like a risk, I hear you — that's exactly why I stand behind the work: they come in, we find what's causing the problem, and if there's no noticeable relief I keep going at no charge. Worth a quick call?`,
    ];
  }
  return [
    `Hi ${fn}, it's Garrett! I sent you the ${product} link ${gap} and wanted to check in. If you're on the fence about whether it'll work, here's what I want you to know: come in, we figure out what's actually going on with your body, and if you don't feel real relief I keep working with you until you do — no extra charge. That's how confident I am in this.`,
    `Hey ${fn}, Garrett here! Following up on the ${product} link from ${gap}. If the investment feels risky, that's exactly why I guarantee the work: you come in, find out what's causing the pain, and if you don't feel noticeable relief we keep going at no charge. Want to find a time that works?`,
  ];
}

function callScripts(name, days) {
  const biz = isBusiness(name) || isPhone(name);
  const who = biz ? "it's Garrett with Amari Method" : "it's Garrett";
  let gap;
  if (days <= 3)  gap = "I tried you a little while ago but missed you.";
  else if (days <= 14) gap = "I called last week but didn't get to connect.";
  else if (days <= 35) gap = "I reached out a few weeks back — wanted to try again.";
  else gap = "It's been a while — I dropped the ball on following up, sorry about that.";
  if (biz) {
    return [
      `When you reach them: "Hi, ${who}! ${gap} I partner with gyms to help keep members training pain free. I'd love to gift one of your trainers a session so they can feel the work. Do you have 30 seconds?"`,
      `When you reach them: "Hi, ${who}! ${gap} I teach at-home protocols that keep gym members out of pain and training longer. I'd love to gift a session to someone on your team. Who's the best person to reach?"`,
    ];
  }
  return [
    `When you reach them: "Hi ${firstName(name)}, ${who}! ${gap} I'm a body alignment specialist here in SF and I teach at-home protocols that are incredible for low back and joint pain. I'd love to gift you a session so you can feel the work. Do you have 30 seconds?"`,
    `When you reach them: "Hi ${firstName(name)}, ${who}! ${gap} I work with trainers here in SF on keeping their bodies pain free, and I'd love to gift you a session to try it. Got a quick minute?"`,
  ];
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
    const days = Math.round(d.sinceLastTouchDays);
    const untextable = isUntextable(d.lineType);
    const prev = existingTemplated.get(d.contactId);
    const label = isPhone(d.name) ? "this contact" : firstName(d.name);
    let vars, channel, whyNow, bucket;

    const stall = linkStalls.get(d.contactId);
    if (stall) {
      channel = untextable ? "call" : "text";
      vars = untextable ? callScripts(d.name, days) : guaranteeVariations(d.name, stall.product, days);
      whyNow = untextable
        ? `Call ${label} — this is a ${d.lineType} number. You sent the ${stall.product} link ${elapsedPhrase(days)}. If they pick up, lead with the guarantee: come in, find what's causing the pain, no relief = keep working at no charge.`
        : `Text ${label} now. You sent the ${stall.product} link ${elapsedPhrase(days)} and they haven't booked. Lead with the guarantee — come in, find out what's causing the pain, if no noticeable relief keep working at no charge. This is the price-objection play.`;
      bucket = "link-sent";
    } else {
      channel = untextable ? "call" : "text";
      vars = untextable ? callScripts(d.name, days) : variationsFor(d.name, days);
      whyNow = untextable
        ? `Call ${label} — this is a ${d.lineType} number, texts won't reach it. You reached out ${elapsedPhrase(days)} and never connected. Try a call.`
        : `Text ${label} now. You reached out ${elapsedPhrase(days)} and never connected or heard back. Send a time-aware re-attempt.`;
      if (priceFlags.has(d.contactId)) {
        whyNow += ` Heads up: they raised cost or insurance on a call. If it comes up, lead with the relief guarantee. Come in, we find out what's actually causing your pain, and if you don't feel noticeable relief, we keep working until you do, at no extra charge.`;
      }
      bucket = "called-no-connect";
    }

    desired.set(d.contactId, {
      contactId: d.contactId, name: d.name, bucket, channel,
      generatedAt: prev?.generatedAt || today,
      whyNow, message: vars[0], variations: vars,
    });
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
