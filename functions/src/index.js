import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { indexCatalog, validateCatalog } from './catalog.js';
import { buildConfig, STRIPE_API_VERSION } from './config.js';
import { createFirestoreStore } from './store.js';
import { createCheckout } from './checkout.js';
import { handleStripeWebhook } from './webhook.js';
import { applyCors, createRateLimiter } from './security.js';

// Secret Manager bindings (values not set yet; nothing is read until deploy-time binding).
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY'); // restricted rk_test_ key
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET'); // whsec_ for the test endpoint
const CHECKOUT_ALLOWED_ORIGINS = defineString('CHECKOUT_ALLOWED_ORIGINS', { default: 'https://michael-james-guitars.web.app,https://michael-james-guitars.firebaseapp.com' });

const catalogIndex = indexCatalog(validateCatalog(JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'))));
let stripe; let store;
function deps() {
  if (!getApps().length) initializeApp();
  store ??= createFirestoreStore(getFirestore('orders')); // named Enterprise Native DB
  const key = STRIPE_SECRET_KEY.value();
  stripe ??= key ? new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20000, appInfo: { name: 'mjg-checkout-functions', version: '1.0.0' } }) : null;
  return { cfg: buildConfig({ secretKey: key, webhookSecret: STRIPE_WEBHOOK_SECRET.value(), allowedOrigins: CHECKOUT_ALLOWED_ORIGINS.value() }), stripe, store };
}
const limited = createRateLimiter({ max: 20 });
const common = { region: 'us-central1', minInstances: 0, concurrency: 20, timeoutSeconds: 30, memory: '256MiB', invoker: 'public' };

export const createCheckoutSession = onRequest({ ...common, maxInstances: 3, secrets: [STRIPE_SECRET_KEY] }, async (req, res) => {
  const d = deps();
  applyCors(req, res, d.cfg.allowedOrigins);
  if (req.method === 'OPTIONS') { res.status(d.cfg.allowedOrigins.includes(req.headers.origin) ? 204 : 403).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }
  if (!d.cfg.allowedOrigins.includes(req.headers.origin)) { res.status(403).json({ ok: false, error: 'origin_not_allowed' }); return; }
  if (!req.is('application/json')) { res.status(415).json({ ok: false, error: 'json_required' }); return; }
  if ((req.rawBody?.length || 0) > catalogIndex.catalog.limits.maxBodyBytes) { res.status(413).json({ ok: false, error: 'body_too_large' }); return; }
  if (limited(req.ip || 'unknown')) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
  const r = await createCheckout({ cfg: d.cfg, catalogIndex, stripe: d.stripe, store: d.store, body: req.body, requestKey: req.get('Idempotency-Key') });
  res.set('Cache-Control', 'no-store').status(r.status).json(r.body);
});

export const stripeWebhook = onRequest({ ...common, maxInstances: 2, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const d = deps();
  const r = await handleStripeWebhook({ cfg: d.cfg, stripe: d.stripe, store: d.store, rawBody: req.rawBody, signature: req.get('stripe-signature') });
  res.status(r.status).json(r.body);
});
