import crypto from 'node:crypto';
import { assertReturnUrlAllowed, assertTestModeOrFail, INTEGRATION_PREFIX } from './config.js';
import { validateCart } from './cartValidate.js';
import { log } from './log.js';

export const REQUEST_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/;
const STRIPE_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const EXPIRY_MARGIN_S = 120;
const err = (status, error, message, extra = {}) => ({ status, body: { ok: false, error, message, ...extra } });

export function randomLetters(n = 8) {
  const L = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  while (out.length < n) { const b = crypto.randomBytes(1)[0]; if (b < 234) out += L[b % 26]; }
  return out;
}
export function cartFingerprint(storeId, items) {
  return crypto.createHash('sha256').update(JSON.stringify([storeId, items.map(({ product, variant, qty }) => [product.id, variant.id, qty])])).digest('hex');
}
export function requestDocId(storeId, requestKey) {
  return crypto.createHash('sha256').update(`${storeId}:${requestKey}`).digest('hex');
}
export function snapshotLines(items) {
  return items.map(({ product, variant, qty }) => ({
    productId: product.id, variantId: variant.id, productName: product.name, variantLabel: variant.label,
    stripePriceId: variant.stripePriceId, unitAmountCents: variant.unitAmountCents, qty,
  }));
}

/** Pure; random inputs are generated once per request key and persisted with the params. */
export function buildSessionParams({ cfg, catalog, items, orderRef, integrationSuffix }) {
  assertTestModeOrFail(cfg);
  for (const u of [cfg.successUrl, cfg.cancelUrl]) {
    if (!assertReturnUrlAllowed(u, cfg.allowedReturnUrlPrefixes)) throw Object.assign(new Error('Return URL not allowed'), { code: 'BAD_RETURN_URL' });
  }
  const s = new URL(cfg.successUrl);
  return {
    mode: 'payment',
    line_items: items.map(({ variant, qty }) => ({ price: variant.stripePriceId, quantity: qty })),
    success_url: `${s.origin}${s.pathname}?session_id={CHECKOUT_SESSION_ID}`, // display only, never proof of payment
    cancel_url: cfg.cancelUrl,
    shipping_address_collection: { allowed_countries: [...catalog.shipping.allowedCountries] },
    phone_number_collection: { enabled: true },
    shipping_options: [{ shipping_rate: catalog.shipping.stripeShippingRateId }], // one flat $5 rate per order
    metadata: { store_id: cfg.storeId, order_ref: orderRef, catalog_version: String(catalog.catalogVersion) },
    payment_intent_data: { metadata: { store_id: cfg.storeId, order_ref: orderRef } },
    client_reference_id: orderRef,
    integration_identifier: `${INTEGRATION_PREFIX}${integrationSuffix}`,
    // payment_method_types intentionally omitted (dynamic payment methods).
  };
}

/**
 * Flow: validate -> transactional reserve (request + order snapshot) BEFORE Stripe ->
 * Stripe create with persisted params + stable idempotency key -> bind session.
 * Concurrent/retried requests with the same key share one Firestore row and one Stripe idempotency key,
 * so Stripe returns the same session (or an in-flight conflict we surface as retryable).
 */
export async function createCheckout({ cfg, catalogIndex, stripe, store, body, requestKey }) {
  try { assertTestModeOrFail(cfg); } catch { return err(503, 'not_configured', 'Checkout is not available right now.'); }
  if (!stripe) return err(503, 'not_configured', 'Checkout is not available right now.');
  if (typeof requestKey !== 'string' || !REQUEST_KEY_RE.test(requestKey)) return err(400, 'invalid_idempotency_key', 'A valid Idempotency-Key header is required.');
  const catalog = catalogIndex.catalog;
  const v = validateCart(catalogIndex, body, catalog.limits);
  if (!v.ok) return err(v.status, v.error, v.message, { productId: v.productId, variantId: v.variantId });
  const fingerprint = cartFingerprint(cfg.storeId, v.items);
  const requestId = requestDocId(cfg.storeId, requestKey);

  let reserved;
  try {
    reserved = await store.reserveRequest(requestId, fingerprint, () => {
      const orderRef = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
      const params = buildSessionParams({ cfg, catalog, items: v.items, orderRef, integrationSuffix: randomLetters(8) });
      const lines = snapshotLines(v.items);
      const subtotal = lines.reduce((n, l) => n + l.unitAmountCents * l.qty, 0);
      const snapshot = { lines, amountSubtotal: subtotal, shippingAmount: catalog.shipping.amountCents, shippingRateId: catalog.shipping.stripeShippingRateId, currency: catalog.currency, catalogVersion: catalog.catalogVersion };
      return {
        request: { orderRef, stripeIdempotencyKey: `mjg-${cfg.storeId}-cs-${requestId.slice(0, 40)}`, paramsJson: JSON.stringify(params) },
        order: { orderRef, storeId: cfg.storeId, requestId, ...snapshot },
      };
    });
  } catch (e) {
    log('checkout.persist_failed', { code: e?.code === 'BAD_RETURN_URL' ? 'return_url' : 'reserve' });
    return err(503, 'storage_unavailable', 'Checkout is temporarily unavailable. Please try again.', { retryable: true });
  }
  if (reserved.conflict) return err(409, 'idempotency_key_conflict', 'This checkout attempt was for a different cart. Please try again.', { rotateKey: true });
  const row = reserved.row;
  const nowS = Math.floor(Date.now() / 1000);
  if (row.sessionId && row.sessionUrl) {
    if (row.sessionExpiresAt && row.sessionExpiresAt - EXPIRY_MARGIN_S <= nowS) return err(409, 'checkout_expired', 'That checkout expired. Please try again.', { rotateKey: true });
    return { status: 200, body: { ok: true, url: row.sessionUrl, reused: true } };
  }
  if (Date.now() - Date.parse(row.createdAt) > STRIPE_IDEMPOTENCY_WINDOW_MS) return err(409, 'checkout_expired', 'That checkout attempt is too old. Please try again.', { rotateKey: true });

  let session;
  try {
    session = await stripe.checkout.sessions.create(JSON.parse(row.paramsJson), { idempotencyKey: row.stripeIdempotencyKey });
  } catch (e) {
    const idem = e && (e.type === 'StripeIdempotencyError' || e.rawType === 'idempotency_error');
    log('checkout.stripe_error', { order_ref: row.orderRef, code: idem ? 'idempotency' : 'stripe' });
    if (idem) return err(409, 'checkout_in_progress', 'Checkout is starting, please retry.', { retryable: true });
    // Price / shipping-rate IDs are account- and mode-scoped: a key for another account or mode gets
    // resource_missing here, so a wrong-account key can never produce a session. Fail closed.
    if (e && (e.code === 'resource_missing' || e.type === 'StripePermissionError' || e.type === 'StripeAuthenticationError')) {
      log('checkout.stripe_error', { order_ref: row.orderRef, code: e.code === 'resource_missing' ? 'catalog_not_in_account' : 'key_permission' });
      return err(503, 'not_configured', 'Checkout is not available right now.');
    }
    return err(502, 'checkout_unavailable', 'Unable to start checkout. Please try again.', { retryable: true });
  }
  if (!session || typeof session.id !== 'string' || !session.id.startsWith('cs_test_') || typeof session.url !== 'string' ||
      !session.url.startsWith('https://checkout.stripe.com/') || session.livemode !== false || session.metadata?.order_ref !== row.orderRef) {
    log('checkout.invalid_session', { order_ref: row.orderRef });
    return err(502, 'checkout_unavailable', 'Unable to start checkout. Please try again.', { retryable: true });
  }
  try {
    await store.setRequestSession(requestId, row.orderRef, { id: session.id, url: session.url, expiresAt: Number.isInteger(session.expires_at) ? session.expires_at : null });
  } catch {
    log('checkout.persist_failed', { order_ref: row.orderRef, code: 'bind_session' }); // retry replays same idempotency key
  }
  log('checkout.session_created', { order_ref: row.orderRef, session_id: session.id });
  return { status: 200, body: { ok: true, url: session.url } };
}
