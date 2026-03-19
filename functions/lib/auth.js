// Shared auth utilities for Cloudflare Pages Functions
// Extracted from duplicated verifySessionToken() across API files

/**
 * Verify an HMAC-SHA256 session token (JWT-like).
 * Checks signature validity and expiry.
 * @param {string} tokenString - The token from Authorization header
 * @param {string} secret - JWT_SECRET env var
 * @returns {object} Decoded payload
 * @throws {Error} If token is invalid, expired, or malformed
 */
export async function verifySessionToken(tokenString, secret) {
  const parts = tokenString.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(body));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

/**
 * Verify a GHL webhook secret header.
 * @param {Request} request - The incoming request
 * @param {string} expectedSecret - GHL_WEBHOOK_SECRET env var
 * @returns {boolean} True if valid
 */
export function verifyWebhookSecret(request, expectedSecret) {
  if (!expectedSecret) return false;
  const headerSecret = request.headers.get("X-Webhook-Secret");
  return headerSecret === expectedSecret;
}
