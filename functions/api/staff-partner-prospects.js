// Cloudflare Pages Function: GET /api/staff-partner-prospects
//
// Returns partner prospects (golf / tennis / trainer) for the Partners tab.
// Reads the 8 partner_* custom fields created 2026-05-23 (see
// TECHNICAL-REFERENCE.txt § "GHL CUSTOM FIELDS (partner outreach)").
//
// Always returns the full universe (no category filtering on the backend);
// frontend filters client-side for instant chip interaction.
//
// Auth: JWT bearer, same pattern as other staff endpoints.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import sheetCache from "../lib/partner-sheet-cache.json";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

// Custom field IDs used by the Partners tab.
// New partner_* fields created 2026-05-23.
// Existing facility fields are in the "Trainer Outreach" group — already in use; we read but don't duplicate.
// See ops/ref/partner-custom-fields-2026-05-22.json for full registry.
const FIELD_IDS = {
  // New (state / signal tracking)
  partner_stage:           "KfPow1mYDxJqiOCS6mDZ",
  partner_source:          "wFYnPOmI6PzllGGuCWvs",
  partner_last_signal:     "XyUoMtbxadTuZunQwX3Y",
  partner_last_signal_at:  "J0lnfsvtt0vcFOdSbUSf",
  partner_followup_at:     "stVYzQB4Xpi29cuyUYnA",
  // Real last-activity date (populated by backfill script — see ops/scripts/...
  // GHL's contact.lastActivity is null for most contacts; this field caches
  // the most recent message date computed from /conversations/search.)
  partner_last_real_activity: "W7JoyJKPKhPI8hZ5EgUv",
  // Touch count — number of outbound outreach actions for this contact.
  // Backfilled from /conversations and incremented on every outcome recorded
  // via /api/staff-partner-outcome. Used in the row card + sort.
  partner_touch_count:        "qKtPT2XZP61emgUDK7fd",
  // LinkedIn profile URL — populated by enrichment scripts (one-off harvest
  // 2026-05-27 + future Sales Nav MCP batches). Displayed as a clickable
  // LinkedIn row in the prospect modal.
  partner_linkedin_url:       "Zea1f8Z43bfkXvhYmcQj",
  // Instagram — TEXT (handle OR full URL). For partners/prospects where we
  // know the IG independent of Garrett's sheet (which only has socialProfile
  // for sheet-tracked contacts). UI normalizes handle/URL → @handle + link.
  partner_instagram:          "4Y2f2SnTMK28kl6kNbPR",
  // Additional URLs surfaced during web enrichment (PGA Coach bio, club
  // page, IG, podcast, etc.). LARGE_TEXT with semicolon-separated values.
  partner_other_urls:         "7KvhcBornVP0k0vT2h68",
  // 1–3 sentence rundown of who this person is — populated by the audit/
  // enrichment pipeline. LARGE_TEXT. Shown in the prospect modal so Garrett
  // can read context without leaving the app.
  partner_rundown:            "Yd3lsw6fAxl0HVCxr1cD",
  // Existing (facility context)
  trainer_facility:        "eYBj61zgMnIFMIesoDR5",
  facility_type:           "gIQEMkO1gV85SAYcYlNx",
  facility_role:           "FGakk9CgiRqeY0tleGQD",
  has_pt_on_staff:         "YWglhoiMeTUPSpHA9322",
  outreach_verified:       "PVftrxrmNRPmfdlQAwzl",
};

// Tags that identify partner contacts. Union across categories + broad tags.
const CATEGORY_TAGS = {
  golf:    ["golf-new-partner"],
  tennis:  ["tennis-new-partner"],
  trainer: ["trainer-new-partner", "trainer-outreach"],
  // Non-sports professionals — business pros, tech, leadership/exec coaches.
  business: ["business-new-partner"],
  // Mental-health / somatic therapists. `mental-health-prospect` is the tag the
  // existing ~50 sourced therapists already carry; `therapist-new-partner` is for
  // future imports via ops/scripts/import-prospects.mjs (Fill the Funnel, 2026-06-13).
  therapist: ["therapist-new-partner", "mental-health-prospect"],
};
// `ambassador-prospect` added 2026-05-23 after migration missed Troy Weakley
// (his only tag was ambassador-prospect, so he was excluded entirely).
const BROAD_PARTNER_TAGS = ["partner-prospect", "affiliate-partner", "ambassador-prospect"];
const ALL_PARTNER_TAGS = [
  ...Object.values(CATEGORY_TAGS).flat(),
  ...BROAD_PARTNER_TAGS,
];

const ALL_STAGES = [
  "no-outreach",
  "working",
  "session-booked",
  "partner",
  "future-potential",
  "dropped",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function deriveCategory(tags) {
  if (!Array.isArray(tags)) return "unknown";
  if (CATEGORY_TAGS.golf.some((t) => tags.includes(t))) return "golf";
  if (CATEGORY_TAGS.tennis.some((t) => tags.includes(t))) return "tennis";
  if (CATEGORY_TAGS.trainer.some((t) => tags.includes(t))) return "trainer";
  if (CATEGORY_TAGS.business.some((t) => tags.includes(t))) return "business";
  if (CATEGORY_TAGS.therapist.some((t) => tags.includes(t))) return "therapist";
  return "unknown";
}

// GHL stores custom fields as an array of {id, value} on the contact.
// Read a single field by ID; returns null if not set.
function getField(contact, fieldId) {
  if (!Array.isArray(contact.customFields)) return null;
  const f = contact.customFields.find((cf) => cf.id === fieldId);
  if (!f) return null;
  const v = f.value ?? f.field_value;
  if (v === "" || v === null || v === undefined) return null;
  return v;
}

// "Outreach Verified" is a CHECKBOX. GHL returns either true, "true", or ["true"].
function isChecked(raw) {
  if (raw === null || raw === undefined) return false;
  if (Array.isArray(raw)) return raw.some((v) => ["true", "yes", "1"].includes(String(v).toLowerCase()));
  return ["true", "yes", "1"].includes(String(raw).toLowerCase());
}

function normalizePhone(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length === 10 && /^[2-9]/.test(d)) return d;
  return null;
}

// ── Act-Now engine (server-side, engine-merge 2026-06-14) ───────────────────
// Faithful port of the staff app's client-side actNowReason, moved here so the
// UI and the coach pipeline read ONE due-decision (no two-engine drift). Same
// constants + urgency tiers + copy as the client. Adds the coach's eligibility
// excludes (booked via calendar, set-aside via coach:skip). Touch-count
// re-weighting is a deliberate LATER step — this is a faithful relocation.
const VM_FOLLOWUP_DAYS = 3, TALKED_FOLLOWUP_DAYS = 1, LINK_FOLLOWUP_DAYS = 3;
const OFFPLATFORM_FOLLOWUP_DAYS = 3, NOANSWER_RETRY_DAYS = 1, QUIET_NUDGE_DAYS = 3;
const LINKEDIN_FOLLOWUP_DAYS = 7;
const END_OF_ROPE_TOUCHES = 6;
function daysSinceDate(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}
function lastTouchAt(p) {
  // Coerce NaN (malformed date string) → null, not just empty. Otherwise a single
  // bad lastActivityAt/partnerLastSignalAt → Math.max(NaN,…) → new Date(NaN)
  // .toISOString() THROWS → the whole prospects request 500s for everyone.
  const ms = (v) => { if (!v) return null; const t = new Date(v).getTime(); return Number.isNaN(t) ? null : t; };
  const a = ms(p.lastActivityAt);
  const b = ms(p.partnerLastSignalAt);
  if (a === null && b === null) return null;
  return new Date(Math.max(a ?? 0, b ?? 0)).toISOString();
}

// A manual outcome (a Follow-Up chip tap, or an app-sent text) writes partner_last_signal_at,
// but the cloud cadence snapshot (coach:cadence:latest) is conversation-derived + up to 3h
// stale and NEVER reads that field — so a just-marked touch (especially an off-platform call
// logged via a chip) leaves the card stuck as "act" until the next cron, or forever for a
// chip the cadence has no conversation record of. GHL stores partner_last_signal_at as a DATE
// (no time), so compare by calendar date: if the manual touch is at least as recent as the
// cadence's own last touch, the cadence is stale for this contact and we trust the live engine.
const FRESH_TOUCH_SIGNALS = new Set(["texted", "emailed", "talked", "voicemail", "link-sent", "no-answer"]);
export function manualTouchIsFresherThanCadence(signal, signalAt, cadenceLastTouch) {
  if (!FRESH_TOUCH_SIGNALS.has(signal) || !signalAt) return false;
  const sigDate = String(signalAt).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sigDate)) return false;
  if (!cadenceLastTouch) return true;
  const cadMs = new Date(cadenceLastTouch).getTime();
  if (Number.isNaN(cadMs)) return true;
  return sigDate >= new Date(cadMs).toISOString().slice(0, 10);
}
function agoLabel(d) { if (d === null) return "never"; if (d <= 0) return "today"; if (d === 1) return "yesterday"; return `${d} days ago`; }

// The leak is FREQUENCY, not timing: ~80% of prospects got one touch then were
// dropped; booked partners averaged ~4 touches vs ~1.3 for the rest. So pull the
// touched-once-and-dropped to the top — they're the recoverable cohort. Never-
// touched (0) gets NO boost on purpose (Garrett over-indexes on fresh first calls);
// 4+ touches = real follow-through, no boost.
function freqBoost(tc) {
  if (tc === 1) return 30;
  if (tc === 2) return 15;
  if (tc === 3) return 6;
  return 0;
}

// Canonical partner_last_signal values the switch below understands. Legacy/variant
// values (underscores, capitalization, e.g. "link_sent", "Talked") would otherwise
// fall through to the default "haven't connected — text them" branch = wrong advice.
// Normalize to canonical, and log anything we still don't recognize so new values surface.
const KNOWN_SIGNALS = new Set([
  "no-answer", "voicemail", "talked", "link-sent", "linkedin-msg",
  "linkedin-req", "instagram-msg", "in-person", "not-interested",
]);
function normalizeSignal(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!KNOWN_SIGNALS.has(s)) console.warn(`[staff-partner-prospects] unknown partner_last_signal: ${JSON.stringify(raw)} (normalized "${s}")`);
  return s;
}

// p = prospect; elig = { hasBooking, skipped } from the coach (KV).
function deriveActNow(p, elig) {
  if (elig?.skipped) return { kind: "aside", urgency: 0, why: "", action: null, asideReason: "Set aside" };
  if (p.isActivePartner || p.partnerStage === "partner" || p.partnerStage === "session-booked" || elig?.hasBooking)
    return { kind: "converted", urgency: 0, why: "Booked — now a client.", action: null };
  if (p.partnerStage === "dropped") return { kind: "aside", urgency: 0, why: "", action: null, asideReason: "Not a fit" };
  if (p.partnerStage === "future-potential") {
    // No follow-up date = still snoozed (NOT due). Defaulting to true here inverted
    // the snooze — a future-potential lead with no date resurfaced at urgency 92 forever.
    const due = p.partnerFollowupAt ? new Date(p.partnerFollowupAt).getTime() <= Date.now() : false;
    return due ? { kind: "act", urgency: 92, warmth: 2, action: "reback", why: "Snoozed lead is back — worth another look." }
               : { kind: "aside", urgency: 0, why: "", action: null, asideReason: "Snoozed" };
  }
  const d = daysSinceDate(lastTouchAt(p));
  const sig = normalizeSignal(p.partnerLastSignal);
  const tc = p.touchCount ?? 0;
  // Warmth tier (engagement): 2=they replied/talked, 1=we reached out one-way, 0=never
  // touched. The UI adds a small bonus so an engaged contact edges out a same-urgency
  // one we only left a voicemail for (the hannah-above-abraham fix).
  if (!sig && tc === 0) return { kind: "act", urgency: 45, warmth: 0, action: "call", why: "New lead — give them a call once you're through your follow-ups." };
  if (tc >= END_OF_ROPE_TOUCHES) return { kind: "act", urgency: 38, warmth: 1, action: "decide", why: `You've reached out ${tc} times with nothing back. Give it one more try, or let it go.` };
  const due = (t) => d === null || d >= t;
  // Touch-count-primary resurfacing (touched-once rises) + a small FRESHEST-FIRST
  // recency tiebreak: within a tier of same-urgency cards, the just-due/warm ones
  // top the pile and the months-cold ones sink. Capped low so it never jumps a tier.
  const fb = freqBoost(tc) + (d == null ? 0 : (60 - Math.min(d, 60)) * 0.1);
  const waiting = (label) => ({ kind: "waiting", urgency: 0, why: label, action: null });
  switch (sig) {
    case "no-answer": return due(NOANSWER_RETRY_DAYS) ? { kind: "act", urgency: 62 + fb, warmth: 1, action: "call", why: `Couldn't reach them last time — try them again today.` } : waiting("Just called — give it a day.");
    case "voicemail": return due(VM_FOLLOWUP_DAYS) ? { kind: "act", urgency: 70 + fb, warmth: 1, action: "text", why: `You called ${agoLabel(d)} and haven't heard back. A text's worth a shot — it's more likely to get seen.` } : waiting("Called — give it a few days.");
    case "talked": return due(TALKED_FOLLOWUP_DAYS) ? { kind: "act", urgency: 76 + fb, warmth: 2, action: "text", why: `You talked ${agoLabel(d)} — text them the next step before it goes cold.` } : waiting("Just talked — give it a day.");
    case "link-sent": return due(LINK_FOLLOWUP_DAYS) ? { kind: "act", urgency: 66 + fb, warmth: 2, action: "text", why: `You sent the link ${agoLabel(d)} and they haven't booked. Text them and check in.` } : waiting("Just sent the link.");
    // LinkedIn RETIRED as a channel (Eben 2026-06-20). These were sourced because the
    // number on file is a facility front desk (a club / studio switchboard), not a cell.
    // We keep the people; we just reach them by phone now: CALL and ask for them by name.
    // Never text a switchboard. Low-ish urgency, no freqBoost (cold connection-request work).
    case "linkedin-req":
    case "linkedin-msg":
      return due(QUIET_NUDGE_DAYS) ? { kind: "act", urgency: 48, warmth: 1, action: "call", why: `Connected on LinkedIn earlier, but we're off LinkedIn now. The number on file is likely the facility's, so call and ask for them by name.` } : waiting("Recently reached out.");
    case "instagram-msg": case "in-person":
      return due(OFFPLATFORM_FOLLOWUP_DAYS) ? { kind: "act", urgency: 55 + fb, warmth: 1, action: "text", why: `You reached out ${agoLabel(d)} — send them a text to follow up.` } : waiting("Just reached out.");
    case "not-interested": return { kind: "aside", urgency: 0, why: "", action: null, asideReason: "Not interested" };
    default: return due(QUIET_NUDGE_DAYS) ? { kind: "act", urgency: 50 + fb, warmth: 1, action: "text", why: `You haven't connected in ${agoLabel(d)} — text them to check in.` } : waiting("Just touched base.");
  }
}

// The conversation engine's verdict for a contact the cadence knows about — the
// SINGLE authority for who's due, how urgent, and on which channel. Used for both
// partner prospects and non-partner leads, so the app and the coach pipeline share
// one brain. deriveActNow is only for never-contacted partners (no cadence record)
// + the partner-stage gates (booked / dropped / snoozed / set-aside).
function cadenceVerdict(c) {
  if (c.state === "drip-only") return { kind: "aside", urgency: 0, why: "", action: null, asideReason: "Email/quiz drip only" };
  const channel = c.channel || "text";            // call / text / email
  // Warmth tier (engagement), so the UI can let someone who actually replied/talked
  // edge out a same-urgency contact we only one-way-touched. 2=engaged, 1=reached
  // out, 0=never touched. A cadence contact has always been touched (min 1).
  const engaged = (Number(c.inCount) || 0) > 0 || c.talkedCall || (Number(c.droppedReplies) || 0) > 0;
  return {
    kind: c.due ? "act" : "waiting",
    due: !!c.due,
    urgency: Number(c.priority) || 0,             // one priority scale (0-127; reply-waiting tops it)
    warmth: engaged ? 2 : 1,
    action: c.due ? channel : null,               // pill fallback + day-weighting (call/text/email)
    why: c.action || "Needs follow-up",           // the cadence's human action sentence
    channel,
    source: "cadence",
  };
}

// ── Phase 1: play-decision finalization (the card-trust fix) ──────────────────
// One pass re-shapes the actionable card from everything we know, so the channel and
// why-line can't contradict (the Amanda failure: "text this coach" → a VoIP front desk).
// Source/confidence-based, NOT the enriched role field (proven unreliable — a coach was
// mislabeled facility_role="Manager"):
//   - A FACILITY contact we have NOT verified and have NOT actually engaged is not a pitch
//     target — we don't know who to reach. → DISCOVERY card: call, find the person. The
//     enriched role/facility is treated as an unverified hint, never a basis to pitch.
//   - A landline/VoIP number never gets a "text" recommendation (it's a switchboard).
export function finalizePlay(p) {
  const d = p.derived;
  // Park trainers who already have a physical therapist on staff — they handle pain
  // in-house, so they're not a referral fit right now. Held for a future campaign
  // (Eben 2026-06-20). Suppress from the worklist (kind→aside); the data + tag stay.
  // Field `has_pt_on_staff` is null/"No"/"Unknown"/"Yes" — only "Yes" suppresses.
  if (d && d.kind === "act" && /^yes$/i.test(p.hasPtOnStaff || "")) {
    return { ...d, kind: "aside", urgency: 0, action: null, why: "",
      asideReason: "Has a physical therapist on staff — parked for a future campaign" };
  }
  if (!d || d.kind !== "act") return d; // leave non-actionable (LinkedIn action retired 2026-06-20)
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const isFacility = tags.includes("trainer-facility") || p.category === "business";
  // "Trusted" = we've actually confirmed WHO to reach. NOT inGarrettSheet (that only
  // means Garrett added the lead — Amanda's in the sheet but she's a coach, wrong
  // person). Counts: an explicit outreach-verified flag, a solo contact (who IS the
  // business), or `dm-verified` — the flywheel tag a discovery call writes once Garrett
  // confirms the decision-maker (staff-partner-verify). That's how discovery → pitch.
  const trusted = !!(p.outreachVerified || tags.includes("trainer-solo") || tags.includes("dm-verified"));
  const engaged = d.warmth === 2; // actually replied/talked → we may already know who to reach
  // A named owner/sole-operator IS the decision-maker — pitch them directly. Don't run a
  // "find who handles partnerships" discovery card on the person who owns the place. The
  // facility tag fires on EVERY owner-operator (their name is the business), so it alone
  // can't mean "decision-maker unknown". Only treat a facility as DM-unknown when there's
  // no named owner to reach: an org-name contact, or a non-owner role (coach/staff/manager).
  const nameStr = (p.fullName || `${p.firstName || ""} ${p.lastName || ""}`).trim();
  const nameToks = nameStr.split(/\s+/).filter(Boolean);
  const firstTok = nameToks[0] || "";
  const ORG_WORDS = /^(the|a|an|fit|fitness|gym|gyms|studio|club|performance|training|strength|crossfit|pilates|yoga|wellness|raise|punch|pure|tribe|local|bar|house|lab|co|sf|llc|inc|method|works|bodyworks|culture)$/i;
  // Does the name read like a business rather than a person? Orgs get stuffed into the name
  // field ("Revel Training Club", "CA Sculpt Pilates", "Advanced Wellness") — reject if any
  // token is an org word or the name is 3+ tokens. This is the real person/business test:
  // the auto role often says "owner" for an org too, so it's the NAME that tells a person we
  // pitch directly from a business we run discovery on to find the actual person.
  const looksLikeOrg = nameToks.some((t) => ORG_WORDS.test(t)) || nameToks.length >= 3;
  const hasPersonFirstName = /^[A-Z][a-z]+$/i.test(firstTok) && !ORG_WORDS.test(firstTok) && !looksLikeOrg;
  const isOwnerRole = /owner|sole|principal|founder/i.test(p.partnerFacilityRole || "");
  // The rundown often already states they run the place ("Michael Crammond runs Whole Body
  // Solutions", "Jae is a co-owner of J+K"). Only trust it when the rundown OPENS with their
  // first name and an ownership verb follows in the same clause — that anchors the ownership
  // to THIS contact, not "Trainer at X, which is owned by someone else" or a business whose
  // name merely starts like a first name ("Alex Fitness ... family-owned").
  const ownerInRundown = hasPersonFirstName && new RegExp(
    "^" + firstTok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\b[^.]{0,60}\\b(owns?|runs?|founded|founder|owner|co-?owner|principal|sole)\\b",
    "i").test((p.rundown || "").trim());
  // Known decision-maker = a named person AND a clear ownership signal. An explicit "Owner"
  // role counts even without a last name (it's their own contact, e.g. "Charlie", "Ramy");
  // otherwise require the rundown ownership statement. Stay conservative: discovery (find the
  // person) is the safe default — a premature pitch to the wrong person is the actual harm.
  const knownDecisionMaker = hasPersonFirstName && (isOwnerRole || ownerInRundown);
  if (isFacility && !trusted && !engaged && !knownDecisionMaker) {
    return { ...d, action: "discovery", channel: "call",
      why: "Facility, unverified contact — call and ask who handles partnerships, then get a name." };
  }
  // Only landline + toll-free are truly untextable. VoIP is NOT suppressed: most
  // personal VoIP (Google Voice, TextNow, MVNO cells routed over VoIP) receives
  // SMS fine, so blanket-suppressing it would stop us texting reachable people.
  if ((d.action === "text" || d.action === "reback") && ["landline", "toll_free"].includes(p.phoneType)) {
    return { ...d, action: "call", channel: "call",
      why: `The number on file is a ${p.phoneType.replace("_", "-")} line, not a cell — call instead.` };
  }
  return d;
}

// Lookup Garrett's sheet row for a contact by phone or email match.
function lookupSheetRow(contact) {
  const phoneNorm = normalizePhone(contact.phone);
  if (phoneNorm && sheetCache.byPhone[phoneNorm]) return sheetCache.byPhone[phoneNorm];
  const emailNorm = contact.email ? contact.email.toLowerCase() : null;
  if (emailNorm && sheetCache.byEmail[emailNorm]) return sheetCache.byEmail[emailNorm];
  return null;
}

function toProspect(contact) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const sheetRow = lookupSheetRow(contact);
  return {
    contactId: contact.id,
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    fullName:
      contact.contactName ||
      [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
      "(no name)",
    category: deriveCategory(tags),
    tags,
    phone: contact.phone || null,
    email: contact.email || null,
    website: contact.website || null,
    companyName: contact.companyName || null,
    address1: contact.address1 || null,
    city: contact.city || null,
    state: contact.state || null,
    postalCode: contact.postalCode || null,
    // Social profile — Garrett's sheet has it under the "instagram" column but
    // the actual values are a mix of IG handles, IG URLs, Facebook URLs, and
    // sometimes business-name text. Frontend formats with formatSocialProfile().
    socialProfile: sheetRow?.instagram || null,
    // LinkedIn URL — separate field because it's discovered via enrichment
    // (notes scan + Sales Nav MCP) rather than the sheet.
    linkedinUrl: getField(contact, FIELD_IDS.partner_linkedin_url),
    // Instagram (handle or URL). Independent of socialProfile (which only
    // exists for sheet-tracked prospects). Use this for partners.
    instagram: getField(contact, FIELD_IDS.partner_instagram),
    // Other URLs surfaced during web enrichment. Stored semicolon-separated
    // in GHL; UI splits and renders each as a clickable link.
    otherUrls: getField(contact, FIELD_IDS.partner_other_urls),
    // Short rundown / description from the audit pipeline.
    rundown: getField(contact, FIELD_IDS.partner_rundown),
    // Prefer the cached real activity date (populated by backfill script from
    // /conversations messages). Falls back to GHL's contact.lastActivity (usually
    // null), and finally to null → "not recorded" in the UI.
    // We deliberately do NOT fall back to dateUpdated — that reflects when our
    // own writes happen (e.g., the migration) and is misleading.
    lastActivityAt:
      getField(contact, FIELD_IDS.partner_last_real_activity) ||
      contact.lastActivity ||
      null,
    isActivePartner: tags.includes("affiliate-partner"),
    // New partner custom fields — null if not yet migrated.
    // Booked is driven off GHL's real signal: the "Partner Session Booked — Add
    // Tag" workflow adds `partner-session-booked` whenever a partner books on the
    // partner calendar (it also creates the appointment). The manual "Booked"
    // outcome button was removed 2026-06-03 because the custom field it set
    // drifted from reality (e.g. Blair was marked booked with no appointment).
    // The tag wins; otherwise fall back to the stored partner_stage.
    partnerStage:         tags.includes("partner-session-booked")
                            ? "session-booked"
                            : getField(contact, FIELD_IDS.partner_stage),
    partnerSource:        getField(contact, FIELD_IDS.partner_source),
    partnerLastSignal:    getField(contact, FIELD_IDS.partner_last_signal),
    partnerLastSignalAt:  getField(contact, FIELD_IDS.partner_last_signal_at),
    partnerFollowupAt:    getField(contact, FIELD_IDS.partner_followup_at),
    // Existing facility / context fields (Trainer Outreach group).
    partnerFacility:      getField(contact, FIELD_IDS.trainer_facility),
    partnerFacilityType:  getField(contact, FIELD_IDS.facility_type),
    partnerFacilityRole:  getField(contact, FIELD_IDS.facility_role),
    hasPtOnStaff:         getField(contact, FIELD_IDS.has_pt_on_staff),
    outreachVerified:     isChecked(getField(contact, FIELD_IDS.outreach_verified)),
    touchCount:           (() => {
      const raw = getField(contact, FIELD_IDS.partner_touch_count);
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    })(),
    // Sheet data joined by phone/email match — primary source for verified contacts.
    sheetStatus:          sheetRow?.status || null,
    sheetNotes:           sheetRow?.notes || null,
    inGarrettSheet:       !!sheetRow,
  };
}

async function fetchByTag(ghlToken, tag, pageLimit = 100) {
  const all = [];
  let pageOffset = 0;
  while (true) {
    const body = {
      locationId: GHL_LOCATION_ID,
      pageLimit,
      page: Math.floor(pageOffset / pageLimit) + 1,
      filters: [{ field: "tags", operator: "contains", value: tag }],
    };
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GHL contacts/search ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < pageLimit) break;
    pageOffset += pageLimit;
    if (pageOffset >= 500) break;
  }
  return all;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers },
      );
    }

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers },
      );
    }
    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Session expired. Please log in again." }),
        { status: 401, headers },
      );
    }
    if (tokenPayload.role !== "staff") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers },
      );
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(
        JSON.stringify({ error: "GHL not configured" }),
        { status: 500, headers },
      );
    }

    // Read the partner-activity-refresh Worker's lastRun summary from KV.
    // Used to surface a "cache age" indicator in the staff app so a silently-failed
    // refresh job becomes visible within days rather than weeks.
    let activityRefreshLastRun = null;
    try {
      if (context.env.PORTAL_KV) {
        const raw = await context.env.PORTAL_KV.get("ops:activity-refresh:lastRun");
        if (raw) activityRefreshLastRun = JSON.parse(raw);
      }
    } catch (err) {
      // Non-fatal — if KV read fails the UI just shows "unknown freshness"
      console.error("[staff-partner-prospects] KV read failed:", err);
    }

    // Fetch contacts for every partner tag in parallel, then dedupe by id.
    const tagResults = await Promise.all(
      ALL_PARTNER_TAGS.map((tag) => fetchByTag(ghlToken, tag)),
    );
    const byId = new Map();
    for (const list of tagResults) {
      for (const c of list) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
    const prospects = Array.from(byId.values()).map(toProspect);

    // Engine-merge: compute the Act-Now decision SERVER-SIDE so the UI and the
    // coach pipeline read one due-decision. Fold in the coach's eligibility
    // excludes (booked via calendar, set-aside via coach:skip) from KV.
    let cadenceMap = new Map();
    let skipSet = new Set();
    let lineTypeMap = new Map(); // contactId -> "mobile" | "landline" | "voip" | "toll_free" | ...
    let coachDataAt = null; // freshness stamp: when the coach worker last refreshed eligibility
    try {
      if (context.env.PORTAL_KV) {
        const cad = await context.env.PORTAL_KV.get("coach:cadence:latest", "json");
        if (cad?.prospects) for (const c of cad.prospects) cadenceMap.set(c.contactId, c);
        coachDataAt = cad?.generatedAtISO || cad?.generatedAt || null;
        const sk = await context.env.PORTAL_KV.get("coach:skip", "json");
        if (sk && typeof sk === "object") skipSet = new Set(Object.keys(sk));
        // Phone line type from the AbstractAPI sweep (classify-line-type.mjs) — lets the
        // UI suppress SMS to landline/toll-free numbers (switchboards that can't text).
        const lt = await context.env.PORTAL_KV.get("contact:linetype", "json");
        if (lt && typeof lt === "object") for (const [id, rec] of Object.entries(lt)) lineTypeMap.set(id, rec?.type || null);
      }
    } catch (err) {
      console.error("[staff-partner-prospects] coach KV read failed (derive falls back to no-elig):", err);
    }
    for (const p of prospects) {
      const c = cadenceMap.get(p.contactId);
      const skipped = skipSet.has(p.contactId);
      // ONE engine: partner-stage gates (booked / dropped / snoozed / set-aside) and
      // never-contacted partners go through deriveActNow; every conversation-active
      // contact the cadence knows uses the cadence verdict (its due-decision, priority
      // rank, and channel) — so the worklist and the coach pipeline share one brain.
      const stageGated = skipped
        || p.isActivePartner
        || p.partnerStage === "partner" || p.partnerStage === "session-booked"
        || p.partnerStage === "dropped" || p.partnerStage === "future-potential"
        || !!c?.hasBooking;
      // If a manual touch (chip / app-send) is fresher than the cadence's last known touch,
      // the 3h-stale conversation-derived cadence hasn't accounted for it — fall back to the
      // live engine so a just-marked contact actually parks in "waiting" (and stays parked on
      // reload), instead of staying stuck as "act".
      const freshTouch = manualTouchIsFresherThanCadence(p.partnerLastSignal, p.partnerLastSignalAt, c?.lastTouch);
      p.derived = (c && !stageGated && !freshTouch)
        ? cadenceVerdict(c)
        : deriveActNow(p, { hasBooking: c?.hasBooking, skipped });
    }

    // Follow-Up = EVERYONE who needs follow-up, not just partner-tagged (Eben 2026-06-15:
    // "every person, every rabbit or oak tree that needs follow-up lives in followup").
    // Union in the cadence engine's conversation-active contacts who AREN'T partner-tagged —
    // i.e. client leads with an open thread (e.g. Wendy, who verbally agreed to $225, stalled
    // on price, and was invisible because she has no partner tag). Their verdict comes straight
    // from the cadence (conversation-cache-derived), since they have no partner signal fields.
    // This also reconnects the cadence engine to the app (they had been two separate systems).
    for (const [cid, c] of cadenceMap) {
      if (!cid || byId.has(cid) || skipSet.has(cid)) continue;       // partner / explicitly set aside
      if (c.hasBooking) continue;                                    // already booked → not a target
      if (["drip-only", "set-aside", "skipped", "booked"].includes(c.state)) continue;
      const lastIso = c.lastTouch ? new Date(c.lastTouch).toISOString() : null;
      prospects.push({
        contactId: cid, firstName: "", lastName: "", fullName: c.name || "(no name)",
        category: "client", tags: [],
        phone: null, email: null, website: null, companyName: null,
        address1: null, city: null, state: null, postalCode: null,
        socialProfile: null, linkedinUrl: null, instagram: null, otherUrls: null, rundown: null,
        lastActivityAt: lastIso, isActivePartner: false,
        partnerStage: null, partnerSource: null,
        partnerLastSignal: null, partnerLastSignalAt: lastIso, partnerFollowupAt: null,
        partnerFacility: null, partnerFacilityType: null, partnerFacilityRole: null,
        hasPtOnStaff: null, outreachVerified: false,
        touchCount: Number(c.outCount) || 0,
        sheetStatus: null, sheetNotes: null, inGarrettSheet: false,
        isLead: true,
        // Same single cadence verdict as conversation-active partners (one brain).
        derived: cadenceVerdict(c),
      });
    }

    // Attach phone line type (from the line-type sweep) to every prospect — partner
    // and unioned lead alike — so the UI can suppress SMS to landline/toll-free numbers.
    for (const p of prospects) p.phoneType = lineTypeMap.get(p.contactId) || null;

    // Phase 1 play-decision: re-shape each actionable card so its channel + why agree
    // (discovery for unverified facility contacts; call instead of text to switchboards).
    for (const p of prospects) p.derived = finalizePlay(p);

    // Counts.
    // A contact counts as "verified / ready to call" if either:
    //   (a) Outreach Verified checkbox is true (manual confirm), OR
    //   (b) the contact is in Garrett's SF Personal Trainers sheet
    //       (sheet inclusion = his curation, the whole point of joining the sheet).
    // This matches the user intent: "view this is confirmed enriched data good to call".
    const countsByCategory = { golf: 0, tennis: 0, trainer: 0, business: 0, therapist: 0, unknown: 0 };
    const countsByStage = Object.fromEntries(ALL_STAGES.map((s) => [s, 0]));
    let verifiedCount = 0;
    let unverifiedCount = 0;
    for (const p of prospects) {
      countsByCategory[p.category] = (countsByCategory[p.category] || 0) + 1;
      const stage = p.partnerStage || "no-outreach";
      countsByStage[stage] = (countsByStage[stage] || 0) + 1;
      const isReady = p.outreachVerified || p.inGarrettSheet;
      if (isReady) verifiedCount += 1;
      else unverifiedCount += 1;
    }

    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        sheetCachedAt: sheetCache.generatedAt,
        // Last time the partner-activity-refresh Worker ran successfully
        // (writes partner_last_real_activity from /conversations). null if KV is
        // empty (worker never run) or unreadable.
        activityRefreshAt: activityRefreshLastRun?.finishedAt || null,
        activityRefreshStatus: activityRefreshLastRun?.status || null,
        // Freshness stamp: when the coach worker last refreshed the eligibility
        // (booked/skip) overlay. The UI shows a loud banner if this goes stale, so
        // a silently-stalled pipeline becomes visible instead of plausible-looking.
        coachDataAt,
        total: prospects.length,
        verifiedCount,
        unverifiedCount,
        countsByCategory,
        countsByStage,
        prospects,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-partner-prospects] failed:", detail);
    return new Response(
      JSON.stringify({
        error: `Failed to load partner prospects: ${detail}`,
        detail,
      }),
      { status: 500, headers },
    );
  }
}
