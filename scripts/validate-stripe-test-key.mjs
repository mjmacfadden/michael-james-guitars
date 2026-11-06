// Validates the runtime key WITHOUT printing it: test mode, correct account (via account-scoped
// price/shipping-rate IDs in a real TEST Checkout Session create, then immediately expired), required permissions.
// Usage: MJG_STRIPE_TEST_SECRET_KEY=... node scripts/validate-stripe-test-key.mjs   (creates one expired TEST session)
import Stripe from '../functions/node_modules/stripe/esm/stripe.esm.node.js';
import { readFileSync } from 'node:fs';
const key = process.env.MJG_STRIPE_TEST_SECRET_KEY || '';
if (!/^rk_test_[A-Za-z0-9]{20,}$/.test(key)) { console.error('refused: not a restricted test key'); process.exit(2); }
const cat = JSON.parse(readFileSync(new URL('../functions/data/catalog.json', import.meta.url)));
const stripe = new Stripe(key, { apiVersion: '2026-10-28.endive', maxNetworkRetries: 1 });
try {
  const s = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: cat.products[0].variants.map((v) => ({ price: v.stripePriceId, quantity: 1 })),
    shipping_options: [{ shipping_rate: cat.shipping.stripeShippingRateId }],
    shipping_address_collection: { allowed_countries: ['US'] },
    success_url: 'https://michael-james-guitars.web.app/success.html', cancel_url: 'https://michael-james-guitars.web.app/cancel.html',
    metadata: { store_id: 'mjg-preflight' },
  }, { idempotencyKey: `mjg-preflight-${Date.now()}` });
  const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10 });
  await stripe.checkout.sessions.expire(s.id);
  const ok = s.livemode === false && s.amount_subtotal === 3000 && s.shipping_cost?.amount_total === 500 && li.data.length === 2;
  console.log(JSON.stringify({ ok, livemode: s.livemode, subtotal: s.amount_subtotal, shipping: s.shipping_cost?.amount_total, lines: li.data.length, expired: true }));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(JSON.stringify({ ok: false, type: e.type, code: e.code || null })); // no message (may echo key prefix)
  process.exit(1);
}
