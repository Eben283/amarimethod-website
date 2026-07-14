const ACCESS_KEY = 'parla_access_code'

export function getAccessCode() {
  return localStorage.getItem(ACCESS_KEY) || ''
}

export function setAccessCode(code) {
  if (code) localStorage.setItem(ACCESS_KEY, code)
  else localStorage.removeItem(ACCESS_KEY)
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Parla-Access': getAccessCode(),
    ...extra,
  }
}

export async function fetchHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('Health check failed')
  return res.json()
}

export async function sendChat({ messages, level, topic }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, level, topic }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Chat failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

/** Returns a blob URL for Italian MP3 speech. Caller should revokeObjectURL when done. */
export async function fetchSpeechAudio(text) {
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `Speak failed (${res.status})`)
    err.status = res.status
    throw err
  }

  const blob = await res.blob()
  if (!blob.size) throw new Error('Empty audio')
  return URL.createObjectURL(blob)
}
