// Shared OpenRouter chat helper for Workers that need an LLM without a
// direct Anthropic subscription. Prefer OPENROUTER_API_KEY; optional
// OPENROUTER_MODEL overrides the default free model.
//
// Free models (:free) are $0/token. With ≥$10 lifetime OpenRouter credits
// the free-model daily cap is ~1000 req/day (else ~50). See OpenRouter limits.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Default free model — solid instruction following + large context. */
export const DEFAULT_OPENROUTER_FREE_MODEL = "google/gemma-4-31b-it:free";

/**
 * @param {object} env
 * @param {{ system?: string, user: string, maxTokens?: number, model?: string }} opts
 * @returns {Promise<{ text?: string, model?: string, error?: string, raw?: string }>}
 */
export async function openRouterChat(env, { system, user, maxTokens = 1000, model } = {}) {
  const apiKey = env?.OPENROUTER_API_KEY;
  if (!apiKey) return { error: "OPENROUTER_API_KEY not configured" };
  if (!user || typeof user !== "string") return { error: "missing user content" };

  const chosen = model || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_FREE_MODEL;
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.amarimethod.com/ops",
        "X-Title": "Amari Ops",
      },
      body: JSON.stringify({
        model: chosen,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages,
      }),
    });
  } catch (err) {
    return { error: `openrouter request failed: ${err && err.message}` };
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 240);
    return { error: `openrouter ${res.status}: ${detail}` };
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    return { error: "openrouter empty response", raw: JSON.stringify(data || {}).slice(0, 300) };
  }
  return { text, model: chosen };
}

export const __test = { OPENROUTER_URL, DEFAULT_OPENROUTER_FREE_MODEL };
