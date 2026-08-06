/**
 * Vendor product pricing rules.
 *
 * IDENTICAL COPY. This file lives in both `Fiesta/fiesta-nextjs/lib/pricing.js`
 * and `fiesta_sapakim/lib/pricing.js`. The two apps deploy separately and share
 * no package, so the copies must stay byte-for-byte equal. Run
 * `node scripts/check-pricing-sync.mjs` from the workspace root to verify.
 *
 * The customer discount and the Fiesta commission are both percentages of the
 * supplier's list price. The commission is therefore unaffected by how large a
 * discount the agent negotiates — the cost of the discount falls on the supplier.
 */

/** Warn the agent when the supplier is left with less than this share of list. */
export const LOW_MARGIN_THRESHOLD_PERCENT = 60;

/** Parse a price that may arrive as a formatted string. Invalid input is 0. */
export function toAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (value == null || value === '') return 0;
  const cleaned = String(value).replace(/[^\d.]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parse a percentage and clamp it to 0-100. Invalid input is 0. */
export function toPercent(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

/** What the customer pays, in whole shekels. */
export function clientPrice(listPrice, discountPercent) {
  const list = toAmount(listPrice);
  if (!list) return 0;
  return Math.round(list * (1 - toPercent(discountPercent) / 100));
}

/** What the customer saves. Always equals list minus the rounded client price. */
export function savings(listPrice, discountPercent) {
  const list = toAmount(listPrice);
  if (!list) return 0;
  return list - clientPrice(list, discountPercent);
}

/** Fiesta's cut, in whole shekels, taken off the list price. */
export function commission(listPrice, commissionPercent) {
  const list = toAmount(listPrice);
  if (!list) return 0;
  return Math.round(list * toPercent(commissionPercent) / 100);
}

/** Share of the list price the supplier keeps. Goes negative when overcommitted. */
export function supplierNetPercent(discountPercent, commissionPercent) {
  return 100 - toPercent(discountPercent) - toPercent(commissionPercent);
}

export function isLowMargin(discountPercent, commissionPercent) {
  return supplierNetPercent(discountPercent, commissionPercent) < LOW_MARGIN_THRESHOLD_PERCENT;
}

/** Every derived number for one product, from its list price. */
export function priceProduct(listPrice, discountPercent, commissionPercent) {
  const list = toAmount(listPrice);
  return {
    listPrice: list,
    clientPrice: clientPrice(list, discountPercent),
    savings: savings(list, discountPercent),
    commission: commission(list, commissionPercent),
  };
}
