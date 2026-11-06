import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateCatalog, toPublicCatalog } from '../src/catalog.js';
import { catalogRaw } from './helpers.js';

test('catalog validates; shipping $5 US with approved rate', () => {
  const c = validateCatalog(catalogRaw());
  assert.equal(c.shipping.amountCents, 500);
  assert.equal(c.shipping.stripeShippingRateId, 'shr_1UYVzQFq9xU5KWTVa40tDxW8');
  assert.deepEqual(c.products[0].variants.map((v) => [v.id, v.label, v.stripePriceId, v.unitAmountCents]), [['standard', 'Standard', 'price_1UYS86Fq9xU5KWTVtILCVQBZ', 1500]]);
});
test('catalog rejects shipping change, missing rate, duplicate price, qty limit >20', () => {
  for (const mut of [(c) => (c.shipping.amountCents = 1000), (c) => delete c.shipping.stripeShippingRateId, (c) => c.products[0].variants.push({ id: 'dup', label: 'Dup', stripePriceId: c.products[0].variants[0].stripePriceId, unitAmountCents: 1500, inStock: true }), (c) => (c.limits.maxQtyPerVariant = 21), (c) => (c.shipping.allowedCountries = ['US', 'CA'])]) {
    const c = catalogRaw(); mut(c); assert.throws(() => validateCatalog(c));
  }
});
test('public projection never exposes Stripe price or rate IDs', () => {
  const s = JSON.stringify(toPublicCatalog(catalogRaw()));
  assert.doesNotMatch(s, /price_|shr_|sk_|rk_|whsec_/);
});
test('generated public catalog has no drift', () => {
  execFileSync(process.execPath, ['scripts/build-catalog.js', '--check'], { cwd: new URL('..', import.meta.url) });
});
