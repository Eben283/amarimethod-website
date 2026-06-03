// Shared GHL order helpers used by both the Pages-side session-ledger and
// the series-reconcile-worker. Transport-agnostic — callers pass their own
// `fetchOrderDetail` function so the helper doesn't need to know whether
// it's running in a Pages Function (context.env) or a Cloudflare Worker (env).
//
// Reason this lives in functions/lib/ rather than at the repo root: the worker
// already imports session-ledger.js from this same directory, so the import
// path stays consistent.

const DEFAULT_CONCURRENCY = 5;

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
  const result = new Array(ordersList.length);
  const needsHydration = [];
  for (let i = 0; i < ordersList.length; i++) {
    const o = ordersList[i];
    if (Array.isArray(o?.items) && o.items.length > 0) {
      result[i] = o;
    } else if (!o?._id) {
      // Can't hydrate without an id — pass through unchanged.
      result[i] = o;
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
          const detail = await fetchOrderDetail(o._id);
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
