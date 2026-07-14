/**
 * Parla Italiano — Cloudflare Worker
 * Serves the PWA (via Assets) and proxies chat to OpenRouter so the API key
 * never ships to the browser.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Parla-Access',
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      ...extra,
    },
  })
}

function systemPrompt(level, topic) {
  const levelHints = {
    A1: 'Use very simple Italian. Short sentences. Present tense mostly. Speak slowly in text.',
    A2: 'Simple everyday Italian. Basic past/future ok. Common phrases.',
    B1: 'Natural conversational Italian. Mix tenses. Everyday + some abstract topics.',
    B2: 'Fluent Italian with idioms. Normal native pace in writing.',
    C1: 'Sophisticated Italian, nuance, cultural references.',
    C2: 'Near-native Italian with rare vocabulary and idioms.',
  }

  return `You are Parla, a warm Italian conversation partner helping an English speaker practice Italian by voice.

Rules:
- Reply almost entirely in Italian (the learner's target language).
- Keep replies short: 1–2 sentences max (this will be spoken aloud).
- Always end with a simple follow-up question in Italian.
- Gently correct mistakes: briefly show the better Italian in parentheses, then continue.
- Topic focus: ${topic || 'everyday life'}.
- Level ${level}: ${levelHints[level] || levelHints.A2}
- Sound like a friendly person, not a textbook.
- No markdown, no bullet lists, no emoji spam.`
}

async function handleChat(request, env) {
  if (!env.OPENROUTER_API_KEY) {
    return json({ error: 'OPENROUTER_API_KEY not configured on worker' }, 500)
  }

  if (env.APP_ACCESS_CODE) {
    const code = request.headers.get('X-Parla-Access') || ''
    if (code !== env.APP_ACCESS_CODE) {
      return json({ error: 'Unauthorized' }, 401)
    }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const level = body.level || 'A2'
  const topic = body.topic || 'travel'
  const model = body.model || env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'

  const openRouterMessages = [
    { role: 'system', content: systemPrompt(level, topic) },
    ...messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
  ]

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://parla.ebenforrest.com',
      'X-Title': 'Parla Italiano',
    },
    body: JSON.stringify({
      model,
      messages: openRouterMessages,
      temperature: 0.85,
      max_tokens: 180,
    }),
  })

  const data = await upstream.json().catch(() => ({}))

  if (!upstream.ok) {
    const msg = data?.error?.message || data?.error || `OpenRouter ${upstream.status}`
    return json({ error: String(msg) }, 422)
  }

  const reply = data?.choices?.[0]?.message?.content?.trim()
  if (!reply) {
    return json({ error: 'Empty response from model' }, 422)
  }

  return json({
    reply,
    model: data.model || model,
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: env.APP_NAME || 'Parla',
        hasKey: Boolean(env.OPENROUTER_API_KEY),
        accessRequired: Boolean(env.APP_ACCESS_CODE),
        model: env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      })
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        return await handleChat(request, env)
      } catch (err) {
        return json({ error: err.message || 'Chat failed' }, 500)
      }
    }

    // Static PWA assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return json({ error: 'Not found' }, 404)
  },
}
