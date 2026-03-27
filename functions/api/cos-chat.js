// Cloudflare Pages Function: POST /api/cos-chat
// Main chat endpoint — streams Claude responses via SSE through OpenRouter

import { verifySessionToken } from "../lib/auth.js";
import { getTodayCalendar, getRecentEmails } from "../lib/google-api.js";

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

// Build the system prompt
function buildSystemPrompt(context, calendarEvents) {
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

## Queuing Actions
When something needs to happen at Eben's desk (purchases, email, cart automation, etc.), include an action block at the END of your response. Format:
<!--ACTION:{"type":"grocery","item":"cilantro","store":"Safeway","reason":"single item, on your block"}-->
<!--ACTION:{"type":"purchase","item":"dog leash","status":"needs_research","questions":["size?","retractable or fixed?"]}-->
<!--ACTION:{"type":"task","item":"recalculate Lorenzo macros","blocked_by":"need current weight"}-->
<!--ACTION:{"type":"research","item":"JCC challah workshop schedule","details":{}}-->
<!--ACTION:{"type":"calendar","item":"block 2:30-5:30 for challah workshop","details":{}}-->

Types: grocery, purchase, task, research, calendar.
Only queue things that need desk action. Suggestions and thinking stay in the conversation.

## Learning Context
When you learn something new about Eben's life, include:
<!--CONTEXT:{"key":"descriptive.key","value":"what you learned","learned":"${todayKey()}"}-->

Examples: lorenzo.weight, routine.morning, stores.preferred_asian_mart

## Your context (grows over time)
${contextDoc}

## Today's Calendar
${calendarEvents || "Calendar not connected yet. Ask Eben about his schedule if relevant."}

## Style
- Be concise but thoughtful. No filler.
- Think out loud when connecting dots — show your reasoning.
- If you're not sure about something, say so and ask.
- You're talking to one person on his phone while he walks. Keep it conversational.
- Don't use markdown headers or bullet points unless listing options. Just talk.`;
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

  try {
    const payload = await verifySessionToken(token, context.env.JWT_SECRET);
    if (payload.role !== "cos") {
      return jsonResponse({ error: "Unauthorized" }, 403, origin);
    }
  } catch {
    return jsonResponse({ error: "Invalid or expired token" }, 401, origin);
  }

  // Parse request
  const body = await context.request.json();
  const userMessage = (body.message || "").trim();
  if (!userMessage) {
    return jsonResponse({ error: "Message is required" }, 400, origin);
  }

  const OPENROUTER_API_KEY = context.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    return jsonResponse({ error: "Chat not configured" }, 500, origin);
  }

  const kv = context.env.PORTAL_KV;
  const dateKey = todayKey();

  // Load conversation history, context doc, and pending actions from KV
  const [convRaw, contextRaw, actionsRaw] = await Promise.all([
    kv ? kv.get(`cos:conv:${dateKey}`) : null,
    kv ? kv.get("cos:context") : null,
    kv ? kv.get("cos:actions:pending") : null,
  ]);

  const conversation = convRaw ? JSON.parse(convRaw) : { messages: [], created: Date.now(), updated: Date.now() };
  const contextDoc = contextRaw || "";
  const pendingActions = actionsRaw ? JSON.parse(actionsRaw) : [];

  // Add user message to history
  conversation.messages.push({ role: "user", content: userMessage, timestamp: Date.now() });

  // Fetch calendar and email context in parallel
  const [calendarText, emailText] = await Promise.all([
    getTodayCalendar(context).catch(() => null),
    getRecentEmails(context).catch(() => null),
  ]);

  // Build messages array for OpenRouter (keep last 30 turns to manage tokens)
  const recentMessages = conversation.messages.slice(-30);
  const calendarAndEmail = [calendarText, emailText].filter(Boolean).join("\n\n");
  const systemPrompt = buildSystemPrompt(contextDoc, calendarAndEmail || null);

  const openRouterMessages = [
    { role: "system", content: systemPrompt },
    ...recentMessages.map(m => ({ role: m.role, content: m.content })),
  ];

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
          const cleaned = sendBuffer.replace(/<!--(?:ACTION|CONTEXT):.*?-->/gs, "");
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
        const finalClean = sendBuffer.replace(/<!--(?:ACTION|CONTEXT):.*?-->/gs, "");
        if (finalClean) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: finalClean })}\n\n`));
        }
        sendBuffer = "";
      }

      // Parse actions and context from the full response
      const actions = parseActions(fullContent);
      const contextUpdates = parseContextUpdates(fullContent);
      const cleanContent = stripContext(stripActions(fullContent));

      // Save conversation to KV
      conversation.messages.push({ role: "assistant", content: cleanContent, timestamp: Date.now() });
      conversation.updated = Date.now();

      if (kv) {
        const kvWrites = [
          kv.put(`cos:conv:${dateKey}`, JSON.stringify(conversation), { expirationTtl: 30 * 24 * 60 * 60 }),
        ];

        // Save new actions
        if (actions.length > 0) {
          const allActions = [...pendingActions, ...actions];
          kvWrites.push(kv.put("cos:actions:pending", JSON.stringify(allActions)));
        }

        // Apply context updates
        if (contextUpdates.length > 0) {
          let ctx = contextDoc;
          for (const update of contextUpdates) {
            ctx += `\n- **${update.key}**: ${update.value} (learned ${update.learned})`;
          }
          kvWrites.push(kv.put("cos:context", ctx));
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
