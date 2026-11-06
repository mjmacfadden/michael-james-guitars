import crypto from 'node:crypto';
import fs from 'node:fs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const VARIANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const PRICE_RE = /^price_[A-Za-z0-9]{6,}$/;

function fail(msg) {
  const err = new Error(`Invalid catalog: ${msg}`);
  err.code = 'INVALID_CATALOG';
  throw err;
}

/**
 * Validate the single editable catalog. Throws on anything ambiguous so a bad edit
 * fails at startup / build time instead of at checkout.
 */
export function validateCatalog(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.products)) fail('products array required');
  const currency = raw.currency;
  if (currency !== 'usd') fail('currency must be "usd"');
  const s = raw.shipping;
  if (!s || s.amountCents !== 500 || s.currency !== 'usd') fail('shipping must be exactly 500 usd per order');
  if (!/^shr_[A-Za-z0-9]{6,}$/.test(String(s.stripeShippingRateId))) fail('shipping.stripeShippingRateId required');
  if (!Array.isArray(s.allowedCountries) || s.allowedCountries.join(',') !== 'US') fail('shipping allowedCountries must be ["US"]');
  const lim = raw.limits || {};
  for (const k of ['minQty', 'maxQtyPerVariant', 'maxLineItems', 'maxBodyBytes']) {
    if (!Number.isInteger(lim[k]) || lim[k] < 1) fail(`limits.${k} must be a positive integer`);
  }
  if (lim.minQty !== 1 || lim.maxQtyPerVariant > 20) fail('qty limits must be 1..<=20');
  if (lim.maxLineItems > 100) fail('maxLineItems must be <= 100 (Stripe limit)');
  const productIds = new Set();
  const priceIds = new Set();
  for (const p of raw.products) {
    if (!p || !ID_RE.test(String(p.id))) fail(`bad product id ${JSON.stringify(p && p.id)}`);
    if (productIds.has(p.id)) fail(`duplicate product id ${p.id}`);
    productIds.add(p.id);
    if (typeof p.name !== 'string' || !p.name) fail(`product ${p.id} needs a name`);
    if (typeof p.inStock !== 'boolean') fail(`product ${p.id} inStock must be boolean`);
    if (!Array.isArray(p.variants) || p.variants.length === 0) fail(`product ${p.id} needs at least one variant`);
    const vids = new Set();
    for (const v of p.variants) {
      if (!v || !VARIANT_ID_RE.test(String(v.id))) fail(`product ${p.id} bad variant id`);
      if (typeof v.id !== 'string') fail(`product ${p.id} variant id must be a string`);
      if (vids.has(v.id)) fail(`product ${p.id} duplicate variant ${v.id}`);
      vids.add(v.id);
      if (typeof v.label !== 'string' || !v.label) fail(`variant ${p.id}/${v.id} needs a label`);
      if (!PRICE_RE.test(String(v.stripePriceId))) fail(`variant ${p.id}/${v.id} needs a Stripe price id`);
      if (priceIds.has(v.stripePriceId)) fail(`price ${v.stripePriceId} mapped to two variants`);
      priceIds.add(v.stripePriceId);
      if (!Number.isInteger(v.unitAmountCents) || v.unitAmountCents <= 0) fail(`variant ${p.id}/${v.id} unitAmountCents must be a positive integer`);
      if (typeof v.inStock !== 'boolean') fail(`variant ${p.id}/${v.id} inStock must be boolean`);
    }
  }
  return raw;
}

export function catalogHash(catalog) {
  return crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0, 16);
}

export function loadCatalog(catalogPath) {
  return validateCatalog(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
}

export function indexCatalog(catalog) {
  validateCatalog(catalog);
  const byProduct = new Map();
  for (const product of catalog.products) {
    byProduct.set(product.id, { product, variants: new Map(product.variants.map((v) => [v.id, v])) });
  }
  return { catalog, byProduct };
}

/** Resolve { productId, variantId } strictly by id. No legacy option-name lookups here. */
export function resolveVariant(index, line) {
  const productId = line.productId;
  const entry = typeof productId === 'string' ? index.byProduct.get(productId) : undefined;
  if (!entry) return { error: 'unknown_product' };
  const { product, variants } = entry;
  const variant = typeof line.variantId === 'string' ? variants.get(line.variantId) : undefined;
  if (!variant) return { error: 'unknown_variant', productId };
  if (!product.inStock || variant.inStock === false) {
    return { error: 'out_of_stock', productId, variantId: variant.id };
  }
  return { product, variant };
}

const PUBLIC_PRODUCT_FIELDS = ['id', 'name', 'shortDescription', 'description', 'specs', 'installNotes', 'images', 'imageAlts', 'video', 'inStock', 'optionLabel'];

/**
 * Deterministic public projection for the static storefront (data/products.json).
 * Excludes Stripe Price IDs and anything server-only.
 */
export function toPublicCatalog(catalog) {
  validateCatalog(catalog);
  const products = catalog.products.map((p) => {
    const out = {};
    for (const k of PUBLIC_PRODUCT_FIELDS) if (p[k] !== undefined) out[k] = p[k];
    out.variants = p.variants.map((v) => ({ id: v.id, label: v.label, unitAmountCents: v.unitAmountCents, inStock: v.inStock }));
    // Display-only convenience (lowest variant price, whole dollars) for older templates.
    out.price = Math.min(...p.variants.map((v) => v.unitAmountCents)) / 100;
    return out;
  });
  return {
    _generated: 'GENERATED by functions/scripts/build-catalog.js from functions/data/catalog.json. Do not edit by hand.',
    catalogVersion: catalog.catalogVersion,
    contactEmail: catalog.contactEmail,
    currency: catalog.currency.toUpperCase(),
    shipping: {
      amountCents: catalog.shipping.amountCents,
      displayName: catalog.shipping.displayName,
      description: catalog.shipping.description,
      allowedCountries: catalog.shipping.allowedCountries,
    },
    limits: { minQty: catalog.limits.minQty, maxQtyPerVariant: catalog.limits.maxQtyPerVariant, maxLineItems: catalog.limits.maxLineItems },
    products,
  };
}

export function publicCatalogJson(catalog) {
  return `${JSON.stringify(toPublicCatalog(catalog), null, 2)}\n`;
}
