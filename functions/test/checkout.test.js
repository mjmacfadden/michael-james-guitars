import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout, buildSessionParams } from '../src/checkout.js';
import { buildConfig, assertReturnUrlAllowed } from '../src/config.js';
import { validateCart } from '../src/cartValidate.js';
import { catalogIndex, cfg, fakeStripe, newStore, KEY, P_STD, SHR } from './helpers.js';

const L = catalogIndex.catalog.limits;
const run = (o = {}) => createCheckout({ cfg: cfg(), catalogIndex, body: { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1 }] }, requestKey: KEY, ...o });
const mixed = { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 5 }] };

test('cart validation negatives: malformed ids, qty bounds/decimals/strings, forged fields', () => {
  const bads = [null, [], {}, { items: [] }, { items: 'x' }, { items: [{}] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 0 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 21 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1.5 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: '2' }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: -1 }] },
    { items: [{ productId: '../x', variantId: 'standard', qty: 1 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: '6', qty: 1 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 3, qty: 1 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1, price: 1 }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1, stripePriceId: 'price_evil' }] },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1 }], successUrl: 'https://evil.example/' },
    { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 15 }, { productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 6 }] },
    { items: Array.from({ length: 21 }, () => ({ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 1 })) }];
  for (const b of bads) assert.equal(validateCart(catalogIndex, b, L).ok, false, JSON.stringify(b)?.slice(0, 80));
});

test('qty cart: server price, ONE $5 shipping rate, US only, phone, metadata, no payment_method_types', async () => {
  const stripe = fakeStripe(); const { store, db } = newStore();
  const r = await run({ stripe, store, body: mixed });
  assert.equal(r.status, 200);
  const p = stripe.calls[0].params;
  assert.deepEqual(p.line_items, [{ price: P_STD, quantity: 5 }]);
  assert.deepEqual(p.shipping_options, [{ shipping_rate: SHR }]);
  assert.deepEqual(p.shipping_address_collection, { allowed_countries: ['US'] });
  assert.equal(p.phone_number_collection.enabled, true);
  assert.equal(p.payment_method_types, undefined);
  assert.equal(p.metadata.store_id, 'mjg'); assert.match(p.metadata.order_ref, /^ord_[a-f0-9]{32}$/); assert.equal(p.metadata.catalog_version, '2');
  assert.match(p.integration_identifier, /^mjg-cart-checkout-[a-z]{8}$/);
  assert.equal(p.success_url, 'https://michael-james-guitars.web.app/success.html?session_id={CHECKOUT_SESSION_ID}');
  const order = [...db.data.entries()].find(([k]) => k.startsWith('orders/'))[1];
  assert.equal(order.amountSubtotal, 7500); assert.equal(order.shippingAmount, 500); assert.equal(order.state, 'session_created');
});

test('snapshot is persisted BEFORE Stripe is called; storage failure => Stripe never called', async () => {
  const { store, db } = newStore();
  let seen = false;
  const stripe = fakeStripe(); const orig = stripe.checkout.sessions.create;
  stripe.checkout.sessions.create = async (...a) => { seen = [...db.data.keys()].some((k) => k.startsWith('orders/')); return orig(...a); };
  assert.equal((await run({ stripe, store })).status, 200); assert.equal(seen, true);
  const s2 = fakeStripe(); const down = newStore({ failOn: () => true });
  const r = await run({ stripe: s2, store: down.store, requestKey: 'another-key-0123456789' });
  assert.equal(r.status, 503); assert.equal(s2.calls.length, 0);
});

test('retry after network failure reuses identical params + idempotency key, one session', async () => {
  const stripe = fakeStripe({ fail: 1 }); const { store } = newStore();
  assert.equal((await run({ stripe, store })).status, 502);
  const r2 = await run({ stripe, store });
  assert.equal(r2.status, 200);
  assert.equal(stripe.calls[0].opts.idempotencyKey, stripe.calls[1].opts.idempotencyKey);
  assert.deepEqual(stripe.calls[0].params, stripe.calls[1].params);
  const r3 = await run({ stripe, store });
  assert.equal(r3.body.reused, true); assert.equal(r3.body.url, r2.body.url); assert.equal(stripe.calls.length, 2);
});

test('concurrent same-key requests yield a single session URL', async () => {
  const stripe = fakeStripe({ delayMs: 20 }); const { store, db } = newStore();
  const rs = await Promise.all(Array.from({ length: 5 }, () => run({ stripe, store })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(new Set(rs.map((r) => r.body.url)).size, 1);
  assert.equal([...db.data.keys()].filter((k) => k.startsWith('orders/')).length, 1);
});

test('same key + different cart => 409 conflict; bad key => 400', async () => {
  const stripe = fakeStripe(); const { store } = newStore();
  await run({ stripe, store });
  const r = await run({ stripe, store, body: mixed });
  assert.equal(r.status, 409); assert.equal(r.body.rotateKey, true);
  for (const k of [undefined, 'short', 'bad key with spaces!!!!', 'x'.repeat(80)]) assert.equal((await run({ stripe, store, requestKey: k })).status, 400);
});

test('live/missing key refused; forged session (live, wrong url, wrong ref) rejected', async () => {
  const { store } = newStore();
  for (const secretKey of ['', 'sk_live_abc', 'rk_live_abc', 'pk_test_abc']) assert.equal((await run({ cfg: cfg({ secretKey }), stripe: fakeStripe(), store })).status, 503);
  for (const [i, m] of [(s) => ({ ...s, livemode: true }), (s) => ({ ...s, url: 'https://evil.example/pay' }), (s) => ({ ...s, metadata: { order_ref: 'ord_x' } }), (s) => ({ ...s, id: 'cs_live_1' })].entries()) {
    assert.equal((await run({ stripe: fakeStripe({ mutate: m }), store: newStore().store, requestKey: `forged-session-key-${i}xxxx` })).status, 502);
  }
});

test('origin / return URL config is strict', () => {
  assert.throws(() => buildConfig({ allowedOrigins: 'http://evil.example' }));
  assert.throws(() => buildConfig({ allowedOrigins: 'https://a.example/path' }));
  assert.throws(() => buildConfig({ siteOrigin: 'https://evil.example' }));
  const c = cfg();
  assert.equal(assertReturnUrlAllowed('https://evil.example/success.html', c.allowedReturnUrlPrefixes), false);
  assert.equal(assertReturnUrlAllowed('https://user:pw@michael-james-guitars.web.app/x', c.allowedReturnUrlPrefixes), false);
  assert.throws(() => buildSessionParams({ cfg: { ...c, successUrl: 'https://evil.example/s' }, catalog: catalogIndex.catalog, items: [], orderRef: 'o', integrationSuffix: 'abcdefgh' }));
});

test('wrong-account / wrong-permission key fails closed (no session, 503)', async () => {
  for (const e of [{ type: 'StripeInvalidRequestError', code: 'resource_missing' }, { type: 'StripePermissionError' }, { type: 'StripeAuthenticationError' }]) {
    const stripe = fakeStripe(); stripe.checkout.sessions.create = async () => { throw Object.assign(new Error('x'), e); };
    const r = await run({ stripe, store: newStore().store });
    assert.equal(r.status, 503); assert.equal(r.body.url, undefined);
  }
});
