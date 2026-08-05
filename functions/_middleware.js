// Protect Staff routes and internal resources before Pages serves static files.
// Login and the short legacy-session bridge remain public by necessity.

import { verifySessionToken } from "./lib/auth.js";
import { STAFF_SESSION_COOKIE } from "./lib/endpoint-guards.js";

const PUBLIC_STAFF_PATHS = new Set(["/staff/login", "/staff/access"]);

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const segment of cookieHeader.split(";")) {
    const [key, ...value] = segment.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function isStaffAsset(pathname) { return pathname.startsWith("/staff/assets/"); }

function accessUrl(url) {
  const access = new URL("/staff/access", url.origin);
  access.searchParams.set("return", `${url.pathname}${url.search}`);
  return access;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/staff") || PUBLIC_STAFF_PATHS.has(pathname) || isStaffAsset(pathname)) return context.next();

  const token = readCookie(context.request, STAFF_SESSION_COOKIE);
  const secret = context.env.JWT_SECRET;
  if (token && secret) {
    try {
      const payload = await verifySessionToken(token, secret);
      if (payload.role === "staff") return context.next();
    } catch { /* Treat bad or expired cookies exactly like no session. */ }
  }
  return Response.redirect(accessUrl(url), 302);
}
