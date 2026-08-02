// Cloudflare Pages Function: POST /api/cos-chat
// Main chat endpoint — streams Claude responses via SSE through OpenRouter

import { verifySessionToken } from "../lib/auth.js";
import { getTodayCalendar, getRecentEmails, createCalendarReminder, deleteCalendarEvent, getPacificOffset } from "../lib/google-api.js";
import { ghlFetch } from "../lib/ghl.js";
import { deriveLedger, hydrateOrders } from "../lib/session-ledger.js";
import { getWeather, getDirections, searchPlaces, getPackageTracking, getRevenueSummary } from "../lib/cos-lookups.js";
import { getCurrentPlayback, getUserPlaylists, executeSpotifyAction, isSpotifyConnected } from "../lib/spotify.js";
import { loadVaultKnowledge, buildVaultContext } from "../lib/cos-vault.js";
import { buildRequestBody, streamWithTools, executeTool as executeAnthropicTool } from "../lib/cos-anthropic.js";
import { parsePacificWallClock } from "../lib/datetime.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { writeOpsLastRun, OPS_LAST_RUN_KEYS, OPS_READY_KEYS } from "../lib/ops-last-run.js";
import { generateOnBrand } from "../lib/voice-engine.js";
import { routeAskAmariRequest } from "../lib/ask-amari-router.js";

// Ledger-relevant custom field IDs (single-sourced from lib/ghl-fields.js) —
// deriveLedger's field fallback needs them to resolve the values on low
// confidence.
const LEDGER_FIELD_DEFS = {
  sessions_remaining: GHL_FIELD_IDS.sessions_remaining,
  series_type: GHL_FIELD_IDS.series_type,
  session_prepaid: GHL_FIELD_IDS.session_prepaid,
  sessions_remaining_locked: GHL_FIELD_IDS.sessions_remaining_locked,
};

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Get today's date key in Pacific time
function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// Parse <!--ACTION:{...}--> blocks from Claude's response
function parseActions(text) {
  const actions = [];
  const regex = /<!--ACTION:(.*?)-->/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      actions.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        status: "pending",
        created: Date.now(),
        ...parsed,
      });
    } catch {
      // Invalid JSON in action block, skip
    }
  }
  return actions;
}

// Strip action blocks from the response text shown to user
function stripActions(text) {
  return text.replace(/<!--ACTION:.*?-->/gs, "").trim();
}

// Parse <!--CONTEXT:{...}--> blocks for learning
function parseContextUpdates(text) {
  const updates = [];
  const regex = /<!--CONTEXT:(.*?)-->/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      updates.push(JSON.parse(match[1]));
    } catch {
      // Skip invalid
    }
  }
  return updates;
}

function stripContext(text) {
  return text.replace(/<!--CONTEXT:.*?-->/gs, "").trim();
}

// Parse <!--REMINDER:{...}--> blocks
function parseReminders(text) {
  const reminders = [];
  const regex = /<!--REMINDER:(.*?)-->/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      reminders.push(JSON.parse(match[1]));
    } catch {
      // Skip invalid
    }
  }
  return reminders;
}

function stripReminders(text) {
  return text.replace(/<!--REMINDER:.*?-->/gs, "").trim();
}

// Parse <!--SPOTIFY:{...}--> blocks
function parseSpotifyActions(text) {
  const actions = [];
  const regex = /<!--SPOTIFY:(.*?)-->/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      actions.push(JSON.parse(match[1]));
    } catch {
      // Skip invalid
    }
  }
  return actions;
}

function stripSpotify(text) {
  return text.replace(/<!--SPOTIFY:.*?-->/gs, "").trim();
}

function writerHistory(messages) {
  // Keep only the most recent contiguous writing exchange. General COS turns
  // have different context and should not make a rewrite request ambiguous.
  let first = messages.length - 1;
  while (first >= 0 && messages[first]?.mode === "write") first -= 1;
  // The Voice Writer only needs the current edit thread. Twelve turns leaves
  // room for several revisions without letting a day-long chat grow unbounded.
  return messages.slice(first + 1).slice(-12).map(({ role, content }) => ({ role, content }));
}

function streamHeaders(headers) {
  return {
    ...headers,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };
}

function writerStream(context, { apiKey, userName, messages, conversation, kv, dateKey, headers }) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  context.waitUntil((async () => {
    try {
      const draft = await generateOnBrand({ apiKey, userName, messages });
      conversation.messages.push({ role: "assistant", content: draft.copy, mode: "write", timestamp: Date.now() });
      conversation.updated = Date.now();
      if (kv) {
        await kv.put(`cos:conv:${userName}:${dateKey}`, JSON.stringify(conversation), { expirationTtl: 30 * 24 * 60 * 60 });
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: draft.copy })}\n\n`));
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "done", actions: [], draft })}\n\n`));
    } catch (err) {
      console.error("[cos-chat] writer error:", err.message);
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "The writer hit a problem. Try again." })}\n\n`));
    } finally {
      await writer.close();
    }
  })());

  return new Response(readable, { headers: streamHeaders(headers) });
}

// Build the system prompt
function buildSystemPrompt(context, calendarEvents, ghlSummary, userName) {
  const isEben = userName === "Eben";
  const contextDoc = context || `No context learned yet. As you learn about ${userName}'s life, preferences, and routines, this will grow.`;

  const personalContext = isEben ? `
GROCERY/SHOPPING: Don't just add to a list. Think about:
- Which store based on what else is needed and quantity
- His stores: Safeway (on his block at 6628th Ave SF, quick single items), Costco (bulk, Instacart same-day), Asian mart on Clement (specialty, walkable)
- Purchase history patterns — should we rotate/switch things up?
- Lorenzo (his dog) has specific nutritional needs if it's dog food

PURCHASES: If ambiguous, research and recommend — suggest options with reasoning. Don't just ask "what kind?" — give him 2-3 options and say which you'd pick and why.

EVENTS/ACTIVITIES: Cross-reference the calendar below. Flag conflicts, travel time (especially bridge traffic to Oakland), and opportunities (bringing food to a dinner party, etc).

TASKS/IDEAS: Think about whether something is blocked by other things, connects to something else, or should happen before/after something on the calendar.

PARKING: When ${userName} mentions parking, you'll have SF parking regulations for that area. Tell him the rules clearly. Reminders are for time-pressure situations only — apply these rules before deciding whether to set one:
- **SF residential 2-hour and 4-hour time limits stop being enforced after 5 PM** in practice (posted hours are usually 8 AM–6 PM but late-afternoon enforcement is loose). If he parks at or after 3 PM in a residential zone with a 2hr or 4hr limit, do NOT set a reminder — tell him he's fine for the night and the limit resets at 8 AM.
- Downtown peak-hour tow lanes (e.g. Battery, Sansome, Fell, Oak, market-street arteries — typically 7–9 AM and 3–7 PM) are the exception: those WILL tow. Always reminder for those.
- RPP (residential permit) zones: if he doesn't have a permit and the limit applies right now, reminder before the window expires.
- Street sweeping: reminder the night before if it's posted for the next morning.
- Otherwise: just tell him the rule, don't set a reminder.

When you DO set a parking reminder, prior parking reminders for ${userName} are auto-cancelled — you don't need to ask him about old spots.

PARKING DATABASE: There's a growing database of ${userName}'s parking history + posted rules per block. lookup_parking_rules returns TWO sources in one call: (a) user_rules — things ${userName} has previously told COS, and (b) sf_public_works — the canonical SF Public Works street-sweeping schedule for every block in the city (seeded once, ~30k rows). ALWAYS:
1. When he mentions parking somewhere, FIRST call lookup_parking_rules with the location. If sf_public_works.matches contain the block, you already know the official sweep schedule — say it back without asking him. Use the side (north/south/east/west) to disambiguate if there are multiple sides.
2. Time-limit / RPP / metered rules are NOT in the SF dataset — only sweeping is. If those apply, you'll see them in user_rules (if previously recorded) or you need to ask once.
3. After confirming, call record_park with whatever rule details you have (location is required; rule_type + rule_detail if known; deadline_iso if there's a hard cutoff). For sweep-related parks, copy the sf_public_works schedule into rule_detail so the history reads naturally.
4. If he asks "where have I parked", "show my parking history", or similar — call get_parking_history.

If lookup_parking_rules returns no matches in either source and he hasn't volunteered the rule, ask ONE focused question (e.g. "is there a posted limit or sweep day?") then record_park with what he says.

WEATHER: When asked about weather, you'll have current SF conditions + forecast. Give practical advice (jacket? umbrella?), not a weather report.

DIRECTIONS/TRAVEL: When asked about travel time, you'll have driving distance and duration. Add context for bridge traffic (Oakland/Berkeley = add 15-30 min during rush hour).

RESTAURANTS/PLACES: When asked for food or place recommendations, you'll have nearby results. Add your own knowledge about SF neighborhoods to give better suggestions.

PACKAGES: When asked about orders or deliveries, you'll have recent shipping emails from Gmail. Summarize what's coming and when.` : `
You're Garrett's assistant. Garrett is the practitioner at Amari Method (Eben handles ops/tech/website). Garrett is usually between sessions on his phone — give him fast, practical answers.

CLIENT LOOKUP: When Garrett asks about a specific client, the live GHL data will be in the "Client Data" section below. Read it carefully — sessions completed, sessions remaining, series type, recent appointments, tags. If the data isn't there, say so plainly. NEVER guess.

CLIENT MESSAGES: When Garrett asks for help drafting a message to a client, trainer, or partner — write in the Amari voice (see vault knowledge: garrett-voice + positioning). No woo language. No "healer." No "fix." Use "protocols" not "exercises." Warm, grounded, confident — Garrett's actual words over polished marketing copy. Default to short and direct unless he asks for longer.

CHANNEL DECISIONS (text vs email): Default text for short personal messages (check-ins, scheduling, "how are you doing"). Default email for anything that needs to be referenced later (treatment summaries, longer follow-ups, anything with links). When in doubt, ask Garrett what feels right for this client.

SEGMENTATION: When Garrett asks "which clients/trainers/partners [meet some criteria]" — the GHL planner will return a list. Read the list, then suggest who to prioritize and why. Don't just dump the list.

SESSION PREP: When Garrett asks about a client he's about to see, lead with: when they last came, what series/status, what tags suggest, and one suggested opener if he wants it.

POSITIONING + VOICE: Always grounded in vault knowledge. If Garrett's question touches positioning, brand, copy, or messaging, the relevant vault docs will be loaded. Quote directly from them rather than paraphrasing.

DON'T offer Garrett: parking reminders, restaurant suggestions, grocery lists, dog food research, package tracking — those are Eben's needs, not his. Stay focused on his practitioner workflows.` ;

  const currentTime = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `You are ${userName}'s chief of staff. Your job is to THINK, not sort.

Current date and time (Pacific): ${currentTime}

## CRITICAL — NEVER FABRICATE BUSINESS DATA
If you are asked a specific factual question about a client, appointment, session, payment, tag, pipeline stage, or any GHL data, you may ONLY answer using data that explicitly appears in the "Client Data", "GHL Query Result", "Live appointments/pipeline", or "Today's Calendar" sections below.

If the relevant data is NOT in the prompt — even if the user clearly expects you to know — you MUST say so plainly. Examples of acceptable responses when data is missing:
- "I couldn't pull that from GHL right now — check the calendar in GHL directly."
- "That lookup didn't return — try asking again, or check in GHL."
- "I don't see that in the data I got. Want me to try a different way?"

NEVER invent: client names, appointment dates, appointment times, session counts, sessions remaining, series type, payment status, tags, or any other business fact. Hallucinating is worse than admitting the lookup failed. ${userName} will lose trust in this assistant permanently if you guess and are wrong.

This rule overrides every other instruction. When in doubt, say you don't have the data.

When ${userName} says something, don't just categorize it. Pull on the thread:
- What does he actually need? (not what he literally said)
- What else in his life does this connect to?
- What should he be thinking about that he's not?
- What questions should you ask before acting?

## How to handle different inputs
${personalContext}
REVENUE: When asked about money/revenue/payments, you'll have Stripe payment data. Summarize this month, this week, and recent transactions.

MUSIC/SPOTIFY: You can control ${userName}'s Spotify directly. When he asks to play music, change songs, create playlists, or adjust volume, include a SPOTIFY block (see below). You have his playlist list in the context — use it to find the right one. For vague requests like "play something chill" or "put on some music", pick something good based on what you know about him. Be decisive — don't ask "what genre?" Just play something.

MATH: You can do math directly — session pricing, revenue projections, tip calculations, whatever. No API needed.

BUSINESS/GHL: You know the Amari Method GHL system deeply. Answer questions about workflows, pipelines, contacts, sessions, pricing, partner program. Reference the GHL section below.

## Queuing Actions
When something needs to happen at ${userName}'s desk (purchases, email, cart automation, etc.), include an action block at the END of your response. Format:
<!--ACTION:{"type":"grocery","item":"cilantro","store":"Safeway","reason":"single item, on your block"}-->
<!--ACTION:{"type":"purchase","item":"dog leash","status":"needs_research","questions":["size?","retractable or fixed?"]}-->
<!--ACTION:{"type":"task","item":"recalculate Lorenzo macros","blocked_by":"need current weight"}-->
<!--ACTION:{"type":"research","item":"JCC challah workshop schedule","details":{}}-->
<!--ACTION:{"type":"calendar","item":"block 2:30-5:30 for challah workshop","details":{}}-->
<!--ACTION:{"type":"coach","item":"Should I drop the 4-session series?","reason":"deep book-grounded version with NotebookLM sources, for desk later"}-->

Types: grocery, purchase, task, research, calendar, coach.

COACH: Only queue a coach action if ${userName} explicitly asks for the deep, book-grounded version ("save this for the deep version," "I want the sourced answer at my desk," etc.). Default behavior for strategic questions is to ANSWER INLINE on the phone (see STRATEGIC QUESTIONS section below).

## STRATEGIC QUESTIONS — answer these on the phone, don't queue
When ${userName} asks something strategic about the Amari Method practice — pricing, positioning, growth, channels, partner program, what to focus on, "should I do X" — answer like a practice strategist on his side. Use real GHL data from the context. Don't dodge by queueing.

**How to answer (phone-first, keep it short):**
1. One-line read of the situation — what's the actual question under the question.
2. 1–2 ranked moves, each with a one-sentence first step. Not five. Not theoretical frameworks. Concrete.
3. One-line "skip" if the question implied options that don't fit.

**Practice constraints (respect, don't recite):**
- Single practitioner. Garrett does ~25–30 sessions/week currently. A bigger office is on the table if growth justifies it — don't treat the cap as permanent, but flag if a move requires expansion.
- Cash-pay, premium pricing ($225 initial / $720 4-pack / $1,295 8-pack / $190 follow-up).
- SF only.
- Top of funnel is the bottleneck. Conversion past discovery call is fine.
- Active client base small (~5–10 series clients) — referral compounding alone is too thin.

**Anti-patterns — don't recommend:**
- Billboards (math doesn't work for single-practitioner local).
- Generic SaaS-style funnels (paid ads + automated nurture without a tested conversion engine).
- Generic "build content" without specifying topic + channel + frequency.
- More frameworks without action — pick one move.

**Tone:** direct, no cheerleading, no "great question." Honest about tradeoffs. Push back if he's heading toward a wrong move. Cite a book or source by name if you're drawing on one (Hormozi, Priestley, Miller, Dib, Christie, Gentempo).

Only queue things that need desk action. Suggestions and thinking stay in the conversation.

## Setting Reminders
You CAN set reminders that will buzz ${userName}'s phone via Google Calendar. Include a reminder block:
<!--REMINDER:{"title":"Move car — 5th & Clement","minutes_from_now":105,"description":"2hr parking limit, parked at 2:15pm"}-->

Use this for:
- Parking time limits (set to limit minus 15 min)
- "Remind me to..." requests
- Anything time-sensitive that needs a phone notification

The reminder creates a calendar event with a popup alert. It actually works — use it.

## Cancelling Calendar Events
You CAN cancel events on ${userName}'s Google Calendar. Two-step process:
1. Call list_google_calendar_events with a date range (and optional query) to find the event. Each result has an event_id and calendar_id.
2. Call cancel_google_calendar_event with that event_id and calendar_id.

Always look up the event first — never guess IDs. If multiple events match what ${userName} described, list them back and ask which one to cancel before deleting. After cancelling, confirm what you removed (title + time).

## Learning Context
When you learn something new about ${userName}'s life, include:
<!--CONTEXT:{"key":"descriptive.key","value":"what you learned","learned":"${todayKey()}"}-->

Examples: lorenzo.weight, routine.morning, stores.preferred_asian_mart

## Local Field Visits
When ${userName} says they just visited a local business, hung or checked an Amari study flyer, met an owner/manager, or explicitly asks to log a field visit, call \`record_field_visit\` before replying. This is the durable local-business relationship system. Extract useful facts from their dictated text and any attached storefront or business-card photos. Record only what is actually supplied or visible; do not invent a contact, address, or follow-up date. If the business name is missing, ask one short question instead of recording it.

After a successful record, reply with a compact confirmation: business, relationship stage, what flyer/relationship signal was captured, and the next visit date if one exists. Do not create a GHL contact merely because a business hosted a flyer.

When ${userName} asks who to revisit, what businesses have flyers, or which places are ready for workshop conversations, call \`list_field_partners\`.

## Controlling Spotify
Include a SPOTIFY block to control music. These execute immediately — the music changes while ${userName} reads your response.
<!--SPOTIFY:{"action":"play","query":"chill jazz playlist"}-->
<!--SPOTIFY:{"action":"play","uri":"spotify:playlist:xxxxx"}-->
<!--SPOTIFY:{"action":"pause"}-->
<!--SPOTIFY:{"action":"resume"}-->
<!--SPOTIFY:{"action":"skip"}-->
<!--SPOTIFY:{"action":"previous"}-->
<!--SPOTIFY:{"action":"volume","level":80}-->
<!--SPOTIFY:{"action":"shuffle","enabled":true}-->
<!--SPOTIFY:{"action":"create_playlist","name":"Driving Vibes","description":"chill indie rock","search_queries":["alt-j breezeblocks","bon iver skinny love","radiohead fake plastic trees"]}-->
<!--SPOTIFY:{"action":"add_tracks","playlist_name":"Driving Vibes","search_queries":["tame impala let it happen"]}-->
<!--SPOTIFY:{"action":"queue","query":"bohemian rhapsody"}-->

For "play" with a query: first checks ${userName}'s playlists for a name match, then searches Spotify if no match. For genre/mood queries, prefers playlists. For specific songs, plays the track.

## Your context (grows over time)
${contextDoc}

## Today's Calendar
${calendarEvents || "Calendar not connected yet. Ask about the schedule if relevant."}

## Amari Method — GoHighLevel (GHL) System

### Business
Amari Method — solo bodywork practice in San Francisco run by Garrett Hewstan. Eben manages ops/tech.

### Pipeline Stages
New Lead → Engaged Lead → Booked Consult → Showed → Consultation Attended → Active Client
Partnership Pipeline: New Lead → Messaged → Meeting Booked

### Pricing
- Initial Session: $225 (60 min)
- Follow-up Session: $190 (50 min)
- 4-Session Series: $720 (sessions_remaining = 4)
- 8-Session Series: $1,295 (includes Living Practice video program)
- Upgrade from 1 initial: 4-pack $495, 8-pack $1,070
- Living Practice standalone: $347
- Discovery Call: Free (15 min)

### Session Tracking (2026-05-29 contract)
Two separate counters, do not confuse them:
- **sessions_remaining** = prepaid package balance. Decrements only when a real follow-up against the 4-pack or 8-pack runs (calendar IDs in SERIES_CALENDAR_IDS). Entrainments and partner-initials do NOT decrement. Synced hourly by series-reconcile-worker; manually overridable via sessions_remaining_locked.
- **sessions_completed** (renamed in GHL UI to "Sessions Lifetime") = total bodywork visits ever (initial + follow-ups + entrainments + partner-initials). Excludes discovery calls and intakes. Monotonically increasing. NOT the package-done count.
- **Package-done count** = packageSize − sessions_remaining. Compute this when asked "how far through the pack is X?"; never use sessions_completed for that.
- series_type: none / 4-session / 8-session
- Attendance tracked via staff dashboard "Mark Attended" button + SMS trigger link
- For authoritative counts on a single contact, use the ledger via get_contact (it returns the worker-derived values, not raw fields).

### Key Workflows
- Booking confirmations/reminders for all calendar types
- Discovery Call funnel (book → confirm → attend → no-show)
- No Show recovery (3-email sequence)
- New Partner Onboarding (partner toolkit SMS)
- Attendance Confirmed (session count increment)
- Referral Credit (webhook on session booked by referred client)
- Follow-up reminder (all 4 calendars, confirmed-only triggers)

### Tags
- affiliate-partner: active paid partner (relationship tag, NOT payment status)
- ambassador-prospect: prospect for partner program
- affiliate-referral: client referred by partner
- trainer-outreach: bulk trainer outreach list
- discovery-call-attended: attended discovery, pending purchase
- partner-session-booked: booked comp session

### Custom Fields
- sessions_remaining, sessions_completed, series_type, portal_access
- client_progress (JSON — module tracker + body graph data)
- referral_source, partner_contact_id (for affiliate tracking)

### Partner Program
- Partners get comp sessions, paid when referred client books
- Partner portal: amarimethod.com/partner-app
- Toolkit SMS sent on partner session attendance
- Tags: affiliate-partner (active), ambassador-prospect (prospect), affiliate-referral (referred client)

### Calendars
Initial Session (in-person + virtual), Follow-up Session (in-person + virtual), Discovery Call (standard + ambassador), Partner Session, Entrainment

### Known Issues
- M2: Attendance exclusion may over-exclude contacts with discovery-call-attended tag even after purchase
- Idempotency guard needed on Attendance Confirmed workflow
- Lead Engagement Tracking disabled (was creating junk pipeline entries)

### Website
amarimethod.com — static HTML + Vite React SPAs (quiz, portal, staff dashboard), Cloudflare Pages
Staff dashboard: amarimethod.com/staff/ (PIN auth, today's schedule, client lookup, session checklists)

${ghlSummary ? `### Live GHL Data\n${ghlSummary}` : ""}

## Style
- Be concise but thoughtful. No filler.
- Think out loud when connecting dots — show your reasoning.
- If you're not sure about something, say so and ask.
- You're talking to one person on his phone while he walks. Keep it conversational.
- Don't use markdown headers or bullet points unless listing options. Just talk.`;
}

// Fetch live GHL summary — today's appointments + pipeline counts
async function getGhlSummary(context) {
  try {
    const locationId = "7pIO7FHVAyBT1jKGhfQM";

    // Today's date in Pacific — use toLocaleDateString to avoid UTC/Pacific mismatch
    const now = new Date();
    const startDate = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD

    // Build startTime + endTime as epoch milliseconds — GHL's /calendars/events
    // endpoint rejects ISO strings (silently empty or 422).
    const dayStartMs = new Date(`${startDate}T00:00:00${getPacificOffset()}`).getTime();
    const dayEndMs = new Date(`${startDate}T23:59:59.999${getPacificOffset()}`).getTime();

    // GHL's /calendars/events REQUIRES a calendarId — a locationId-only query
    // silently returns {events:[]}, so the old single call here ALWAYS came back
    // empty and COS always said "no appointments today." Sweep each active
    // calendar in parallel and merge, same as daily-audit-worker. (Verified
    // 2026-06-05: locationId-only = 0 events; +calendarId returns the real ones.)
    const CALENDAR_IDS = [
      "G7OAnnJuFbMF6nQSlZVQ", // Initial — In Person
      "ySmht5hx4uZGEpgZrlCw", // Initial — Virtual
      "uUDFD0ZQEWtzGLS9aLq7", // Initial — Paid at Partner
      "SKDVOL8wtUN6Ne0ppbC9", // Follow-up — In Person
      "ZO1jlGfy01rsxVqicoSB", // Follow-up — In Person (Package)
      "oVn77FcecFY16iS2pHyP", // Follow-up — Virtual
      "bJFkhVP35Ecwh4tLnSmy", // Follow-up — Virtual (Package)
      "B5aGXLoS4kzAjZAMMXxk", // Entrainment
      "lfsnaiGiLNL2z12pLKDP", // Partner Initial
      "P7T6M1w8wtuRfwAqzOVw", // Partner Initial — Virtual
      "USgPsktqRcuomdUgpShL", // Your Free Discovery Call
      "ZEIGFHBi17SpZ3Ezi5DR", // Discovery Call — Virtual
      "aVE54Qf4lrbYTB0zFqXy", // Partnership Discovery Call
    ];
    const eventsUrl = (calId) =>
      `https://services.leadconnectorhq.com/calendars/events?locationId=${locationId}&calendarId=${calId}&startTime=${String(dayStartMs)}&endTime=${String(dayEndMs)}`;

    // Pipeline + all calendars in one parallel batch. Each calendar fetch is
    // fail-soft (one bad calendar shouldn't drop the rest).
    const [pipeResp, ...calResps] = await Promise.all([
      ghlFetch(context, `https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&limit=100`),
      ...CALENDAR_IDS.map((id) => ghlFetch(context, eventsUrl(id)).catch(() => null)),
    ]);

    const lines = [];

    // Merge + dedupe events across calendars (an event can only live on one
    // calendar, but dedupe by id is cheap insurance).
    const eventsById = new Map();
    for (const resp of calResps) {
      if (!resp || !resp.ok) continue;
      try {
        const data = await resp.json();
        for (const e of (data.events || [])) {
          if (e && e.id && !eventsById.has(e.id)) eventsById.set(e.id, e);
        }
      } catch { /* skip a malformed calendar response */ }
    }
    const upcoming = [...eventsById.values()]
      .filter((e) => e.appointmentStatus !== "cancelled")
      .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    if (upcoming.length > 0) {
      lines.push(`Today's appointments: ${upcoming.length}`);
      for (const e of upcoming.slice(0, 8)) {
        // parsePacificWallClock: GHL startTime is naive Pacific — a raw parse
        // treated it as UTC and the LA re-format shifted every time 7-8h.
        const eMs = parsePacificWallClock(String(e.startTime || ""));
        const time = Number.isFinite(eMs) ? new Date(eMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "TBD";
        lines.push(`- ${time}: ${e.title || "Session"} — ${e.contactName || "Unknown"} (${e.appointmentStatus})`);
      }
    } else {
      lines.push("No appointments today.");
    }

    if (pipeResp.ok) {
      const pipeData = await pipeResp.json();
      const opps = pipeData.opportunities || [];
      if (opps.length > 0) {
        const stages = {};
        for (const o of opps) {
          const stage = o.pipelineStageId || "unknown";
          const name = o.stageName || o.pipelineStageName || stage;
          stages[name] = (stages[name] || 0) + 1;
        }
        lines.push(`Pipeline: ${opps.length} total`);
        for (const [name, count] of Object.entries(stages)) {
          lines.push(`- ${name}: ${count}`);
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : null;
  } catch (err) {
    console.error("[cos-chat] GHL summary error:", err.message);
    return null;
  }
}

// Common words to skip when extracting potential names from messages
const SKIP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","shall","should","may","might","must","can","could",
  "i","me","my","we","our","you","your","he","him","his","she","her","it","its","they","them","their",
  "this","that","these","those","what","which","who","whom","when","where","why","how",
  "not","no","nor","and","but","or","so","if","then","than","too","very","just",
  "about","after","again","all","also","any","back","because","before","between",
  "both","by","come","day","each","even","first","for","from","get","give","go",
  "going","good","great","here","into","know","last","like","look","make","many",
  "more","most","much","need","new","now","of","off","on","one","only","other","out",
  "over","own","part","people","place","same","say","see","some","still","such",
  "take","tell","thing","think","time","to","up","us","use","want","way","well",
  "with","work","year","session","sessions","appointment","appointments","client",
  "prepaid","paid","today","tomorrow","yesterday","booked","confirmed","done",
  "many","much","often","does","didn","don","hasn","haven","isn","wasn","weren",
  "next","week","month","already","really","actually","right","left",
]);

function extractNames(message) {
  const words = message.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  const filtered = words.filter(w => !SKIP_WORDS.has(w.toLowerCase()));
  return [...new Set(filtered)].slice(0, 2);
}

// Look up a contact in GHL and fetch their full data
async function lookupContact(context, name) {
  const locationId = "7pIO7FHVAyBT1jKGhfQM";

  // Search for the contact via POST /contacts/search (the GET form returns 400)
  const searchResp = await ghlFetch(context,
    `https://services.leadconnectorhq.com/contacts/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, pageLimit: 5, query: name }),
    }
  );

  if (!searchResp.ok) return null;
  const searchData = await searchResp.json();
  const contacts = searchData.contacts || [];
  if (contacts.length === 0) return null;

  const contact = contacts[0]; // Best match
  const contactId = contact.id;

  // Fetch appointments + orders + invoices in parallel — the ledger needs
  // all three to compute the real prepaid balance + lifetime count. Per the
  // 2026-05-29 session-fields contract, the COS chat should surface
  // ledger-derived values (not raw GHL fields) so its answers stay accurate
  // even when the fields temporarily drift.
  const locationIdForLedger = "7pIO7FHVAyBT1jKGhfQM";
  const [apptResp, ordersResp, invoicesResp] = await Promise.all([
    ghlFetch(context, `https://services.leadconnectorhq.com/contacts/${contactId}/appointments`),
    ghlFetch(context, `https://services.leadconnectorhq.com/payments/orders?altId=${locationIdForLedger}&altType=location&contactId=${contactId}&limit=100`),
    ghlFetch(context, `https://services.leadconnectorhq.com/invoices/?altId=${locationIdForLedger}&altType=location&contactId=${contactId}&limit=100&offset=0`),
  ]);

  const ledgerFetchFailures = [];
  let appointments = [];
  if (apptResp.ok) {
    const apptData = await apptResp.json();
    appointments = apptData.events || apptData.appointments || [];
  } else {
    ledgerFetchFailures.push(`appointments (${apptResp.status})`);
  }
  let orders = [];
  if (ordersResp.ok) {
    const oData = await ordersResp.json();
    const ordersList = oData.data || oData.orders || [];
    // POS / mobile_app orders come back from LIST without items[];
    // hydrate via /payments/orders/{id} so classifyOrder can read
    // product._id. See session-ledger.js → hydrateOrders for details.
    orders = await hydrateOrders(context, ordersList);
  } else {
    ledgerFetchFailures.push(`orders (${ordersResp.status})`);
  }
  let invoices = [];
  if (invoicesResp.ok) {
    const iData = await invoicesResp.json();
    invoices = iData.invoices || [];
  } else {
    ledgerFetchFailures.push(`invoices (${invoicesResp.status})`);
  }
  // POS-source clients show as "low confidence" in the ledger, which is
  // honest signaling for chat answers.
  // Real fieldDefs, not {}: on low confidence the ledger's display block
  // falls back to the hand-typed GHL field, and with an empty map that
  // fallback silently resolved to the (incomplete) derived value instead.
  const ledger = deriveLedger({ contact, orders, invoices, appointments, fieldDefs: LEDGER_FIELD_DEFS, fetchFailures: ledgerFetchFailures });

  // Parse custom fields
  const customFields = contact.customFields || contact.customField || [];
  const fieldMap = {};
  for (const f of (Array.isArray(customFields) ? customFields : [])) {
    fieldMap[f.id] = f.value;
  }

  // Known field IDs (kept for diagnostic display only — see below)
  const fieldSessionsRemaining = fieldMap[GHL_FIELD_IDS.sessions_remaining] || contact.sessionsRemaining || null;
  const fieldSessionsCompleted = fieldMap[GHL_FIELD_IDS.sessions_completed] || contact.sessionsCompleted || null;
  // Display values from deriveLedger — falls back to GHL field on lock
  // or low confidence. See session-ledger.js display block.
  const sessionsRemaining = ledger.display?.remaining ?? (fieldSessionsRemaining ?? "unknown");
  const sessionsCompleted = fieldSessionsCompleted ?? ledger.attended; // GHL field is currently the lifetime counter; the worker syncs it
  const seriesType = ledger.display?.seriesType ?? "none";

  // Categorize appointments
  const discoveryPatterns = /discovery call|15-minute|15 minute|consultation|pain assessment/i;
  const sessions = [];
  const discoveryCalls = [];

  for (const appt of appointments) {
    const title = appt.title || appt.calendarName || "";
    const status = appt.appointmentStatus || appt.status || "unknown";
    const startTime = appt.startTime || appt.start_time || "";
    // parsePacificWallClock: naive-Pacific startTime parsed raw shifted the
    // LA-formatted date/time by 7-8h and broke isToday around day boundaries.
    const startMsEntry = parsePacificWallClock(String(startTime || ""));
    const entry = {
      date: Number.isFinite(startMsEntry) ? new Date(startMsEntry).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) : "Unknown",
      time: Number.isFinite(startMsEntry) ? new Date(startMsEntry).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "",
      title,
      status,
      isToday: Number.isFinite(startMsEntry) && new Date(startMsEntry).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) === todayKey(),
    };

    if (discoveryPatterns.test(title)) {
      discoveryCalls.push(entry);
    } else {
      sessions.push(entry);
    }
  }

  const confirmedSessions = sessions.filter(s => s.status === "showed" || s.status === "completed").length;
  const upcomingConfirmed = sessions.filter(s => s.status === "confirmed" && !s.isToday);
  const todaySession = sessions.find(s => s.isToday);
  const isPrepaid = seriesType !== "none" && parseInt(sessionsRemaining) > 0;

  // Build readable summary
  const fieldDriftNote = ledger.confidence === "high" && fieldSessionsRemaining !== null && parseInt(fieldSessionsRemaining) !== ledger.remaining
    ? ` (GHL field disagrees: ${fieldSessionsRemaining} — will auto-correct on next worker run)`
    : "";
  const lines = [
    `**${contact.firstName || ""} ${contact.lastName || ""}** (${contact.email || "no email"})`,
    `Series: ${seriesType === "none" ? "No series (single sessions)" : `${seriesType} series`}`,
    `Sessions completed: ${confirmedSessions} showed/completed (GHL field: ${sessionsCompleted})`,
    `Sessions remaining (ledger): ${sessionsRemaining}${fieldDriftNote}`,
    `Prepaid: ${isPrepaid ? `Yes (${sessionsRemaining} remaining on ${seriesType})` : "No active series"}`,
    `Ledger confidence: ${ledger.confidence}${ledger.ambiguities.length ? ` — ${ledger.ambiguities.join("; ")}` : ""}`,
    `Tags: ${(contact.tags || []).join(", ") || "none"}`,
  ];

  if (todaySession) {
    lines.push(`TODAY: ${todaySession.time} — ${todaySession.title} (${todaySession.status}) ${isPrepaid ? "— PREPAID" : "— NOT prepaid, needs payment"}`);
  }

  if (sessions.length > 0) {
    lines.push(`\nSession history (excluding discovery calls):`);
    for (const s of sessions.slice(-10)) {
      const marker = s.isToday ? " ← TODAY" : "";
      lines.push(`- ${s.date} ${s.time}: ${s.title} (${s.status})${marker}`);
    }
  }

  if (discoveryCalls.length > 0) {
    lines.push(`\nDiscovery calls (NOT counted as sessions): ${discoveryCalls.length}`);
  }

  if (upcomingConfirmed.length > 0) {
    lines.push(`\nUpcoming confirmed: ${upcomingConfirmed.map(s => `${s.date} ${s.time}`).join(", ")}`);
  }

  return lines.join("\n");
}

// Search GHL for any names mentioned in the user's message
async function getContactContext(context, message) {
  const names = extractNames(message);
  if (names.length === 0) return null;

  const results = [];
  const failed = [];
  for (const name of names) {
    try {
      const data = await lookupContact(context, name);
      if (data) {
        results.push(data);
      } else {
        failed.push(name);
      }
    } catch (err) {
      console.error(`[cos-chat] Contact lookup failed for "${name}":`, err.message);
      failed.push(name);
    }
  }

  const sections = [];
  if (results.length > 0) {
    sections.push(`## Client Data (from GHL — live lookup)\n\n${results.join("\n\n---\n\n")}`);
  }
  if (failed.length > 0) {
    sections.push(`## GHL Lookup Failed\nCould not find or fetch data for: ${failed.join(", ")}. DO NOT guess this client's appointments, sessions, or status. Tell the user the lookup failed and to check GHL directly, or to confirm the spelling.`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

// Look up SF parking regulations near a location
async function getParkingRegulations(location) {
  try {
    // Step 1: Geocode the location using Nominatim (free, no API key)
    const geoResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location + ", San Francisco, CA")}&format=json&limit=1`,
      { headers: { "User-Agent": "ChiefOfStaff/1.0" } }
    );
    if (!geoResp.ok) return null;
    const geoData = await geoResp.json();
    if (!geoData.length) return null;

    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    // Step 2: Query SF parking regulations near these coordinates
    // Use within_circle to find regulations within ~100 meters
    const parkResp = await fetch(
      `https://data.sfgov.org/resource/hi6h-neyh.json?$where=within_circle(shape,${lat},${lon},100)&$limit=10&$select=regulation,days,hours,hrlimit,from_time,to_time,exceptions,rpparea1,analysis_neighborhood`
    );
    if (!parkResp.ok) return null;
    const regs = await parkResp.json();
    if (!regs.length) return null;

    // Step 3: Format for the system prompt
    const lines = [`Parking regulations near ${location} (${geoData[0].display_name}):`];
    const seen = new Set();
    for (const r of regs) {
      const key = `${r.regulation}|${r.days}|${r.hours}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let desc = `- ${r.regulation}`;
      if (r.hrlimit && r.hrlimit !== "0") desc += ` (${r.hrlimit}hr limit)`;
      desc += `: ${r.days} ${r.from_time}–${r.to_time}`;
      if (r.rpparea1) desc += ` | RPP Area ${r.rpparea1}`;
      if (r.exceptions) desc += ` | ${r.exceptions}`;
      lines.push(desc);
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[cos-chat] Parking lookup error:", err.message);
    return null;
  }
}

// Detect if the user's message mentions parking
function mentionsParking(message) {
  return /\bpark(ed|ing|s)?\b/i.test(message);
}

// Extract a geocodable location string from a message by stripping parking verbs and filler
function extractParkingLocation(message) {
  const cleaned = message
    .replace(/\b(i\s+)?(just\s+)?park(ed|ing|s)?\b/gi, "")
    .replace(/\b(and|you|should|know|what|the|sign|says|i'm|at|on|near)\b/gi, "")
    .replace(/[,.\-!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Only use if there's a plausible street/location name left (at least 4 chars)
  return cleaned.length >= 4 ? cleaned : null;
}

// Search conversation history for the most recent parking location
function findParkingLocationInHistory(messages) {
  // Walk backwards through messages to find the most recent location mention near parking context
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const text = m.content || "";
    if (!mentionsParking(text)) continue;
    const loc = extractParkingLocation(text);
    if (loc) return loc;
  }
  // Also check assistant messages for "at <location>" patterns in parking context
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.content || "";
    if (!mentionsParking(text)) continue;
    // Try to extract "at <Street> at/and/& <Street>" or "on <Street>"
    const streetMatch = text.match(/(?:at|on|near)\s+([\w\s]+?(?:street|st|ave|avenue|blvd|boulevard|road|rd|way|drive|dr|place|pl|court|ct|lane|ln)\b[\w\s]*?(?:at|and|&|\/)\s*[\w\s]+)/i);
    if (streetMatch) return streetMatch[1].trim();
  }
  return null;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Verify auth
  const authHeader = context.request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return jsonResponse({ error: "Not authenticated" }, 401, origin);
  }

  let cosUser = "Eben";
  try {
    const payload = await verifySessionToken(token, context.env.JWT_SECRET);
    // Accept the dedicated COS token AND a staff token — the COS chat is now
    // also embedded natively in the staff app (for in-session questions), where
    // Garrett/Eben are already authenticated as staff.
    if (payload.role !== "cos" && payload.role !== "staff") {
      return jsonResponse({ error: "Unauthorized" }, 403, origin);
    }
    cosUser = payload.user || (payload.role === "staff" ? "Staff" : "Eben");
  } catch {
    return jsonResponse({ error: "Invalid or expired token" }, 401, origin);
  }

  // Parse request
  const body = await context.request.json();

  // "New chat" — wipe today's conversation bucket so the next message starts
  // fresh. History is keyed per user per day, so clearing the client UI alone
  // would leave the old thread in KV for the next turn to reload.
  if (body.reset === true) {
    const kv = context.env.PORTAL_KV;
    if (kv) {
      try {
        await kv.delete(`cos:conv:${cosUser}:${todayKey()}`);
      } catch (err) {
        console.error("[cos-chat] reset failed:", err.message);
      }
    }
    return jsonResponse({ ok: true, reset: true }, 200, origin);
  }

  const userMessage = (body.message || "").trim();
  // `image` is the legacy single-photo payload. `images` supports a storefront
  // and a business card in the same hands-free field visit.
  const userImages = [
    ...(Array.isArray(body.images) ? body.images : []),
    ...(body.image ? [body.image] : []),
  ]
    .filter((image) => typeof image === "string" && image.length <= 2_000_000 && /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(image))
    .slice(0, 3);
  if (!userMessage && userImages.length === 0) {
    return jsonResponse({ error: "Message is required" }, 400, origin);
  }

  const OPENROUTER_API_KEY = context.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    await writeOpsLastRun(context.env, OPS_READY_KEYS.cos, {
      ok: false,
      checkedAt: new Date().toISOString(),
      provider: "openrouter",
      error: "OPENROUTER_API_KEY not configured",
    });
    return jsonResponse({ error: "Chat not configured (missing OpenRouter key)" }, 500, origin);
  }

  const kv = context.env.PORTAL_KV;
  const dateKey = todayKey();

  // Load user-scoped conversation history, context doc, pending actions, daily briefing, and vault knowledge from KV
  const [convRaw, contextRaw, actionsRaw, briefingRaw, vaultData] = await Promise.all([
    kv ? kv.get(`cos:conv:${cosUser}:${dateKey}`) : null,
    kv ? kv.get(`cos:context:${cosUser}`) : null,
    kv ? kv.get(`cos:actions:${cosUser}:pending`) : null,
    kv ? kv.get("cos:daily-briefing:latest") : null,
    loadVaultKnowledge(kv).catch(() => null),
  ]);

  const conversation = convRaw ? JSON.parse(convRaw) : { messages: [], created: Date.now(), updated: Date.now() };
  const contextDoc = contextRaw || "";
  const pendingActions = actionsRaw ? JSON.parse(actionsRaw) : [];

  // The single Ask Amari chat owns both jobs. The backend selects the writer
  // only for explicit copy work (and its revisions); no UI toggle is involved.
  const previousMode = conversation.messages.at(-1)?.mode;
  const requestMode = userImages.length === 0
    ? routeAskAmariRequest({ message: userMessage, previousMode })
    : "ask";
  conversation.messages.push({ role: "user", content: userMessage, mode: requestMode, timestamp: Date.now() });

  if (requestMode === "write") {
    return writerStream(context, {
      apiKey: OPENROUTER_API_KEY,
      userName: cosUser,
      messages: writerHistory(conversation.messages),
      conversation,
      kv,
      dateKey,
      headers,
    });
  }

  // Detect what contextual lookups the message needs
  const msg = userMessage.toLowerCase();
  const needsContact = /who|client|contact|session|appointment|prepaid|series|book/i.test(msg) ||
    /(?:^|\.\s+)[a-z].*\b[A-Z][a-z]{2,}/.test(userMessage);
  const needsWeather = /weather|temperature|cold|hot|rain|jacket|umbrella|fog|chilly|warm/i.test(msg);
  const needsDirections = /how (long|far)|directions|drive|driving|get to|travel time|route|traffic/i.test(msg);
  const needsPlaces = /restaurant|food|eat|lunch|dinner|coffee|cafe|bar|shop near|place near/i.test(msg);
  const needsPackages = /package|shipping|deliver|tracking|order|amazon|where.s my/i.test(msg);
  const needsRevenue = /revenue|income|money|made|earned|payments?|sales|how much.*(we|business|practice)/i.test(msg);
  const needsParking = mentionsParking(userMessage);
  const needsMusic = /music|song|play|playing|playlist|spotify|skip|pause|volume|shuffle|track|album|artist|listen|queue|what.s playing|next song|previous song/i.test(msg);
  const needsWorkflow = /workflow|trigger|automat|no.show|attendance|nurture|sequence|funnel|what (email|sms|message).*(send|get|receive)|what happens when|how does .* work|tag.*(add|remov)|condition|branch|purchase system|sessions?.remaining|series.completion|known issue|pending fix|ghl.*(audit|fix|issue|bug)|calendar.*coverage|tier [1-4]/i.test(msg);
  // Note: segmentation questions are now handled via native Anthropic tool use
  // (search_contacts, get_contact_appointments, etc.) — no regex gate needed.

  const cacheKey = `cos:cache:${cosUser}:${dateKey}`;
  const cachedRaw = kv ? await kv.get(cacheKey) : null;
  const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
  const cacheAge = cached ? (Date.now() - cached.timestamp) : Infinity;
  const CACHE_TTL = 5 * 60 * 1000;

  let calendarText, emailText, ghlSummary;
  if (cached && cacheAge < CACHE_TTL) {
    calendarText = cached.calendar;
    emailText = cached.email;
    ghlSummary = cached.ghl;
  } else {
    [calendarText, emailText, ghlSummary] = await Promise.all([
      getTodayCalendar(context, cosUser).catch(() => null),
      getRecentEmails(context, cosUser).catch(() => null),
      getGhlSummary(context).catch(() => null),
    ]);
    if (kv) {
      await kv.put(cacheKey, JSON.stringify({
        calendar: calendarText, email: emailText, ghl: ghlSummary, timestamp: Date.now()
      }), { expirationTtl: 300 });
    }
  }

  const [contactContext, parkingContext, weatherText, directionsText, placesText, packagesText, revenueText, spotifyPlayback, spotifyPlaylists, ghlKnowledgeRaw] = await Promise.all([
    needsContact ? getContactContext(context, userMessage).catch(() => null) : Promise.resolve(null),
    needsParking
      ? getParkingRegulations(
          extractParkingLocation(userMessage) || findParkingLocationInHistory(conversation.messages) || userMessage
        ).catch(() => null)
      : Promise.resolve(null),
    needsWeather ? getWeather().catch(() => null) : Promise.resolve(null),
    needsDirections ? getDirections("San Francisco", userMessage.replace(/how (long|far)|directions|drive to|get to|traffic to/gi, "").trim()).catch(() => null) : Promise.resolve(null),
    needsPlaces ? searchPlaces(userMessage.replace(/restaurant|food|eat|lunch|dinner|near|good|best|find/gi, "").trim()).catch(() => null) : Promise.resolve(null),
    needsPackages ? getPackageTracking(context, cosUser).catch(() => null) : Promise.resolve(null),
    needsRevenue ? getRevenueSummary(context).catch(() => null) : Promise.resolve(null),
    needsMusic ? getCurrentPlayback(context).catch(() => null) : Promise.resolve(null),
    needsMusic ? getUserPlaylists(context).catch(() => []) : Promise.resolve([]),
    needsWorkflow && kv ? kv.get("cos:ghl:knowledge").catch(() => null) : Promise.resolve(null),
  ]);

  // Build messages array for OpenRouter (keep last 30 turns to manage tokens)
  const recentMessages = conversation.messages.slice(-30);
  const calendarAndEmail = [calendarText, emailText].filter(Boolean).join("\n\n");

  // Parse daily briefing if available
  let dailyBriefing = null;
  if (briefingRaw) {
    try {
      const parsed = JSON.parse(briefingRaw);
      dailyBriefing = parsed.briefing;
    } catch {
      dailyBriefing = briefingRaw;
    }
  }

  // Build Spotify context string if music-related
  let spotifyContext = null;
  if (needsMusic) {
    const parts = [];
    if (spotifyPlayback) {
      const pb = spotifyPlayback;
      parts.push(`Now playing: "${pb.track}" by ${pb.artist}${pb.isPlaying ? "" : " (paused)"} on ${pb.device}. Volume: ${pb.volume}%. Shuffle: ${pb.shuffle ? "on" : "off"}.`);
    } else {
      parts.push("Spotify: No active playback. User may need to open Spotify on their phone first.");
    }
    if (spotifyPlaylists.length > 0) {
      const playlistList = spotifyPlaylists.map(p => `- ${p.name} (${p.tracks} tracks)`).join("\n");
      parts.push(`Your playlists:\n${playlistList}`);
    }
    spotifyContext = parts.join("\n\n");
  }

  // Parse GHL workflow knowledge if fetched
  let ghlKnowledgeContext = null;
  if (ghlKnowledgeRaw) {
    try {
      const parsed = JSON.parse(ghlKnowledgeRaw);
      const knowledgeParts = [];
      if (parsed.workflows) knowledgeParts.push(`## GHL Workflow Reference\n${parsed.workflows}`);
      if (parsed.issues) knowledgeParts.push(`## Known GHL Issues\n${parsed.issues}`);
      if (parsed.pendingFixes) knowledgeParts.push(`## Pending GHL Fixes\n${parsed.pendingFixes}`);
      ghlKnowledgeContext = knowledgeParts.join("\n\n");
    } catch {
      ghlKnowledgeContext = `## GHL Workflow Reference\n${ghlKnowledgeRaw}`;
    }
  }

  // Build vault knowledge context (always-include + on-demand sections)
  const vaultContext = buildVaultContext(vaultData, userMessage);

  // Combine all contextual data
  const ghlParts = [
    dailyBriefing,
    ghlSummary ? `Live appointments/pipeline:\n${ghlSummary}` : null,
    contactContext,
    ghlKnowledgeContext,
    vaultContext,
    parkingContext,
    weatherText,
    directionsText,
    placesText,
    packagesText,
    revenueText,
    spotifyContext,
  ].filter(Boolean);

  const ghlContext = ghlParts.length > 0 ? ghlParts.join("\n\n") : null;

  const systemPrompt = buildSystemPrompt(contextDoc, calendarAndEmail || null, ghlContext, cosUser);

  // Build the Anthropic messages array — system goes in body.system, not here
  const anthropicMessages = recentMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

  // Add the latest user message — including every attached image in Anthropic's
  // image-block format (typically storefront + business card for a field visit).
  if (userImages.length > 0) {
    const userContent = [{ type: "text", text: userMessage || "What's in this image?" }];
    for (const userImage of userImages) {
      const imageMatch = userImage.match(/^data:([^;]+);base64,(.+)$/);
      if (imageMatch) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: imageMatch[1], data: imageMatch[2] },
        });
      }
    }
    anthropicMessages.push({ role: "user", content: userContent });
  } else {
    anthropicMessages.push({ role: "user", content: userMessage });
  }

  // Append pending actions to system prompt (kept inside cached block — usually stable)
  let finalSystemPrompt = systemPrompt;
  if (pendingActions.length > 0) {
    const actionSummary = pendingActions.map(a =>
      `- [${a.type}] ${a.item} (${a.status})`
    ).join("\n");
    finalSystemPrompt += `\n\n## Pending Actions (queued for desk processing)\n${actionSummary}`;
  }

  // Build Anthropic request with prompt caching + tool use
  const requestBody = buildRequestBody({
    system: finalSystemPrompt,
    messages: anthropicMessages,
    includeTools: true,
    maxTokens: 2048,
  });

  // Stream the response back via SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  context.waitUntil((async () => {
    let sendBuffer = ""; // Buffer for stripping <!--ACTION/CONTEXT--> blocks across deltas

    async function flushSafe() {
      const markerIdx = sendBuffer.lastIndexOf("<!--");
      if (markerIdx === -1) {
        // A delta boundary can split the 4-char "<!--" marker, leaving the buffer
        // ending in "<", "<!", or "<!-". Flushing that would emit the partial prefix
        // and then fail to match the marker once the rest arrives, leaking the whole
        // internal <!--CONTEXT/ACTION/...--> block raw to the user. Hold back any
        // trailing partial-marker prefix until the next delta completes it. (The
        // final post-stream flush emits anything still held.)
        const partial = sendBuffer.match(/<!?-?$/);
        const holdFrom = partial ? partial.index : sendBuffer.length;
        const safe = sendBuffer.slice(0, holdFrom);
        if (safe) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: safe })}\n\n`));
        }
        sendBuffer = sendBuffer.slice(holdFrom);
      } else {
        const afterMarker = sendBuffer.slice(markerIdx);
        const closeIdx = afterMarker.indexOf("-->");
        if (closeIdx !== -1) {
          const cleaned = sendBuffer.replace(/<!--(?:ACTION|CONTEXT|REMINDER|SPOTIFY):.*?-->/gs, "");
          if (cleaned) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: cleaned })}\n\n`));
          }
          sendBuffer = "";
        } else {
          const safe = sendBuffer.slice(0, markerIdx);
          if (safe) {
            // Strip any COMPLETED comment blocks before sending (the slice may
            // contain finished <!--TYPE:...--> blocks even though a new one is
            // pending after markerIdx).
            const safeCleaned = safe.replace(/<!--(?:ACTION|CONTEXT|REMINDER|SPOTIFY):.*?-->/gs, "");
            if (safeCleaned) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: safeCleaned })}\n\n`));
            }
          }
          sendBuffer = sendBuffer.slice(markerIdx);
        }
      }
    }

    let fullContent = "";

    try {
      const result = await streamWithTools({
        apiKey: OPENROUTER_API_KEY,
        requestBody,
        onTextDelta: async (delta) => {
          fullContent += delta;
          sendBuffer += delta;
          await flushSafe();
        },
        executeToolFn: async (name, input) => {
          console.log(`[cos-chat] tool call: ${name} input=${JSON.stringify(input).slice(0, 200)}`);
          return await executeAnthropicTool(context, name, input, cosUser, userImages);
        },
      });

      // Flush any tail content (strip remaining complete blocks)
      if (sendBuffer) {
        const finalClean = sendBuffer.replace(/<!--(?:ACTION|CONTEXT|REMINDER|SPOTIFY):.*?-->/gs, "");
        if (finalClean) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: finalClean })}\n\n`));
        }
        sendBuffer = "";
      }

      // Log usage for cost monitoring
      console.log(`[cos-chat] usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens} cache_create=${result.usage.cache_creation_input_tokens} tools=${result.tool_calls.length}`);
      await writeOpsLastRun(context.env, OPS_LAST_RUN_KEYS.cosChat, {
        status: "ok",
        user: cosUser,
        inputTokens: result.usage?.input_tokens,
        outputTokens: result.usage?.output_tokens,
      });

      // Parse actions, context, reminders, and Spotify commands from the full response
      const actions = parseActions(fullContent);
      const contextUpdates = parseContextUpdates(fullContent);
      const reminders = parseReminders(fullContent);
      const spotifyActions = parseSpotifyActions(fullContent);
      const cleanContent = stripSpotify(stripReminders(stripContext(stripActions(fullContent))));

      // Save conversation to KV
      conversation.messages.push({ role: "assistant", content: cleanContent, timestamp: Date.now() });
      conversation.updated = Date.now();

      if (kv) {
        const kvWrites = [
          kv.put(`cos:conv:${cosUser}:${dateKey}`, JSON.stringify(conversation), { expirationTtl: 30 * 24 * 60 * 60 }),
        ];

        // Save new actions (user-scoped)
        if (actions.length > 0) {
          const allActions = [...pendingActions, ...actions];
          kvWrites.push(kv.put(`cos:actions:${cosUser}:pending`, JSON.stringify(allActions)));
        }

        // Create calendar reminders. Parking reminders replace any prior
        // active parking reminder for this user — when the car moves to a new
        // spot, the old buzzer for the previous spot should not still fire.
        const PARKING_REMINDER_RE = /\b(move\s+(the\s+|my\s+|your\s+)?car|parking\s+limit|2-?hour\s+limit|street\s+sweep)/i;
        for (const reminder of reminders) {
          try {
            const title = reminder.title || "Reminder";
            const description = reminder.description || "";
            const isParking = PARKING_REMINDER_RE.test(title) || PARKING_REMINDER_RE.test(description);
            const parkingKey = `cos:active-parking-reminder:${cosUser}`;
            if (isParking && kv) {
              const priorRaw = await kv.get(parkingKey);
              if (priorRaw) {
                try {
                  const prior = JSON.parse(priorRaw);
                  if (prior && prior.id) {
                    await deleteCalendarEvent(context, cosUser, prior.id);
                  }
                } catch {
                  // malformed prior entry — ignore
                }
              }
            }
            const created = await createCalendarReminder(
              context,
              cosUser,
              title,
              reminder.minutes_from_now || 60,
              30,
              description
            );
            if (isParking && kv && created && created.id) {
              await kv.put(
                parkingKey,
                JSON.stringify({ id: created.id, title: created.title, start: created.start }),
                { expirationTtl: 24 * 60 * 60 }
              );
            }
          } catch (err) {
            console.error("[cos-chat] Reminder creation failed:", err.message);
          }
        }

        // Execute Spotify commands
        for (const spotifyAction of spotifyActions) {
          try {
            const result = await executeSpotifyAction(context, spotifyAction);
            if (!result.ok) {
              console.error(`[cos-chat] Spotify action failed: ${result.message}`);
            }
          } catch (err) {
            console.error("[cos-chat] Spotify execution error:", err.message);
          }
        }

        // Apply context updates (user-scoped)
        if (contextUpdates.length > 0) {
          let ctx = contextDoc;
          for (const update of contextUpdates) {
            ctx += `\n- **${update.key}**: ${update.value} (learned ${update.learned})`;
          }
          kvWrites.push(kv.put(`cos:context:${cosUser}`, ctx));
        }

        await Promise.all(kvWrites);
      }

      // Send done event with parsed actions
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "done", actions })}\n\n`));
    } catch (err) {
      console.error("[cos-chat] Stream error:", err.message);
      const status = String(err?.message || "").match(/OpenRouter (\d{3})/)?.[1] || null;
      const error = status ? `OpenRouter ${status} chat request failed` : "OpenRouter chat stream failed";
      await Promise.all([
        writeOpsLastRun(context.env, OPS_LAST_RUN_KEYS.cosChat, { status: "error", user: cosUser, error }),
        writeOpsLastRun(context.env, OPS_READY_KEYS.cos, {
          ok: false,
          checkedAt: new Date().toISOString(),
          provider: "openrouter",
          error,
        }),
      ]);
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Stream interrupted" })}\n\n`));
    } finally {
      await writer.close();
    }
  })());

  return new Response(readable, { headers: streamHeaders(headers) });
}
