// Reuse the existing Amari Gmail adapter rather than creating a second credential or sender
// implementation. That adapter verifies the stored actor-specific grant and Gmail SendAs identity
// before delivery, and keeps the refresh token in the shared private KV namespace.

import { sendGmailEmail } from "../../crm-mirror-worker/src/gmail.js";

export async function sendAssessmentTestEmail(env, { to, subject, text }) {
  try {
    const result = await sendGmailEmail(env, { actor: "Eben", to, subject, text });
    return { success: true, messageId: result.id };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
}
