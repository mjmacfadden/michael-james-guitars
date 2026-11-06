import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const products = JSON.parse(readFileSync(new URL('data/products.json', root), 'utf8'));
const site = readFileSync(new URL('js/site.js', root), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('functions/data/catalog.json', root), 'utf8'));

test('storefront: quantity-only product, $15, 10 qty Payment Links, ungrooved copy', () => {
  const p = products.products[0];
  assert.equal(p.id, 'piezo-bridge-pickup');
  assert.equal(p.price, 15);
  assert.equal(p.defaultVariantId, 'standard');
  assert.equal(p.options, undefined);
  assert.equal(p.stripeComboLinks, undefined);
  assert.deepEqual(Object.keys(p.stripeLinks).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const q of Object.keys(p.stripeLinks)) assert.match(p.stripeLinks[q], /^https:\/\/buy\.stripe\.com\/test_/);
  assert.match(p.description, /ungrooved saddle/i);
  assert.match(p.specs.Saddle, /Ungrooved saddle/i);
  assert.match(p.specs.Compatibility, /3- and 4-string/i);
});

test('site.js: quantity form only; legacy CHECKOUT_MODE; flat qty link routing', () => {
  assert.match(site, /const CHECKOUT_MODE='legacy';/);
  assert.doesNotMatch(site, /name="strings"/);
  assert.doesNotMatch(site, /Choose 3- or 4-string and quantity/);
  assert.doesNotMatch(site, /stripeComboLinks/);
  assert.match(site, /name="qty"/);
  assert.match(site, /One ungrooved saddle fits 3- or 4-string guitars/);
  assert.match(site, /\$\$\{it\.price\} each/);
  assert.match(site, /variantId:String\(p\.defaultVariantId\|\|'standard'\)/);
  assert.match(site, /stripeLinks is a flat qty -> URL map/);
});

test('backend catalog: single standard variant at existing $15 price; shipping $5 US', () => {
  assert.equal(catalog.catalogVersion, 2);
  assert.equal(catalog.shipping.amountCents, 500);
  assert.deepEqual(catalog.shipping.allowedCountries, ['US']);
  assert.deepEqual(catalog.products[0].variants, [{
    id: 'standard',
    label: 'Standard',
    stripePriceId: 'price_1UYS86Fq9xU5KWTVtILCVQBZ',
    unitAmountCents: 1500,
    inStock: true,
  }]);
  assert.equal(catalog.products[0].optionLabel, undefined);
  assert.match(catalog.products[0].description, /ungrooved saddle/i);
});
