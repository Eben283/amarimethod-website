// Minimal Twilio Programmable Messaging send for Workers (no SDK).

/**
 * @param {object} env
 * @param {{ to: string, body: string, from?: string }} params
 * @returns {Promise<{ success: boolean, sid?: string|null, status?: string|null, error?: string, code?: number|null }>}
 */
export async function sendTwilioSms(env, params) {
  const sid = env.TWILIO_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = params.from || env.TWILIO_FROM_NUMBER;
  const to = String(params.to || "").trim();
  const body = String(params.body || "").trim();

  if (!sid || !token) return { success: false, error: "missing TWILIO_SID or TWILIO_AUTH_TOKEN" };
  if (!from) return { success: false, error: "missing TWILIO_FROM_NUMBER" };
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { success: false, error: "invalid to E.164" };
  if (!body) return { success: false, error: "empty body" };
  if (body.length > 1600) return { success: false, error: "body too long" };

  const auth = btoa(`${sid}:${token}`);
  let res;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
  } catch (err) {
    return { success: false, error: `fetch failed: ${err?.message || String(err)}` };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    return {
      success: false,
      status: data?.status || String(res.status),
      code: data?.code ?? data?.error_code ?? null,
      error: data?.message || data?.error_message || `Twilio HTTP ${res.status}`,
    };
  }

  return {
    success: true,
    sid: data?.sid || null,
    status: data?.status || null,
    code: data?.error_code ?? null,
  };
}

/** Parse MORNING_SMS_TO env into unique E.164 numbers. */
export function parseRecipients(raw) {
  if (!raw || typeof raw !== "string") return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(/[,\s]+/)) {
    const t = part.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
