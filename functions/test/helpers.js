import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { indexCatalog } from '../src/catalog.js';
import { buildConfig } from '../src/config.js';
import { createFirestoreStore } from '../src/store.js';
import { memoryDb } from './memoryFirestore.js';

export const WHSEC = 'whsec_unit_test_only';
export const catalogRaw = () => JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
export const catalogIndex = indexCatalog(catalogRaw());
export const cfg = (o = {}) => ({ ...buildConfig({ secretKey: 'rk_test_UNITTESTONLY', webhookSecret: WHSEC }), ...o });
export const P_STD = 'price_1UYS86Fq9xU5KWTVtILCVQBZ';
export const P3 = P_STD; // legacy alias
export const P4 = 'price_1UYS8AFq9xU5KWTVMQqGd0eN'; // retired storefront variant; kept for historical asserts only
export const SHR = 'shr_1UYVzQFq9xU5KWTVa40tDxW8';
const realSdk = new Stripe('sk_test_offline_signature_only', { apiVersion: '2026-10-28.endive' });

/** Mock Stripe: create honours idempotency keys like Stripe (same key => same session). No network. */
export function fakeStripe({ fail = 0, delayMs = 0, mutate } = {}) {
  const byKey = new Map();
  const calls = [];
  let n = 0;
  return {
    calls,
    webhooks: realSdk.webhooks,
    checkout: { sessions: {
      async create(params, opts) {
        calls.push({ params, opts });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (fail > 0) { fail--; throw Object.assign(new Error('network'), { type: 'StripeConnectionError' }); }
        if (byKey.has(opts.idempotencyKey)) {
          const prev = byKey.get(opts.idempotencyKey);
          if (JSON.stringify(prev.params) !== JSON.stringify(params)) throw Object.assign(new Error('idem'), { type: 'StripeIdempotencyError' });
          return prev.session;
        }
        let session = { id: `cs_test_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}`, livemode: false, metadata: params.metadata, expires_at: Math.floor(Date.now() / 1000) + 86400 };
        if (mutate) session = mutate(session);
        byKey.set(opts.idempotencyKey, { params, session });
        return session;
      },
    } },
  };
}
export function newStore(opts) { const db = memoryDb(opts); return { db, store: createFirestoreStore(db) }; }

export function sign(event) {
  const payload = JSON.stringify(event);
  return { rawBody: Buffer.from(payload), signature: realSdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
}

/** Build a paid session object + Stripe-shaped line items matching an order snapshot. */
export function paidFixtures(order, sessionId, over = {}) {
  const session = {
    id: sessionId, object: 'checkout.session', livemode: false, mode: 'payment', payment_status: 'paid', status: 'complete',
    currency: 'usd', client_reference_id: order.orderRef,
    metadata: { store_id: 'mjg', order_ref: order.orderRef, catalog_version: String(order.catalogVersion) },
    amount_subtotal: order.amountSubtotal, amount_total: order.amountSubtotal + 500,
    shipping_options: [{ shipping_amount: 500, shipping_rate: SHR }],
    shipping_cost: { amount_total: 500, shipping_rate: SHR },
    total_details: { amount_shipping: 500, amount_discount: 0, amount_tax: 0 },
    payment_intent: 'pi_test_1', ...over,
  };
  const lineItems = order.lines.map((l, i) => ({ id: `li_${i}`, price: { id: l.stripePriceId, unit_amount: l.unitAmountCents }, quantity: l.qty, currency: 'usd', amount_subtotal: l.unitAmountCents * l.qty, amount_discount: 0, amount_tax: 0 }));
  return { session, lineItems };
}
export const evt = (type, session, over = {}) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, livemode: false, data: { object: session }, ...over });
export const KEY = 'test-key-0123456789abcdef';
