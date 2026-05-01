// Cloudflare Pages Function: POST /api/cos-chat
// Main chat endpoint — streams Claude responses via SSE through OpenRouter

import { verifySessionToken } from "../lib/auth.js";
import { getTodayCalendar, getRecentEmails, createCalendarReminder, getPacificOffset } from "../lib/google-api.js";
import { ghlFetch } from "../lib/ghl.js";
import { getWeather, getDirections, searchPlaces, getPackageTracking, getRevenueSummary } from "../lib/cos-lookups.js";
import { getCurrentPlayback, getUserPlaylists, executeSpotifyAction, isSpotifyConnected } from "../lib/spotify.js";
import { loadVaultKnowledge, buildVaultContext } from "../lib/cos-vault.js";
import { buildRequestBody, streamWithTools, executeTool as executeAnthropicTool } from "../lib/cos-anthropic.js";

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

PARKING: When ${userName} mentions parking, you'll have SF parking regulations for that area. Tell him the rules clearly, then SET A REMINDER using the reminder block so his phone buzzes him before time runs out.

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

Types: grocery, purchase, task, research, calendar.
Only queue things that need desk action. Suggestions and thinking stay in the conversation.

## Setting Reminders
You CAN set reminders that will buzz ${userName}'s phone via Google Calendar. Include a reminder block:
<!--REMINDER:{"title":"Move car — 5th & Clement","minutes_from_now":105,"description":"2hr parking limit, parked at 2:15pm"}-->

Use this for:
- Parking time limits (set to limit minus 15 min)
- "Remind me to..." requests
- Anything time-sensitive that needs a phone notification

The reminder creates a calendar event with a popup alert. It actually works — use it.

## Learning Context
When you learn something new about ${userName}'s life, include:
<!--CONTEXT:{"key":"descriptive.key","value":"what you learned","learned":"${todayKey()}"}-->

Examples: lorenzo.weight, routine.morning, stores.preferred_asian_mart

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
Amari Method — solo bodywork practice in San Francisco run by Dr. Garrett. Eben manages ops/tech.

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

### Session Tracking
- sessions_remaining: decrements per attended session
- sessions_completed: increments per attended session
- series_type: none / 4-session / 8-session
- Attendance tracked via staff dashboard "Mark Attended" button + SMS trigger link
- Double-count risk exists (idempotency guard needed on SMS workflow)

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

    // Fetch appointments and pipeline in parallel
    const [apptResp, pipeResp] = await Promise.all([
      ghlFetch(context, `https://services.leadconnectorhq.com/calendars/events?locationId=${locationId}&startTime=${String(dayStartMs)}&endTime=${String(dayEndMs)}`),
      ghlFetch(context, `https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&limit=100`),
    ]);

    const lines = [];

    if (apptResp.ok) {
      const apptData = await apptResp.json();
      const events = apptData.events || [];
      const upcoming = events.filter(e => e.appointmentStatus !== "cancelled");
      if (upcoming.length > 0) {
        lines.push(`Today's appointments: ${upcoming.length}`);
        for (const e of upcoming.slice(0, 8)) {
          const time = e.startTime ? new Date(e.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "TBD";
          lines.push(`- ${time}: ${e.title || "Session"} — ${e.contactName || "Unknown"} (${e.appointmentStatus})`);
        }
      } else {
        lines.push("No appointments today.");
      }
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

  // Fetch appointments for this contact
  const apptResp = await ghlFetch(context,
    `https://services.leadconnectorhq.com/contacts/${contactId}/appointments`
  );

  let appointments = [];
  if (apptResp.ok) {
    const apptData = await apptResp.json();
    appointments = apptData.events || apptData.appointments || [];
  }

  // Parse custom fields
  const customFields = contact.customFields || contact.customField || [];
  const fieldMap = {};
  for (const f of (Array.isArray(customFields) ? customFields : [])) {
    fieldMap[f.id] = f.value;
  }

  // Known field IDs
  const sessionsRemaining = fieldMap["wrQSkx6BhXwDGIn1d0V4"] || contact.sessionsRemaining || "unknown";
  const sessionsCompleted = fieldMap["TE0udwVH1Km5RsKaN5H0"] || contact.sessionsCompleted || "unknown";
  const seriesType = fieldMap["3i93lTkmuAV49s9nh0q8"] || contact.seriesType || "none";

  // Categorize appointments
  const discoveryPatterns = /discovery call|15-minute|15 minute|consultation|pain assessment/i;
  const sessions = [];
  const discoveryCalls = [];

  for (const appt of appointments) {
    const title = appt.title || appt.calendarName || "";
    const status = appt.appointmentStatus || appt.status || "unknown";
    const startTime = appt.startTime || appt.start_time || "";
    const entry = {
      date: startTime ? new Date(startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) : "Unknown",
      time: startTime ? new Date(startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "",
      title,
      status,
      isToday: startTime && new Date(startTime).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) === todayKey(),
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
  const lines = [
    `**${contact.firstName || ""} ${contact.lastName || ""}** (${contact.email || "no email"})`,
    `Series: ${seriesType === "none" ? "No series (single sessions)" : `${seriesType} series`}`,
    `Sessions completed: ${confirmedSessions} showed/completed (GHL field: ${sessionsCompleted})`,
    `Sessions remaining: ${sessionsRemaining}`,
    `Prepaid: ${isPrepaid ? `Yes (${sessionsRemaining} remaining on ${seriesType})` : "No active series"}`,
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
    if (payload.role !== "cos") {
      return jsonResponse({ error: "Unauthorized" }, 403, origin);
    }
    cosUser = payload.user || "Eben";
  } catch {
    return jsonResponse({ error: "Invalid or expired token" }, 401, origin);
  }

  // Parse request
  const body = await context.request.json();
  const userMessage = (body.message || "").trim();
  const userImage = body.image || null; // base64 data URI
  if (!userMessage && !userImage) {
    return jsonResponse({ error: "Message is required" }, 400, origin);
  }

  const ANTHROPIC_API_KEY = context.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Chat not configured (missing ANTHROPIC_API_KEY)" }, 500, origin);
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

  // Add user message to history
  conversation.messages.push({ role: "user", content: userMessage, timestamp: Date.now() });

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
      getTodayCalendar(context).catch(() => null),
      getRecentEmails(context).catch(() => null),
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
    needsPackages ? getPackageTracking(context).catch(() => null) : Promise.resolve(null),
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

  // Add the latest user message — with image if present (Anthropic image block format)
  if (userImage) {
    const imageMatch = userImage.match(/^data:([^;]+);base64,(.+)$/);
    const userContent = [{ type: "text", text: userMessage || "What's in this image?" }];
    if (imageMatch) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: imageMatch[1], data: imageMatch[2] },
      });
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
        if (sendBuffer) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: sendBuffer })}\n\n`));
          sendBuffer = "";
        }
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
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: safe })}\n\n`));
          }
          sendBuffer = sendBuffer.slice(markerIdx);
        }
      }
    }

    let fullContent = "";

    try {
      const result = await streamWithTools({
        apiKey: ANTHROPIC_API_KEY,
        requestBody,
        onTextDelta: async (delta) => {
          fullContent += delta;
          sendBuffer += delta;
          await flushSafe();
        },
        executeToolFn: async (name, input) => {
          console.log(`[cos-chat] tool call: ${name} input=${JSON.stringify(input).slice(0, 200)}`);
          return await executeAnthropicTool(context, name, input);
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

        // Create calendar reminders
        for (const reminder of reminders) {
          try {
            await createCalendarReminder(
              context,
              reminder.title || "Reminder",
              reminder.minutes_from_now || 60,
              10,
              reminder.description || ""
            );
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
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Stream interrupted" })}\n\n`));
    } finally {
      await writer.close();
    }
  })());

  return new Response(readable, {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
