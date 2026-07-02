// The cold-path angle ladder: what each of the 5 cold-sequence touches SAYS
// (angle), separate from how it's shaped for the channel (rendering). Angle is
// keyed to the cadence engine's step (call→text→call→email→text-breakup);
// rendering is keyed to channel. See ops/drafts/fable-5-review-2026-07-01.md
// and ops/ref/correct-followup-card.md for the source design + guardrails.
//
// Overlays ('link-stall' | 'price-objection') swap a rung's content to
// reference the specific product a contact was sent — they never change which
// step or channel a contact is on.

export const isPhone = (n) => /^\(?\d[\d\s().-]{6,}$/.test((n || "").trim());
export const isBusiness = (n) =>
  /\b(fitness|gym|studio|training|crossfit|pilates|yoga|wellness|club|barre|strength|performance|athletic)\b/i.test(n || "");
export const firstName = (n) => (n || "").trim().split(/\s+/)[0];

// Hedge phrasing only — NEVER assert a call outcome we can't verify ("didn't
// catch you", "no connect"). See correct-followup-card.md: "a trustworthy
// card knows what it doesn't know."
function gapPhrase(days) {
  if (days <= 3) return "I reached out a little while ago.";
  if (days <= 14) return "I reached out about a week ago.";
  if (days <= 35) return "I reached out a few weeks ago.";
  return "It's been a while since I first reached out, and I dropped the ball on following up. Sorry about that.";
}

export function elapsedPhrase(days) {
  if (days <= 3) return "in the last few days";
  if (days <= 14) return "about a week ago";
  if (days <= 35) return "a few weeks ago";
  return "over a month ago";
}

function who(biz) {
  return biz ? "it's Garrett with Amari Method" : "it's Garrett";
}

// Step 1 — identity. No ask beyond permission to text next. The closing line
// must not promise a text to a contact who can't receive one — step 2 also
// becomes a call for untextable numbers (see template.js's untextable
// override), so the promise would be false for exactly the cohort most
// likely to notice.
function renderIdentity(ctx) {
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  const next = ctx.untextable ? "I'll try you again soon with more details." : "I'll send a text next with the details.";
  const script = biz
    ? `Hi, ${who(true)}. I work with gyms here in SF keeping members training pain free, and wanted to introduce myself. ${next}`
    : `Hi ${firstName(ctx.name)}, ${who(false)}. I'm a body alignment specialist here in SF, and wanted to introduce myself. ${next}`;
  return { callScript: [script] };
}

// Step 2 — the gift. Default: the existing blessed gift-a-session copy, with
// the opener's gap phrase hedged (no unverifiable outcome claim). Overlay
// active: same step and channel, guarantee-flavored angle referencing the
// specific product they were sent (migrated from the old guaranteeVariations()).
function renderGift(ctx) {
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  const fn = firstName(ctx.name);
  if (ctx.overlay && ctx.product) {
    const gap = elapsedPhrase(ctx.days);
    return {
      sms: biz
        ? [
            `Hi, it's Garrett with Amari Method! I sent over the ${ctx.product} link ${gap} and wanted to follow up. If you're wondering whether it's worth it: you come in, we find exactly what's going on in the body, and if there's no noticeable relief I keep working until there is, no extra charge. Want to find a time?`,
            `Hi, it's Garrett with Amari Method! Reaching back out about the ${ctx.product} link I sent ${gap}. If the cost feels like a risk, that's exactly why I stand behind the work: you come in, we find what's causing the problem, and if there's no relief I keep going at no charge. Want to find a time?`,
          ]
        : [
            `Hi ${fn}, it's Garrett! I sent you the ${ctx.product} link ${gap} and wanted to check in. If you're on the fence about whether it'll work, here's what I want you to know: we figure out what's actually going on with your body, and if you don't feel real relief I keep working with you until you do, no extra charge.`,
            `Hey ${fn}, Garrett here! Following up on the ${ctx.product} link from ${gap}. If the investment feels risky, that's exactly why I guarantee the work: we find what's causing the pain, and if you don't feel noticeable relief we keep going at no charge. Want to find a time that works?`,
          ],
    };
  }
  const openerLine = biz ? `Hi, ${who(true)}! ${gapPhrase(ctx.days)}` : `Hi ${fn}, ${who(false)}! ${gapPhrase(ctx.days)}`;
  const bodies = biz
    ? [
        "I teach at-home protocols that keep clients out of pain, and I partner with gyms to help keep members training pain free. I'd love to gift one of your trainers a session to feel the work. Who's the best person to talk to about it?",
        "I partner with gyms to keep members healthy and training longer, with a nice incentive for the gym too. I'd love to set up a session for someone on your team to feel the work. Who's the best person to reach about it?",
      ]
    : [
        "I'm a body alignment specialist here in SF and I teach at-home protocols that are amazing for low back and joint pain. I'd love to gift you a session so you can feel the work for yourself. Feel free to call or text whenever's good!",
        "I teach at-home protocols that get rid of low back and joint pain, and I'd love to gift you a session to try them. If you're inspired, we could even talk about partnering. Feel free to call or text when you have time.",
      ];
  // Also provide a purpose-written call script (distinct from the sms text
  // above, not a relabeled copy of it) for when template.js's untextable
  // override forces this text-shaped step onto a call — the sms wording
  // references texting ("feel free to call or text"), which reads as
  // nonsensical if Garrett is reading it aloud to someone he's already on
  // the phone with.
  const callBodies = biz
    ? [
        `When you reach them: "Hi, ${who(true)}! I partner with gyms to help keep members training pain free. I'd love to gift one of your trainers a session so they can feel the work. Do you have 30 seconds?"`,
        `When you reach them: "Hi, ${who(true)}! I teach at-home protocols that keep gym members out of pain and training longer. I'd love to gift a session to someone on your team. Who's the best person to reach?"`,
      ]
    : [
        `When you reach them: "Hi ${fn}, ${who(false)}! I'm a body alignment specialist here in SF and I teach at-home protocols that are incredible for low back and joint pain. I'd love to gift you a session so you can feel the work. Do you have 30 seconds?"`,
        `When you reach them: "Hi ${fn}, ${who(false)}! I work with trainers here in SF on keeping their bodies pain free, and I'd love to gift you a session to try it. Got a quick minute?"`,
      ];
  return { sms: bodies.map((b) => `${openerLine} ${b}`), callScript: callBodies };
}

// Step 3 — the honest why. Names the barter lightly (we partner with
// trainers/gyms, hope they refer) — never pitches partnership mechanics
// (income/percentage/referral fee) in this touch. See correct-followup-card.md.
function renderHonestWhy(ctx) {
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  // Ask must not promise a text to an untextable contact, and "a couple
  // times" is ambiguous (reads as "text you twice" rather than "a couple of
  // time options") — spelled out below regardless of textability.
  const ask = ctx.untextable
    ? "What times usually work for you?"
    : "Can I text you a couple of times that could work for a session?";
  const script = biz
    ? `When you reach them: "Hi again, ${who(true)}. I want to be straight with you about why the session's free: I partner with gyms and trainers, and if people like the work I'm hoping they'll send others my way. No pressure either way. ${ask}"`
    : `When you reach them: "Hi ${firstName(ctx.name)}, ${who(false)} again. I want to be straight with you about why the first session's free: I partner with trainers and gyms, and if you like the work I'm hoping you'll mention me to people you know. No pressure either way. ${ask}"`;
  return { callScript: [script] };
}

// Step 4 — the substance. The guarantee in full, plus what a session looks
// like — this is the one channel with room for it. Default: generic (no
// specific product). Overlay with ctx.product: references the specific link.
function renderSubstance(ctx) {
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  const fn = firstName(ctx.name);
  const product = ctx.overlay && ctx.product ? ctx.product : null;
  const subject = product
    ? `About the ${product} link, and the guarantee`
    : "How the first session works, and the guarantee";
  const guarantee =
    "you come in, we find out what's actually causing the pain, and if you don't feel noticeable relief, we keep working until you do. No extra charge.";
  let body;
  if (biz) {
    body = product
      ? `Hi, it's Garrett with Amari Method. Following up on the ${product} link I sent ${elapsedPhrase(ctx.days)}. If cost is the hesitation, here's my answer to that: ${guarantee} That's the whole guarantee. Want to find a time?`
      : `Hi, it's Garrett with Amari Method. I never properly explained what a session actually looks like: I check what's going on in the body, we work through it together, and ${guarantee} Happy to set up a time for one of your trainers whenever works.`;
  } else {
    body = product
      ? `Hi ${fn}, it's Garrett! Following up on the ${product} link from ${elapsedPhrase(ctx.days)}. If the cost feels like a risk, here's my answer to that: ${guarantee} That's the whole guarantee. Want to find a time?`
      : `Hi ${fn}, it's Garrett! I never properly explained what a session actually looks like: we find what's actually causing the pain, work through it together, and ${guarantee} Happy to find a time whenever's good.`;
  }
  return { email: { subject, body } };
}

// Step 5 — the gentle no. The breakup: door open, no guilt, no re-pitch of
// the earlier gift.
function renderGentleNo(ctx) {
  const fn = firstName(ctx.name);
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  const text = biz
    ? "Hi, it's Garrett. I'll stop reaching out for now. If the timing's ever better for one of your trainers to feel the work, the offer stands whenever."
    : `Hi ${fn}, it's Garrett. I'll stop reaching out for now. Did the timing just not work out? Totally fine either way, the door's open whenever you want to take me up on it.`;
  return { sms: [text] };
}

export const COLD_RUNGS = [
  { step: 1, angle: "identity", angleLabel: "Who I am — no ask beyond permission", channel: "call", render: renderIdentity },
  { step: 2, angle: "gift", angleLabel: "The gift", channel: "text", render: renderGift },
  { step: 3, angle: "honest-why", angleLabel: "The honest why", channel: "call", render: renderHonestWhy },
  { step: 4, angle: "substance", angleLabel: "The substance (the guarantee)", channel: "email", render: renderSubstance },
  { step: 5, angle: "gentle-no", angleLabel: "The gentle no", channel: "text", render: renderGentleNo },
];

// Returns null for 'warm' variant (out of scope) or an out-of-range step —
// callers should fall back to their own default behavior in that case.
export function getRung(variant, step) {
  if (variant !== "cold") return null;
  return COLD_RUNGS.find((r) => r.step === step) || null;
}

export function renderAngle(variant, step, ctx) {
  const rung = getRung(variant, step);
  if (!rung) return null;
  const rendered = rung.render(ctx);
  return {
    angle: rung.angle,
    angleLabel: rung.angleLabel,
    step: rung.step,
    variant,
    channel: rung.channel,
    sms: rendered.sms || null,
    email: rendered.email || null,
    callScript: rendered.callScript || null,
  };
}

// Fallback for contacts outside the cold ladder's scope — currently only
// reachable for a warm-variant contact with a stalled link (template.js's
// "gone-quiet" state only enters its targets filter via LINK_STALL_STATES,
// which requires a stall to be present). Renders the same guarantee-flavored
// angle as the ladder's overlay branch; channel is decided by the caller
// (call for untextable numbers, else text) since this isn't step-indexed.
export function renderGuaranteeFallback(ctx) {
  const biz = isBusiness(ctx.name) || isPhone(ctx.name);
  const fn = firstName(ctx.name);
  const gap = elapsedPhrase(ctx.days);
  return biz
    ? [
        `Hi, it's Garrett with Amari Method! I sent over the ${ctx.product} link ${gap} and wanted to follow up. If you're wondering whether it's worth it: you come in, we find exactly what's going on in the body, and if there's no noticeable relief I keep working until there is, no extra charge. Want to find a time?`,
        `Hi, it's Garrett with Amari Method! Reaching back out about the ${ctx.product} link I sent ${gap}. If the cost feels like a risk, that's exactly why I stand behind the work: you come in, we find what's causing the problem, and if there's no relief I keep going at no charge. Want to find a time?`,
      ]
    : [
        `Hi ${fn}, it's Garrett! I sent you the ${ctx.product} link ${gap} and wanted to check in. If you're on the fence about whether it'll work, here's what I want you to know: we figure out what's actually going on with your body, and if you don't feel real relief I keep working with you until you do, no extra charge.`,
        `Hey ${fn}, Garrett here! Following up on the ${ctx.product} link from ${gap}. If the investment feels risky, that's exactly why I guarantee the work: we find what's causing the pain, and if you don't feel noticeable relief we keep going at no charge. Want to find a time that works?`,
      ];
}
