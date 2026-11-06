import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from '../src/checkout.js';
import { handleStripeWebhook, fetchAllLineItems } from '../src/webhook.js';
import { nextState } from '../src/store.js';
import { catalogIndex, cfg, fakeStripe, newStore, KEY, sign, paidFixtures, evt, SHR } from './helpers.js';

async function setup(body = { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 3 }] }) {
  const stripe = fakeStripe(); const { store, db } = newStore();
  const r = await createCheckout({ cfg: cfg(), catalogIndex, stripe, store, body, requestKey: KEY });
  assert.equal(r.status, 200);
  const [, order] = [...db.data.entries()].find(([k]) => k.startsWith('orders/'));
  return { stripe, store, db, order, sessionId: order.sessionId };
}
const hook = (ctx, event, o = {}) => { const s = sign(event); return handleStripeWebhook({ cfg: cfg(), stripe: ctx.stripe, store: ctx.store, ...s, fetchLineItems: async () => ctx.lineItems, ...o }); };
const orderOf = (ctx) => ctx.db.data.get(`orders/${ctx.order.orderRef}`);

test('signature: missing / forged / wrong secret / non-raw body => 400; missing secret => 503', async () => {
  const ctx = await setup(); const { session } = paidFixtures(ctx.order, ctx.sessionId);
  const e = evt('checkout.session.completed', session); const s = sign(e);
  assert.equal((await handleStripeWebhook({ cfg: cfg(), stripe: ctx.stripe, store: ctx.store, rawBody: s.rawBody, signature: '' })).status, 400);
  assert.equal((await handleStripeWebhook({ cfg: cfg(), stripe: ctx.stripe, store: ctx.store, rawBody: s.rawBody, signature: 't=1,v1=deadbeef' })).status, 400);
  assert.equal((await handleStripeWebhook({ cfg: cfg({ webhookSecret: 'whsec_other' }), stripe: ctx.stripe, store: ctx.store, ...s })).status, 400);
  assert.equal((await handleStripeWebhook({ cfg: cfg(), stripe: ctx.stripe, store: ctx.store, rawBody: JSON.parse(s.rawBody), signature: s.signature })).status, 400);
  const tampered = Buffer.from(s.rawBody.toString().replace('"paid"', '"unpaid"'));
  assert.equal((await handleStripeWebhook({ cfg: cfg(), stripe: ctx.stripe, store: ctx.store, rawBody: tampered, signature: s.signature })).status, 400);
  assert.equal((await handleStripeWebhook({ cfg: cfg({ webhookSecret: '' }), stripe: ctx.stripe, store: ctx.store, ...s })).status, 503);
  assert.equal(orderOf(ctx).state, 'session_created');
});

test('paid completed => verified paid order; duplicate event deduped', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId); ctx.lineItems = f.lineItems;
  const e = evt('checkout.session.completed', f.session);
  const r = await hook(ctx, e);
  assert.equal(r.status, 200); assert.equal(r.body.state, 'paid');
  const o = orderOf(ctx); assert.equal(o.paid.amountTotal, 5000); assert.equal(o.paid.items.length, 1);
  assert.equal(JSON.stringify(o).match(/email|phone|address/i), null);
  assert.equal((await hook(ctx, e)).body.duplicate, true);
});

test('async: completed unpaid => pending (no paid record); async_payment_succeeded => paid; failed after paid is ignored', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId); ctx.lineItems = f.lineItems;
  assert.equal((await hook(ctx, evt('checkout.session.completed', { ...f.session, payment_status: 'unpaid' }))).body.state, 'pending');
  assert.equal(orderOf(ctx).paid, undefined);
  assert.equal((await hook(ctx, evt('checkout.session.async_payment_succeeded', { ...f.session, payment_status: 'unpaid' }))).status, 500);
  assert.equal((await hook(ctx, evt('checkout.session.async_payment_succeeded', f.session))).body.state, 'paid');
  assert.equal((await hook(ctx, evt('checkout.session.async_payment_failed', { ...f.session, payment_status: 'unpaid' }))).body.state, 'paid');
});

test('out-of-order: paid then late completed(unpaid) stays paid; async failure from pending => failed', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId); ctx.lineItems = f.lineItems;
  await hook(ctx, evt('checkout.session.async_payment_succeeded', f.session));
  assert.equal((await hook(ctx, evt('checkout.session.completed', { ...f.session, payment_status: 'unpaid' }))).body.state, 'paid');
  const c2 = await setup(); const f2 = paidFixtures(c2.order, c2.sessionId);
  await hook(c2, evt('checkout.session.completed', { ...f2.session, payment_status: 'unpaid' }));
  assert.equal((await hook(c2, evt('checkout.session.async_payment_failed', { ...f2.session, payment_status: 'unpaid' }))).body.state, 'failed');
  assert.equal(nextState('paid', 'pending'), 'paid'); assert.equal(nextState('pending', 'session_created'), 'pending');
});

test('foreign / wrong-mode / connected-account / untagged / other-store events are ignored without writes', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId); ctx.lineItems = f.lineItems;
  const cases = [evt('checkout.session.completed', f.session, { livemode: true }), evt('checkout.session.completed', { ...f.session, livemode: true }),
    evt('checkout.session.completed', f.session, { account: 'acct_other' }), evt('checkout.session.completed', { ...f.session, metadata: {} }),
    evt('checkout.session.completed', { ...f.session, metadata: { ...f.session.metadata, store_id: 'other' } }), evt('checkout.session.completed', { ...f.session, id: 'cs_live_x' }),
    evt('payment_intent.succeeded', { object: 'payment_intent' })];
  for (const e of cases) { const r = await hook(ctx, e); assert.equal(r.status, 200); assert.equal(r.body.ignored, true); }
  assert.equal(orderOf(ctx).state, 'session_created');
  assert.equal([...ctx.db.data.keys()].filter((k) => k.startsWith('webhookEvents/')).length, 0);
});

test('verification mismatches => non-2xx, order NOT paid', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId);
  const li = f.lineItems;
  const variants = [
    [{}, []], [{}, [{ ...li[0], quantity: 9 }]], [{}, [{ ...li[0], price: { id: 'price_evil', unit_amount: 1500 } }]],
    [{}, [li[0], li[0]]], [{}, [{ ...li[0], amount_subtotal: 1 }]], [{ amount_subtotal: 1 }, li], [{ amount_total: 4500 }, li],
    [{ currency: 'eur' }, li], [{ shipping_options: [{ shipping_amount: 500, shipping_rate: SHR }, { shipping_amount: 0, shipping_rate: 'shr_other123' }] }, li],
    [{ shipping_options: [{ shipping_amount: 1000, shipping_rate: SHR }] }, li], [{ shipping_cost: { amount_total: 1000, shipping_rate: SHR } }, li],
    [{ shipping_cost: { amount_total: 500, shipping_rate: 'shr_other123' } }, li], [{ total_details: { amount_shipping: 500, amount_discount: 100, amount_tax: 0 } }, li],
    [{ metadata: { ...f.session.metadata, catalog_version: '99' } }, li], [{ client_reference_id: 'ord_other' }, li], [{ id: 'cs_test_other' }, li],
    [{ payment_status: 'no_payment_required' }, li],
  ];
  for (const [over, items] of variants) {
    const r = await hook({ ...ctx, lineItems: items }, evt('checkout.session.completed', { ...f.session, ...over }));
    assert.ok(r.status >= 400, JSON.stringify(over)); assert.notEqual(orderOf(ctx).state, 'paid');
  }
  const r = await hook(ctx, evt('checkout.session.completed', f.session), { fetchLineItems: async () => { throw new Error('net'); } });
  assert.equal(r.status, 503);
});

test('quantity-only cart charges exactly one $5 shipping (5 not 10)', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId); ctx.lineItems = f.lineItems;
  assert.equal(ctx.order.shippingAmount, 500);
  const bad = await hook(ctx, evt('checkout.session.completed', { ...f.session, amount_total: f.session.amount_subtotal + 1000, shipping_cost: { amount_total: 1000, shipping_rate: SHR }, total_details: { amount_shipping: 1000 } }));
  assert.ok(bad.status >= 400);
  assert.equal((await hook(ctx, evt('checkout.session.completed', f.session))).body.state, 'paid');
});

test('line items are paginated fully', async () => {
  const pages = [{ data: [{ id: 'li_1' }], has_more: true }, { data: [{ id: 'li_2' }], has_more: false }];
  const seen = [];
  const stripe = { checkout: { sessions: { listLineItems: async (id, p) => { seen.push(p); return pages.shift(); } } } };
  assert.deepEqual((await fetchAllLineItems(stripe, 'cs_test_1')).map((x) => x.id), ['li_1', 'li_2']);
  assert.equal(seen[1].starting_after, 'li_1');
  await assert.rejects(fetchAllLineItems({ checkout: { sessions: { listLineItems: async () => ({ data: [], has_more: true }) } } }, 'cs'));
});

test('unknown order_ref => retry, no write', async () => {
  const ctx = await setup(); const f = paidFixtures(ctx.order, ctx.sessionId);
  const ref = 'ord_' + 'a'.repeat(32);
  const r = await hook(ctx, evt('checkout.session.completed', { ...f.session, client_reference_id: ref, metadata: { ...f.session.metadata, order_ref: ref } }));
  assert.equal(r.status, 503);
});
