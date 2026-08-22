import { timingSafeEqual } from "./safe-equal.js";

export function verifyGhlWebhookSecret(env, provided, dedicatedKey) {
  const dedicated = dedicatedKey && env[dedicatedKey];
  if (dedicated) {
    return { configured: true, valid: timingSafeEqual(provided, dedicated) };
  }
  const current = env.GHL_WEBHOOK_SECRET;
  const replacement = env.GHL_WEBHOOK_SECRET_REPLACEMENT;
  const currentValid = current ? timingSafeEqual(provided, current) : false;
  const replacementValid = replacement ? timingSafeEqual(provided, replacement) : false;
  return { configured: Boolean(current || replacement), valid: currentValid || replacementValid };
}
