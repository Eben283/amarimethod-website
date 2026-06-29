// Cloud port of detect-price-objections.mjs.
// Reads transcripts from KV (transcript:{msgId}) instead of local TXT files.
// Requires: call touches in conv:{contactId} have a `msgId` field, which is stamped
// by conversation-cache-worker/src/sync.js (added alongside this Worker).
// Fail-soft: any error per contact is logged but doesn't block.

const SIGNAL = /\b(insurance|medicare|medicaid|afford|too expensive|can'?t afford|out[ -]of[ -]pocket|fixed income|on a budget|how much (is|does|would|are)|worth it|worth the|\bhsa\b|\bfsa\b|cover(ed)? by|copay|deductible)\b/i;

// Returns Set<contactId> for contacts whose call transcripts contain a price/value signal.
export async function detectPriceObjections(env, dueIds) {
  const kv = env.PORTAL_KV;
  const flagged = new Set();

  for (const contactId of dueIds) {
    try {
      const conv = await kv.get(`conv:${contactId}`, "json");
      if (!conv) continue;

      const callMsgIds = (conv.touches || [])
        .filter((t) => t.kind === "call" && t.msgId)
        .map((t) => t.msgId);

      for (const msgId of callMsgIds) {
        const transcript = await kv.get(`transcript:${msgId}`, "json");
        if (!transcript?.text || transcript.noRecording) continue;
        if (SIGNAL.test(transcript.text)) {
          flagged.add(contactId);
          break;
        }
      }
    } catch (e) {
      console.error(`[price-objections] error for ${contactId}: ${e.message?.slice(0, 80)}`);
    }
  }

  console.error(`[price-objections] flagged ${flagged.size} of ${dueIds.size} due contacts`);
  return flagged;
}
