/**
 * Parla Italiano — Cloudflare Worker
 * Serves the PWA (via Assets), proxies chat to OpenRouter, and synthesizes
 * Italian speech so phones can actually hear replies.
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

function requireAccess(request, env) {
  if (!env.APP_ACCESS_CODE) return null
  const code = request.headers.get('X-Parla-Access') || ''
  if (code !== env.APP_ACCESS_CODE) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

function systemPrompt(level, topic) {
  const levelHints = {
    A1: `ABSOLUTE BEGINNER mode.
- Only the most common Italian words a tourist knows in week 1.
- Max ~8 words per sentence. Present tense only.
- Prefer: ciao, come stai, mi chiamo, mi piace, sì, no, grazie, per favore, dove, cosa.
- Do NOT use passato prossimo, congiuntivo, or complex clauses.`,
    A2: `Elementary mode.
- Simple everyday Italian. Short clear sentences.
- Present + simple past/future ok. Common phrases only.`,
    B1: `Intermediate mode.
- Natural conversational Italian. Mix tenses.
- Everyday topics plus light abstract ideas.`,
    B2: `Upper-intermediate.
- Fluent Italian with some idioms. Normal pace.`,
    C1: `Advanced.
- Sophisticated Italian, nuance, cultural references.`,
    C2: `Near-native.
- Rare vocabulary and idioms OK.`,
  }

  return `You are Parla, a warm Italian conversation partner helping an English speaker practice Italian by voice.

Hard rules:
- Reply almost entirely in Italian.
- Keep replies very short (1–2 sentences). This will be spoken aloud.
- Always end with one easy follow-up question in Italian.
- Gently correct mistakes in parentheses, then continue.
- Topic focus: ${topic || 'everyday life'}.
- CEFR level for THIS conversation: ${level}
${levelHints[level] || levelHints.A2}
- Sound like a friendly person, not a textbook.
- No markdown, no bullet lists, no emoji spam.
- If level is A1, your first sentence must be extremely simple Italian.`
}

async function handleChat(request, env) {
  if (!env.OPENROUTER_API_KEY) {
    return json({ error: 'OPENROUTER_API_KEY not configured on worker' }, 500)
  }

  const denied = requireAccess(request, env)
  if (denied) return denied

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
      'HTTP-Referer': 'https://parla-italiano.eben-fa2.workers.dev',
      'X-Title': 'Parla Italiano',
    },
    body: JSON.stringify({
      model,
      messages: openRouterMessages,
      temperature: level === 'A1' ? 0.6 : 0.85,
      max_tokens: level === 'A1' ? 100 : 180,
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
    level,
  })
}

/** Chunk long text for Translate TTS (~180 chars is safest). */
function chunkText(text, max = 160) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  if (cleaned.length <= max) return [cleaned]

  const parts = []
  let rest = cleaned
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max)
    if (cut < 40) cut = max
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function fetchItalianTtsChunk(text) {
  const url = new URL('https://translate.google.com/translate_tts')
  url.searchParams.set('ie', 'UTF-8')
  url.searchParams.set('q', text)
  url.searchParams.set('tl', 'it')
  url.searchParams.set('client', 'tw-ob')

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
    },
  })

  if (!res.ok) {
    throw new Error(`TTS upstream ${res.status}`)
  }

  const buf = await res.arrayBuffer()
  if (!buf || buf.byteLength < 64) {
    throw new Error('TTS returned empty audio')
  }
  return new Uint8Array(buf)
}

async function handleSpeak(request, env) {
  const denied = requireAccess(request, env)
  if (denied) return denied

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return json({ error: 'Missing text' }, 400)
  if (text.length > 800) return json({ error: 'Text too long' }, 400)

  const chunks = chunkText(text)
  const parts = []
  for (const chunk of chunks) {
    parts.push(await fetchItalianTtsChunk(chunk))
  }

  const total = parts.reduce((n, p) => n + p.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    merged.set(p, offset)
    offset += p.length
  }

  return new Response(merged, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      ...CORS,
    },
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
        tts: true,
      })
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        return await handleChat(request, env)
      } catch (err) {
        return json({ error: err.message || 'Chat failed' }, 500)
      }
    }

    if (url.pathname === '/api/speak' && request.method === 'POST') {
      try {
        return await handleSpeak(request, env)
      } catch (err) {
        return json({ error: err.message || 'Speak failed' }, 422)
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return json({ error: 'Not found' }, 404)
  },
}
