// Reuse the existing Amari Gmail adapter rather than creating a second credential or sender
// implementation. That adapter verifies the stored actor-specific grant and Gmail SendAs identity
// before delivery, and keeps the refresh token in the shared private KV namespace.

import { sendGmailEmail } from "../../crm-mirror-worker/src/gmail.js";

/** Send a transactional email through the existing verified Amari Gmail identity. */
export async function sendOwnedEmail(env, { to, subject, text, preheader, actor = "Eben" }) {
  try {
    const result = await sendGmailEmail(env, { actor, to, subject, text, preheader });
    return { success: true, messageId: result.id };
  } catch (error) {
    return { success: false, error: String(error?.message || error) };
  }
}

// Kept only for the already-proven, tightly allowlisted Assessment-email test.
export const sendAssessmentTestEmail = sendOwnedEmail;
