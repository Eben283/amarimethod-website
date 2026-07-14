const ACCESS_KEY = 'parla_access_code'

export function getAccessCode() {
  return localStorage.getItem(ACCESS_KEY) || ''
}

export function setAccessCode(code) {
  if (code) localStorage.setItem(ACCESS_KEY, code)
  else localStorage.removeItem(ACCESS_KEY)
}

export async function fetchHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('Health check failed')
  return res.json()
}

export async function sendChat({ messages, level, topic }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Parla-Access': getAccessCode(),
    },
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
