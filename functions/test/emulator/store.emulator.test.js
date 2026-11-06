// REAL Firestore emulator (named database "orders"), demo project; Stripe still mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createFirestoreStore } from '../../src/store.js';
import { createCheckout } from '../../src/checkout.js';
import { handleStripeWebhook } from '../../src/webhook.js';
import { catalogIndex, cfg, fakeStripe, sign, paidFixtures, evt } from '../helpers.js';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'must run under the emulator');
const db = getFirestore(initializeApp({ projectId: 'demo-mjg' }), 'orders');
const store = createFirestoreStore(db);
const body = { items: [{ productId: 'piezo-bridge-pickup', variantId: 'standard', qty: 3 }] };

test('emulator: 8 concurrent same-key requests => one order doc, one session', async () => {
  const stripe = fakeStripe({ delayMs: 10 });
  const key = `emu-concurrent-${Date.now()}`;
  const rs = await Promise.all(Array.from({ length: 8 }, () => createCheckout({ cfg: cfg(), catalogIndex, stripe, store, body, requestKey: key })));
  const okUrls = new Set(rs.filter((r) => r.status === 200).map((r) => r.body.url));
  assert.equal(okUrls.size, 1);
  const docs = await db.collection('orders').where('requestId', '!=', '').get();
  const mine = docs.docs.filter((d) => rs.some(() => true) && d.data().sessionId === [...okUrls][0].split('/').pop());
  assert.equal(mine.length, 1);
  const conflict = await createCheckout({ cfg: cfg(), catalogIndex, stripe, store, body: { items: [body.items[0]] }, requestKey: key });
  assert.equal(conflict.status, 409);
});

test('emulator: webhook transactions dedupe concurrent duplicate deliveries and stay monotonic', async () => {
  const stripe = fakeStripe();
  const r = await createCheckout({ cfg: cfg(), catalogIndex, stripe, store, body, requestKey: `emu-webhook-${Date.now()}` });
  const sessionId = r.body.url.split('/').pop();
  const order = (await db.collection('orders').where('sessionId', '==', sessionId).get()).docs[0].data();
  const f = paidFixtures(order, sessionId);
  const e = evt('checkout.session.completed', f.session);
  const call = (ev) => handleStripeWebhook({ cfg: cfg(), stripe, store, ...sign(ev), fetchLineItems: async () => f.lineItems });
  const results = await Promise.all([call(e), call(e), call(e)]);
  assert.ok(results.every((x) => x.status === 200));
  assert.equal(results.filter((x) => x.body.duplicate === false).length, 1);
  await call(evt('checkout.session.async_payment_failed', { ...f.session, payment_status: 'unpaid' }));
  const after = (await db.collection('orders').doc(order.orderRef).get()).data();
  assert.equal(after.state, 'paid'); assert.equal(after.paid.amountTotal, 5000);
  assert.ok((await db.collection('webhookEvents').doc(e.id).get()).exists);
});
