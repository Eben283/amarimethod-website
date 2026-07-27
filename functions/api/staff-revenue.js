// Cloudflare Pages Function: GET /api/staff-revenue
// Read-only, staff-authenticated Stripe revenue summary. Stripe credentials stay
// in the Pages environment; the browser receives only aggregate monthly totals.

import { requireStaffAuth, corsHeaders } from '../lib/endpoint-guards.js';
import { getStaffRevenue } from '../lib/staff-revenue.js';

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get('Origin')),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get('Origin') || '';
  const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

  try {
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;
    if (!context.env.STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: 'Stripe revenue is not configured' }), { status: 500, headers });
    }

    const summary = await getStaffRevenue(context.env.STRIPE_SECRET_KEY);
    return new Response(JSON.stringify(summary), { status: 200, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[staff-revenue] failed:', detail);
    return new Response(JSON.stringify({ error: 'Unable to load Stripe revenue' }), { status: 422, headers });
  }
}
