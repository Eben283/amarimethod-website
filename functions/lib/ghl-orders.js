// Shared GHL order helpers used by both the Pages-side session-ledger and
// the series-reconcile-worker. Transport-agnostic — callers pass their own
// `fetchOrderDetail` function so the helper doesn't need to know whether
// it's running in a Pages Function (context.env) or a Cloudflare Worker (env).
//
// Reason this lives in functions/lib/ rather than at the repo root: the worker
// already imports session-ledger.js from this same directory, so the import
// path stays consistent.

// Lowered from 5 → 3 after the 2026-06-03 staff-balances incident hit
// Cloudflare's per-Worker connection limit when 5 contacts ran in parallel
// each fanning out 5 hydration calls (5 × 5 = 25 concurrent outbound).
// 3 keeps a single contact's worst case at ~3 simultaneous outbound,
// which combined with staff-balances' CONCURRENCY=2 stays safely under
// the ~6-connection cap. Per-contact wall time only goes up by ~30% for
// contacts with >5 POS orders (rare).
const DEFAULT_CONCURRENCY = 3;

/**
 * Hydrate a list of GHL order summary records with their full `items[]` from
 * /payments/orders/{id}.
 *
 * Why this exists: GHL's /payments/orders LIST endpoint omits items[] for
 * orders with sourceType="point_of_sale" (and sometimes for payment_link
 * orders too — coverage is inconsistent). classifyOrder in session-ledger.js
 * needs items[0].product._id to recognize the product. Without hydration,
 * POS package purchases silently classify as type="other" / sessions=0.
 * (2026-06-03 Jenn Kadri incident.)
 *
 * Behavior:
 *   - Skip the detail fetch entirely when an order already has items[].
 *   - Cap concurrent fetches (default 5) so a contact with 50 POS orders
 *     doesn't fan out 50 parallel subrequests and risk Cloudflare's
 *     1000-subrequest cap.
 *   - On per-order detail-fetch failure, return the order with a
 *     `__hydration_failed: true` flag so classifyOrder can push an
 *     ambiguity into the derived ledger (which then drops confidence to
 *     "low", which then blocks the worker from writing a bad value).
 *   - Merge surgically: only the `items` field is taken from the detail
 *     response. status/amount/createdAt/sourceType stay from the LIST
 *     record (avoids accidental clobbering if detail and list disagree
 *     during a partial-refund timing window or similar edge case).
 *
 * @param {(orderId: string) => Promise<object>} fetchOrderDetail
 *        Caller-provided fetcher. Takes an order _id, returns the parsed
 *        JSON body of /payments/orders/{id}. Must throw on non-OK status
 *        or network errors so the helper can mark the order failed.
 * @param {object[]} ordersList
 *        Orders from the LIST endpoint. May or may not include items[].
 * @param {object} [options]
 * @param {number} [options.concurrency=5]
 *        Max parallel detail fetches.
 *
 * @returns {Promise<object[]>}
 *        Same length as ordersList, in the same order. Each entry is
 *        either the original (if items[] was present), the hydrated
 *        version (if fetch succeeded), or the original tagged with
 *        __hydration_failed (if fetch failed).
 */
export async function hydrateOrders(fetchOrderDetail, ordersList, options = {}) {
  if (!Array.isArray(ordersList) || ordersList.length === 0) return [];
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  // Bucket orders that need hydration vs ones that don't. Preserve original
  // order by writing into a positionally-indexed array.
  // Resolve the order id once per order — GHL is inconsistent across endpoints
  // and `ghl-purchase-webhook.js:332` already established the
  // `_id || id || orderId` fallback. If a callsite for hydrateOrders ever
  // hits an `id`-only shape and we only check `_id`, the order silently
  // skips hydration AND skips the __hydration_failed flag — meaning
  // classifyOrder returns confident "other"/0 sessions and the worker
  // could write a destructive zero. Match the webhook's fallback to keep
  // the safety net intact.
  const result = new Array(ordersList.length);
  const needsHydration = [];
  const resolvedIds = new Array(ordersList.length);
  for (let i = 0; i < ordersList.length; i++) {
    const o = ordersList[i];
    if (Array.isArray(o?.items) && o.items.length > 0) {
      result[i] = o;
      continue;
    }
    // Skip hydration for calendar-source orders. GHL auto-creates one of
    // these for every appointment booking on a calendar with Accept Payments
    // enabled. classifyOrder returns type="placeholder" for them
    // immediately based on sourceType — without ever reading items[]. So
    // fetching detail for these orders is pure subrequest waste. Danny
    // Blumrich has 14 of these; Zach Taylor ~12. The 2026-06-03 incident
    // was caused by these wasted hydration calls pushing the staff-balances
    // Worker over Cloudflare's per-invocation subrequest cap.
    const sourceType = (o?.sourceType || o?.source?.type || "").toLowerCase();
    if (sourceType === "calendar") {
      result[i] = o;
      continue;
    }
    const orderId = o?._id || o?.id || o?.orderId || null;
    resolvedIds[i] = orderId;
    if (!orderId) {
      // Can't hydrate without an id — mark failed so deriveLedger drops
      // confidence rather than confidently classifying as "other".
      result[i] = { ...o, __hydration_failed: true, __hydration_reason: "no-order-id" };
    } else {
      needsHydration.push(i);
    }
  }

  // Chunked parallel fetch.
  for (let start = 0; start < needsHydration.length; start += concurrency) {
    const chunkIndices = needsHydration.slice(start, start + concurrency);
    await Promise.all(
      chunkIndices.map(async (i) => {
        const o = ordersList[i];
        try {
          const detail = await fetchOrderDetail(resolvedIds[i]);
          // Pluck items[] only — leave status/amount/sourceType from LIST
          // intact. If detail has no items either, mark failed.
          if (Array.isArray(detail?.items) && detail.items.length > 0) {
            result[i] = { ...o, items: detail.items };
          } else {
            result[i] = { ...o, __hydration_failed: true, __hydration_reason: "detail-empty-items" };
          }
        } catch (err) {
          result[i] = {
            ...o,
            __hydration_failed: true,
            __hydration_reason: err?.message || String(err),
          };
        }
      }),
    );
  }

  return result;
}
