// Completes the signed, one-time Amari-owned Gmail grant. No delivery path is
// activated here: the callback only verifies and stores the bounded grant.

import {
  AMARI_MAIL_CALLBACK_URL,
  AMARI_MAIL_SCOPES,
  amariMailKey,
  amariMailOAuthConfigured,
  consumeAmariMailOAuthState,
  resolveAmariMailbox,
} from "../lib/amari-mail-oauth.js";
import {
  consumeStaffCalendarOAuthState,
  exchangeAndStoreStaffCalendarGrant,
} from "../lib/staff-calendar-oauth.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const SEND_AS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";
const SUCCESS_URL = "https://www.amarimethod.com/staff/operations?amariMail=connected";
const FAILURE_URL = "https://www.amarimethod.com/staff/operations?amariMail=failed";

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

async function json(response) {
  if (!response.ok) throw new Error("Google verification failed");
  return response.json();
}

function hasVerifiedSendAs(payload, requiredSender) {
  const accepted = new Set((payload?.sendAs || [])
    .filter((identity) => identity?.isPrimary || String(identity?.verificationStatus || "").toLowerCase() === "accepted")
    .map((identity) => String(identity.sendAsEmail || "").trim().toLowerCase()));
  return accepted.has(requiredSender);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") || "";
  const calendarGrant = await consumeStaffCalendarOAuthState(context.env, state);
  if (calendarGrant) {
    const code = url.searchParams.get("code") || "";
    if (!code || url.searchParams.has("error")) return redirect("https://www.amarimethod.com/staff/operations?staffCalendar=failed");
    try {
      await exchangeAndStoreStaffCalendarGrant(context, calendarGrant, code);
      return redirect("https://www.amarimethod.com/staff/operations?staffCalendar=connected");
    } catch {
      return redirect("https://www.amarimethod.com/staff/operations?staffCalendar=failed");
    }
  }
  if (!amariMailOAuthConfigured(context.env)) return redirect(FAILURE_URL);
  const grantRequest = await consumeAmariMailOAuthState(context.env, state);
  const code = url.searchParams.get("code") || "";
  if (!grantRequest || !code || url.searchParams.has("error")) return redirect(FAILURE_URL);
  const mailbox = resolveAmariMailbox(grantRequest.actor);
  if (grantRequest.requiredSender !== mailbox.sender) return redirect(FAILURE_URL);

  try {
    const token = await json(await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: context.env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID,
        client_secret: context.env.AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: AMARI_MAIL_CALLBACK_URL,
        grant_type: "authorization_code",
      }).toString(),
    }));
    if (!token.access_token || !token.refresh_token) return redirect(FAILURE_URL);
    const grantedScopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
    if (!AMARI_MAIL_SCOPES.every((scope) => grantedScopes.has(scope))) return redirect(FAILURE_URL);

    const providerHeaders = { Authorization: `Bearer ${token.access_token}` };
    const [profile, senderSettings] = await Promise.all([
      fetch(PROFILE_URL, { headers: providerHeaders }).then(json),
      fetch(SEND_AS_URL, { headers: providerHeaders }).then(json),
    ]);
    const profileEmail = String(profile?.emailAddress || "").trim().toLowerCase();
    if (profileEmail !== mailbox.sender || !hasVerifiedSendAs(senderSettings, mailbox.sender)) return redirect(FAILURE_URL);

    const expiry = Date.now() + Number(token.expires_in || 3600) * 1000;
    const tokenKeys = ["access_token", "refresh_token", "token_expiry"].map((name) => amariMailKey(mailbox.actor, name));
    const statusKey = amariMailKey(mailbox.actor, "grant_status");
    await context.env.PORTAL_KV.delete(statusKey);
    try {
      await Promise.all([
        context.env.PORTAL_KV.put(tokenKeys[0], token.access_token),
        context.env.PORTAL_KV.put(tokenKeys[1], token.refresh_token),
        context.env.PORTAL_KV.put(tokenKeys[2], String(expiry)),
      ]);
      // This marker is written last. Readiness and the Gmail adapter require it,
      // so incomplete token storage can never become an active grant.
      await context.env.PORTAL_KV.put(statusKey, JSON.stringify({
        actor: mailbox.actor,
        profileEmail,
        verifiedSendAs: [mailbox.sender],
        scopes: AMARI_MAIL_SCOPES,
        verifiedAt: new Date().toISOString(),
        deliveryEnabled: false,
        replySyncEnabled: false,
      }));
    } catch (error) {
      await Promise.allSettled([...tokenKeys, statusKey].map((key) => context.env.PORTAL_KV.delete(key)));
      throw error;
    }
    return redirect(SUCCESS_URL);
  } catch {
    return redirect(FAILURE_URL);
  }
}
