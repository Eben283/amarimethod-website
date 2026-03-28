// Cloudflare Pages Function: POST /api/cos-chat
// Main chat endpoint — streams Claude responses via SSE through OpenRouter

import { verifySessionToken } from "../lib/auth.js";
import { getTodayCalendar, getRecentEmails, createCalendarReminder } from "../lib/google-api.js";
import { ghlFetch } from "../lib/ghl.js";
import { getWeather, getDirections, searchPlaces, getPackageTracking, getRevenueSummary } from "../lib/cos-lookups.js";

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

// Build the system prompt
function buildSystemPrompt(context, calendarEvents, ghlSummary) {
  const contextDoc = context || "No context learned yet. As you learn about Eben's life, preferences, and routines, this will grow.";

  return `You are Eben's chief of staff. Your job is to THINK, not sort.

When Eben says something, don't just categorize it. Pull on the thread:
- What does he actually need? (not what he literally said)
- What else in his life does this connect to?
- What should he be thinking about that he's not?
- What questions should you ask before acting?

## How to handle different inputs

GROCERY/SHOPPING: Don't just add to a list. Think about:
- Which store based on what else is needed and quantity
- His stores: Safeway (on his block at 6628th Ave SF, quick single items), Costco (bulk, Instacart same-day), Asian mart on Clement (specialty, walkable)
- Purchase history patterns — should we rotate/switch things up?
- Lorenzo (his dog) has specific nutritional needs if it's dog food

PURCHASES: If ambiguous, research and recommend — suggest options with reasoning. Don't just ask "what kind?" — give him 2-3 options and say which you'd pick and why.

EVENTS/ACTIVITIES: Cross-reference the calendar below. Flag conflicts, travel time (especially bridge traffic to Oakland), and opportunities (bringing food to a dinner party, etc).

TASKS/IDEAS: Think about whether something is blocked by other things, connects to something else, or should happen before/after something on the calendar.

PARKING: When Eben mentions parking, you'll have SF parking regulations for that area. Tell him the rules clearly, then SET A REMINDER using the reminder block so his phone buzzes him before time runs out.

WEATHER: When asked about weather, you'll have current SF conditions + forecast. Give practical advice (jacket? umbrella?), not a weather report.

DIRECTIONS/TRAVEL: When asked about travel time, you'll have driving distance and duration. Add context for bridge traffic (Oakland/Berkeley = add 15-30 min during rush hour).

RESTAURANTS/PLACES: When asked for food or place recommendations, you'll have nearby results. Add your own knowledge about SF neighborhoods to give better suggestions.

PACKAGES: When asked about orders or deliveries, you'll have recent shipping emails from Gmail. Summarize what's coming and when.

REVENUE: When asked about money/revenue/payments, you'll have GHL payment data. Summarize this month, this week, and recent transactions.

MATH: You can do math directly — session pricing, revenue projections, tip calculations, whatever. No API needed.

BUSINESS/GHL: You know the Amari Method GHL system deeply. Answer questions about workflows, pipelines, contacts, sessions, pricing, partner program. Reference the GHL section below.

## Queuing Actions
When something needs to happen at Eben's desk (purchases, email, cart automation, etc.), include an action block at the END of your response. Format:
<!--ACTION:{"type":"grocery","item":"cilantro","store":"Safeway","reason":"single item, on your block"}-->
<!--ACTION:{"type":"purchase","item":"dog leash","status":"needs_research","questions":["size?","retractable or fixed?"]}-->
<!--ACTION:{"type":"task","item":"recalculate Lorenzo macros","blocked_by":"need current weight"}-->
<!--ACTION:{"type":"research","item":"JCC challah workshop schedule","details":{}}-->
<!--ACTION:{"type":"calendar","item":"block 2:30-5:30 for challah workshop","details":{}}-->

Types: grocery, purchase, task, research, calendar.
Only queue things that need desk action. Suggestions and thinking stay in the conversation.

## Setting Reminders
You CAN set reminders that will buzz Eben's phone via Google Calendar. Include a reminder block:
<!--REMINDER:{"title":"Move car — 5th & Clement","minutes_from_now":105,"description":"2hr parking limit, parked at 2:15pm"}-->

Use this for:
- Parking time limits (set to limit minus 15 min)
- "Remind me to..." requests
- Anything time-sensitive that needs a phone notification

The reminder creates a calendar event with a popup alert. It actually works — use it.

## Learning Context
When you learn something new about Eben's life, include:
<!--CONTEXT:{"key":"descriptive.key","value":"what you learned","learned":"${todayKey()}"}-->

Examples: lorenzo.weight, routine.morning, stores.preferred_asian_mart

## Your context (grows over time)
${contextDoc}

## Today's Calendar
${calendarEvents || "Calendar not connected yet. Ask Eben about his schedule if relevant."}

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

    // Fetch appointments and pipeline in parallel
    const [apptResp, pipeResp] = await Promise.all([
      ghlFetch(context, `https://services.leadconnectorhq.com/calendars/events?locationId=${locationId}&startTime=${startDate}T00:00:00-07:00&endTime=${startDate}T23:59:59-07:00`),
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

// Extract potential person names from a message
function extractNames(message) {
  const words = message.split(/[\s,?.!;:]+/).filter(w => w.length >= 3);
  const candidates = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-zA-Z'-]/g, "");
    if (word.length < 3) continue;
    if (SKIP_WORDS.has(word.toLowerCase())) continue;

    // Capitalized words are likely names
    if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      candidates.push(word);
      continue;
    }

    // Even lowercase — if it's not a common word, could be a name typed casually
    if (!SKIP_WORDS.has(word.toLowerCase()) && /^[a-zA-Z]+$/.test(word)) {
      // Only include if it's reasonably name-like (not too long, not a verb/adjective)
      if (word.length <= 15) {
        candidates.push(word);
      }
    }
  }

  // Dedupe and limit to top 3
  return [...new Set(candidates)].slice(0, 3);
}

// Look up a contact in GHL and fetch their full data
async function lookupContact(context, name) {
  const locationId = "7pIO7FHVAyBT1jKGhfQM";

  // Search for the contact
  const searchResp = await ghlFetch(context,
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${locationId}&name=${encodeURIComponent(name)}`
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
  for (const name of names) {
    try {
      const data = await lookupContact(context, name);
      if (data) results.push(data);
    } catch (err) {
      console.error(`[cos-chat] Contact lookup failed for "${name}":`, err.message);
    }
  }

  return results.length > 0
    ? `## Client Data (from GHL — live lookup)\n\n${results.join("\n\n---\n\n")}`
    : null;
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

  const OPENROUTER_API_KEY = context.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    return jsonResponse({ error: "Chat not configured" }, 500, origin);
  }

  const kv = context.env.PORTAL_KV;
  const dateKey = todayKey();

  // Load user-scoped conversation history, context doc, pending actions, and shared daily briefing from KV
  const [convRaw, contextRaw, actionsRaw, briefingRaw] = await Promise.all([
    kv ? kv.get(`cos:conv:${cosUser}:${dateKey}`) : null,
    kv ? kv.get(`cos:context:${cosUser}`) : null,
    kv ? kv.get(`cos:actions:${cosUser}:pending`) : null,
    kv ? kv.get("cos:daily-briefing:latest") : null,
  ]);

  const conversation = convRaw ? JSON.parse(convRaw) : { messages: [], created: Date.now(), updated: Date.now() };
  const contextDoc = contextRaw || "";
  const pendingActions = actionsRaw ? JSON.parse(actionsRaw) : [];

  // Add user message to history
  conversation.messages.push({ role: "user", content: userMessage, timestamp: Date.now() });

  // Detect what contextual lookups the message needs
  const msg = userMessage.toLowerCase();
  const needsWeather = /weather|temperature|cold|hot|rain|jacket|umbrella|fog|chilly|warm/i.test(msg);
  const needsDirections = /how (long|far)|directions|drive|driving|get to|travel time|route|traffic/i.test(msg);
  const needsPlaces = /restaurant|food|eat|lunch|dinner|coffee|cafe|bar|shop near|place near/i.test(msg);
  const needsPackages = /package|shipping|deliver|tracking|order|amazon|where.s my/i.test(msg);
  const needsRevenue = /revenue|income|money|made|earned|payments?|sales|how much.*(we|business|practice)/i.test(msg);
  const needsParking = mentionsParking(userMessage);

  // Fetch all context in parallel — only fetch what's relevant
  const [calendarText, emailText, ghlSummary, contactContext, parkingContext, weatherText, directionsText, placesText, packagesText, revenueText] = await Promise.all([
    getTodayCalendar(context).catch(() => null),
    getRecentEmails(context).catch(() => null),
    getGhlSummary(context).catch(() => null),
    getContactContext(context, userMessage).catch(() => null),
    needsParking
      ? getParkingRegulations(userMessage.replace(/\b(i\s+)?park(ed|ing)?\b/gi, "").trim()).catch(() => null)
      : Promise.resolve(null),
    needsWeather ? getWeather().catch(() => null) : Promise.resolve(null),
    needsDirections ? getDirections("San Francisco", userMessage.replace(/how (long|far)|directions|drive to|get to|traffic to/gi, "").trim()).catch(() => null) : Promise.resolve(null),
    needsPlaces ? searchPlaces(userMessage.replace(/restaurant|food|eat|lunch|dinner|near|good|best|find/gi, "").trim()).catch(() => null) : Promise.resolve(null),
    needsPackages ? getPackageTracking(context).catch(() => null) : Promise.resolve(null),
    needsRevenue ? getRevenueSummary(context).catch(() => null) : Promise.resolve(null),
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

  // Combine all contextual data
  const ghlParts = [
    dailyBriefing,
    ghlSummary ? `Live appointments/pipeline:\n${ghlSummary}` : null,
    contactContext,
    parkingContext,
    weatherText,
    directionsText,
    placesText,
    packagesText,
    revenueText,
  ].filter(Boolean);

  const ghlContext = ghlParts.length > 0 ? ghlParts.join("\n\n") : null;

  const systemPrompt = buildSystemPrompt(contextDoc, calendarAndEmail || null, ghlContext);

  const openRouterMessages = [
    { role: "system", content: systemPrompt },
    ...recentMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
  ];

  // Add the latest user message — with image if present
  if (userImage) {
    openRouterMessages.push({
      role: "user",
      content: [
        { type: "text", text: userMessage || "What's in this image?" },
        { type: "image_url", image_url: { url: userImage } },
      ],
    });
  } else {
    openRouterMessages.push({ role: "user", content: userMessage });
  }

  // Add pending actions context if any
  if (pendingActions.length > 0) {
    const actionSummary = pendingActions.map(a =>
      `- [${a.type}] ${a.item} (${a.status})`
    ).join("\n");
    openRouterMessages[0].content += `\n\n## Pending Actions (queued for desk processing)\n${actionSummary}`;
  }

  // Call OpenRouter with streaming
  const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.amarimethod.com",
      "X-Title": "Chief of Staff",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-6",
      messages: openRouterMessages,
      stream: true,
      max_tokens: 2048,
    }),
  });

  if (!openRouterResponse.ok) {
    const errText = await openRouterResponse.text();
    console.error("[cos-chat] OpenRouter error:", openRouterResponse.status, errText);
    return jsonResponse({ error: "Chat service unavailable" }, 422, origin);
  }

  // Stream the response back via SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Process the OpenRouter stream in the background
  context.waitUntil((async () => {
    let fullContent = "";
    let sendBuffer = ""; // Buffer for stripping <!--ACTION/CONTEXT--> blocks
    const reader = openRouterResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    async function flushSafe() {
      // Send everything in sendBuffer that we're sure isn't part of a block.
      // Hold back content from the last "<!--" onward (might be an incomplete block).
      const markerIdx = sendBuffer.lastIndexOf("<!--");
      if (markerIdx === -1) {
        // No marker — safe to send everything
        if (sendBuffer) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: sendBuffer })}\n\n`));
          sendBuffer = "";
        }
      } else {
        // Check if there's a complete block (has closing -->)
        const afterMarker = sendBuffer.slice(markerIdx);
        const closeIdx = afterMarker.indexOf("-->");
        if (closeIdx !== -1) {
          // Complete block found — strip it and send what's safe
          const cleaned = sendBuffer.replace(/<!--(?:ACTION|CONTEXT|REMINDER):.*?-->/gs, "");
          if (cleaned) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: cleaned })}\n\n`));
          }
          sendBuffer = "";
        } else {
          // Incomplete block — send everything before the marker, hold the rest
          const safe = sendBuffer.slice(0, markerIdx);
          if (safe) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: safe })}\n\n`));
          }
          sendBuffer = sendBuffer.slice(markerIdx);
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              sendBuffer += delta;
              await flushSafe();
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }

      // Flush any remaining buffered content (strip complete blocks)
      if (sendBuffer) {
        const finalClean = sendBuffer.replace(/<!--(?:ACTION|CONTEXT|REMINDER):.*?-->/gs, "");
        if (finalClean) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: finalClean })}\n\n`));
        }
        sendBuffer = "";
      }

      // Parse actions, context, and reminders from the full response
      const actions = parseActions(fullContent);
      const contextUpdates = parseContextUpdates(fullContent);
      const reminders = parseReminders(fullContent);
      const cleanContent = stripReminders(stripContext(stripActions(fullContent)));

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
