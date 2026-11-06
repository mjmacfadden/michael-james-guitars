import { log } from './log.js';

export const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']);
const ORDER_REF_RE = /^ord_[a-f0-9]{32}$/;
const MAX_LINE_PAGES = 20;
const ack = (b) => ({ status: 200, body: { ok: true, ...b } });
const retry = (error, status = 503) => ({ status, body: { ok: false, error } }); // non-2xx => Stripe retries
const idOf = (x) => (typeof x === 'string' ? x : x?.id ?? null);

export async function fetchAllLineItems(stripe, sessionId) {
  const all = [];
  let after;
  for (let p = 0; p < MAX_LINE_PAGES; p++) {
    const res = await stripe.checkout.sessions.listLineItems(sessionId, after ? { limit: 100, starting_after: after } : { limit: 100 });
    if (!res || !Array.isArray(res.data)) throw new Error('bad list response');
    all.push(...res.data);
    if (!res.has_more) return all;
    if (!res.data.length) throw new Error('has_more with empty page');
    after = res.data[res.data.length - 1].id;
  }
  throw new Error('too many pages');
}

/** Compare Stripe's session + ALL line items with the immutable server snapshot. */
export function verifyPaidSession({ session, lineItems, order }) {
  const { lines, amountSubtotal, shippingAmount, shippingRateId, currency } = order;
  if (session.currency !== currency) return { ok: false, reason: 'currency_mismatch' };
  if (!Array.isArray(lineItems) || !lineItems.length) return { ok: false, reason: 'no_line_items' };
  if (lineItems.length !== lines.length) return { ok: false, reason: 'line_count_mismatch' };
  const byPrice = new Map(lines.map((l) => [l.stripePriceId, l]));
  const seen = new Set();
  const items = [];
  for (const li of lineItems) {
    const pid = idOf(li.price);
    const ex = byPrice.get(pid);
    if (!ex) return { ok: false, reason: 'unknown_price' };
    if (seen.has(pid)) return { ok: false, reason: 'duplicate_price' };
    seen.add(pid);
    if (li.quantity !== ex.qty) return { ok: false, reason: 'quantity_mismatch' };
    if (li.currency !== currency) return { ok: false, reason: 'currency_mismatch' };
    if (typeof li.price === 'object' && li.price.unit_amount !== ex.unitAmountCents) return { ok: false, reason: 'unit_amount_mismatch' };
    if (li.amount_subtotal !== ex.unitAmountCents * ex.qty) return { ok: false, reason: 'line_amount_mismatch' };
    if ((li.amount_discount || 0) !== 0 || (li.amount_tax || 0) !== 0) return { ok: false, reason: 'unexpected_discount_or_tax' };
    items.push({ productId: ex.productId, variantId: ex.variantId, qty: ex.qty, unitAmountCents: ex.unitAmountCents, stripePriceId: pid });
  }
  if (session.amount_subtotal !== amountSubtotal) return { ok: false, reason: 'subtotal_mismatch' };
  const opts = session.shipping_options;
  if (!Array.isArray(opts) || opts.length !== 1 || idOf(opts[0].shipping_rate) !== shippingRateId || opts[0].shipping_amount !== shippingAmount) return { ok: false, reason: 'shipping_option_mismatch' };
  const td = session.total_details || {};
  if (idOf(session.shipping_cost?.shipping_rate) !== shippingRateId || session.shipping_cost?.amount_total !== shippingAmount || td.amount_shipping !== shippingAmount) return { ok: false, reason: 'shipping_mismatch' };
  if ((td.amount_discount || 0) !== 0 || (td.amount_tax || 0) !== 0) return { ok: false, reason: 'unexpected_discount_or_tax' };
  if (session.amount_total !== amountSubtotal + shippingAmount) return { ok: false, reason: 'total_mismatch' };
  return { ok: true, items, amountTotal: session.amount_total };
}

export async function handleStripeWebhook({ cfg, stripe, store, rawBody, signature, fetchLineItems }) {
  if (!cfg.webhookSecret || !stripe) return retry('not_configured');
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature) return { status: 400, body: { ok: false, error: 'invalid_signature' } };
  let event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret); } catch { return { status: 400, body: { ok: false, error: 'invalid_signature' } }; }

  if (!HANDLED.has(event.type)) return ack({ ignored: true });
  const s = event.data?.object;
  if (!s || s.object !== 'checkout.session' || typeof s.id !== 'string') return ack({ ignored: true, reason: 'invalid_object' });
  if (event.livemode !== false || s.livemode !== false || !s.id.startsWith('cs_test_')) { log('webhook.ignored', { event_id: event.id, reason: 'wrong_mode' }); return ack({ ignored: true, reason: 'wrong_mode' }); }
  if (event.account) { log('webhook.ignored', { event_id: event.id, reason: 'connected_account' }); return ack({ ignored: true, reason: 'wrong_account' }); }
  const meta = s.metadata || {};
  if (meta.store_id !== cfg.storeId) return ack({ ignored: true, reason: meta.store_id ? 'other_store' : 'untagged' }); // e.g. legacy Payment Links
  if (s.mode !== 'payment') return ack({ ignored: true, reason: 'unexpected_mode' });
  const orderRef = meta.order_ref;
  if (typeof orderRef !== 'string' || !ORDER_REF_RE.test(orderRef) || s.client_reference_id !== orderRef) { log('webhook.rejected', { event_id: event.id, reason: 'bad_order_ref' }); return retry('order_ref_invalid', 500); }

  let order;
  try { order = await store.getOrder(orderRef); } catch { return retry('storage_unavailable'); }
  if (!order || order.storeId !== cfg.storeId) { log('webhook.rejected', { event_id: event.id, reason: 'unknown_order_ref' }); return retry('unknown_order_ref'); }
  if (order.sessionId && order.sessionId !== s.id) { log('webhook.rejected', { event_id: event.id, reason: 'session_mismatch' }); return retry('session_mismatch', 500); }
  if (String(order.catalogVersion) !== meta.catalog_version) { log('webhook.rejected', { event_id: event.id, reason: 'catalog_version_mismatch' }); return retry('order_verification_failed', 500); }

  let state; let paid = null;
  if (event.type === 'checkout.session.async_payment_failed') state = 'failed';
  else if (s.payment_status === 'paid') state = 'paid';
  else if (s.payment_status === 'unpaid' && event.type === 'checkout.session.completed') state = 'pending'; // delayed method
  else { log('webhook.rejected', { event_id: event.id, reason: 'unexpected_payment_status' }); return retry('unexpected_payment_status', 500); }

  if (state === 'paid') {
    let lineItems;
    try { lineItems = fetchLineItems ? await fetchLineItems(s.id) : await fetchAllLineItems(stripe, s.id); } catch { return retry('line_items_unavailable'); }
    const verdict = verifyPaidSession({ session: s, lineItems, order });
    if (!verdict.ok) { log('webhook.rejected', { event_id: event.id, reason: verdict.reason }); return retry('order_verification_failed', 500); }
    paid = { items: verdict.items, amountTotal: verdict.amountTotal, currency: s.currency, paymentIntentId: idOf(s.payment_intent) };
  }
  let r;
  try { r = await store.recordWebhook({ eventId: event.id, eventType: event.type, orderRef, sessionId: s.id, state, paymentStatus: s.payment_status, paid }); }
  catch { return retry('persist_failed', 500); }
  if (r.duplicate) return ack({ duplicate: true });
  if (r.missing) return retry('unknown_order_ref');
  if (r.sessionMismatch) return retry('session_mismatch', 500);
  log('webhook.processed', { event_id: event.id, event_type: event.type, session_id: s.id, order_ref: orderRef, status: r.state });
  return ack({ duplicate: false, state: r.state });
}
