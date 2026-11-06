import { resolveVariant } from './catalog.js';

const LINE_KEYS = new Set(['productId', 'variantId', 'qty']);
const BODY_KEYS = new Set(['items']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function bad(error, message, extra = {}) {
  return { ok: false, status: 400, error, message, ...extra };
}

/**
 * Strictly validate { items: [{ productId, variantId, qty }] } against the server catalog.
 * - only those keys are accepted (no prices, no Stripe ids, no legacy option names)
 * - qty must be a JSON integer 1..maxQtyPerVariant (never coerced or truncated)
 * - duplicate product+variant lines are aggregated and re-checked against the max
 * Returns items sorted by (productId, variantId) so equal carts normalize identically.
 */
export function validateCart(index, body, limits) {
  const maxQty = limits.maxQtyPerVariant;
  const minQty = limits.minQty;
  const maxLines = limits.maxLineItems;

  if (!isPlainObject(body)) return bad('invalid_body', 'JSON object required');
  for (const k of Object.keys(body)) {
    if (!BODY_KEYS.has(k)) return bad('unexpected_field', 'Only "items" is accepted');
  }
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return bad('empty_cart', 'Cart has no items');
  if (rawItems.length > maxLines) return bad('too_many_lines', `At most ${maxLines} lines`);

  const aggregated = new Map();
  for (const line of rawItems) {
    if (!isPlainObject(line)) return bad('invalid_line', 'Each line must be an object');
    for (const k of Object.keys(line)) {
      if (!LINE_KEYS.has(k)) return bad('unexpected_field', 'Lines accept only productId, variantId and qty');
    }
    const qty = line.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < minQty || qty > maxQty) {
      return bad('invalid_qty', `Quantity must be a whole number from ${minQty} to ${maxQty}`);
    }
    const resolved = resolveVariant(index, line);
    if (resolved.error) {
      return bad(resolved.error, 'An item in your cart is not available', {
        productId: resolved.productId,
        variantId: resolved.variantId,
      });
    }
    const key = `${resolved.product.id}\u0000${resolved.variant.id}`;
    const prev = aggregated.get(key);
    if (prev) {
      prev.qty += qty;
      if (prev.qty > maxQty) return bad('invalid_qty', `Total quantity per item cannot exceed ${maxQty}`);
    } else {
      aggregated.set(key, { product: resolved.product, variant: resolved.variant, qty });
    }
  }
  const items = [...aggregated.values()].sort((a, b) =>
    a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : a.variant.id < b.variant.id ? -1 : a.variant.id > b.variant.id ? 1 : 0,
  );
  return { ok: true, items };
}
