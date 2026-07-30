// Shared OpenRouter chat helper for Workers that need an LLM without a
// direct Anthropic subscription. Prefer OPENROUTER_API_KEY; optional
// OPENROUTER_MODEL overrides the default.
//
// Default is Gemini 2.5 Flash Lite — cheap paid, reliable JSON, already
// smoke-tested on Eben's OpenRouter credits. Free (:free) routes are $0/token
// but often upstream-rate-limited; kept as last-resort fallbacks on 429.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Cheap paid default — good JSON following, tiny $ cost. */
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash-lite";

/** Tried in order when the chosen model returns 429 or empty content. */
export const OPENROUTER_FALLBACK_MODELS = Object.freeze([
  "google/gemini-2.5-flash-lite",
  "meta-llama/llama-3.1-8b-instruct",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
]);

/**
 * @param {object} env
 * @param {{ system?: string, user: string, maxTokens?: number, model?: string }} opts
 * @returns {Promise<{ text?: string, model?: string, error?: string, raw?: string }>}
 */
export async function openRouterChat(env, { system, user, maxTokens = 1000, model } = {}) {
  const apiKey = env?.OPENROUTER_API_KEY;
  if (!apiKey) return { error: "OPENROUTER_API_KEY not configured" };
  if (!user || typeof user !== "string") return { error: "missing user content" };

  const preferred = model || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const chain = [preferred, ...OPENROUTER_FALLBACK_MODELS.filter((m) => m !== preferred)];

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  let lastError = null;
  for (const chosen of chain) {
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
      lastError = `openrouter request failed: ${err && err.message}`;
      continue;
    }

    if (res.status === 429) {
      lastError = `openrouter 429 on ${chosen}`;
      continue;
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 240);
      lastError = `openrouter ${res.status}: ${detail}`;
      // Auth / credit problems won't be fixed by switching models.
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        return { error: lastError };
      }
      continue;
    }

    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      lastError = "openrouter empty response";
      continue;
    }
    return { text, model: chosen };
  }

  return { error: lastError || "openrouter failed" };
}

export const __test = {
  OPENROUTER_URL,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_FALLBACK_MODELS,
};
