import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const site = readFileSync(new URL('js/site.js', root), 'utf8');
test('frontend default stays legacy Payment Links; backend path is opt-in with pending lock', () => {
  assert.match(site, /const CHECKOUT_MODE='legacy';/);
  assert.match(site, /if\(checkoutPending\) return;/);
  assert.match(site, /j\.url\.startsWith\('https:\/\/checkout\.stripe\.com\/'\)/);
  assert.doesNotMatch(site, /price_1|shr_1/);
});
test('legacy quantity Payment Links intact in public data (10 qty links, no string variants)', () => {
  const raw = readFileSync(new URL('data/products.json', root), 'utf8');
  const data = JSON.parse(raw);
  const p = data.products[0];
  assert.equal(p.options, undefined);
  assert.equal(p.stripeComboLinks, undefined);
  assert.equal(p.defaultVariantId, 'standard');
  assert.deepEqual(Object.keys(p.stripeLinks).sort((a,b)=>+a-+b), ['1','2','3','4','5','6','7','8','9','10']);
  assert.equal(new Set(raw.match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+/g)).size, 10);
  assert.match(p.description, /ungrooved saddle/i);
  assert.match(p.specs.Saddle, /Ungrooved/i);
});
test('product page is quantity-only; cart omits string selector labels', () => {
  assert.doesNotMatch(site, /name="strings"/);
  assert.doesNotMatch(site, /Choose 3- or 4-string and quantity/);
  assert.match(site, /name="qty"/);
  assert.match(site, /One ungrooved saddle fits 3- or 4-string guitars/);
  assert.match(site, /\$\$\{it\.price\} each/);
  assert.match(site, /variantId:String\(p\.defaultVariantId\|\|'standard'\)/);
});
test('firebase.json: hosting public-only, rewrites only to the two functions', () => {
  const f = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'));
  assert.equal(f.hosting.public, 'public');
  assert.deepEqual(f.hosting.rewrites.map((r) => r.function.functionId).sort(), ['createCheckoutSession', 'stripeWebhook']);
  assert.ok(f.hosting.rewrites.every((r) => r.function.region === 'us-central1'));
  assert.equal(f.firestore.database, 'orders');
  assert.ok(!existsSync(new URL('functions/.secret.local', root)));
});
