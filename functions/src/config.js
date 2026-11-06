export const STORE_ID = 'mjg';
export const STRIPE_API_VERSION = '2026-10-28.endive'; // pinned to the stripe@23.1.0 SDK default
export const EXPECTED_ACCOUNT_ID = 'acct_1FIhFRFq9xU5KWTV';
export const INTEGRATION_PREFIX = 'mjg-cart-checkout-';
export const DEFAULT_ORIGINS = ['https://michael-james-guitars.web.app', 'https://michael-james-guitars.firebaseapp.com'];

export function normalizeOrigin(o) {
  try {
    const u = new URL(o);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) return null;
    return u.origin;
  } catch { return null; }
}

/** Build trusted runtime config. Return URLs are derived from the server-side site origin, never the client. */
export function buildConfig({ secretKey, webhookSecret, allowedOrigins, siteOrigin }) {
  const origins = String(allowedOrigins || DEFAULT_ORIGINS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of origins) if (normalizeOrigin(o) !== o) throw Object.assign(new Error('bad origin config'), { code: 'BAD_CONFIG' });
  const site = siteOrigin || origins[0];
  if (!origins.includes(site)) throw Object.assign(new Error('site origin must be allowlisted'), { code: 'BAD_CONFIG' });
  return {
    storeId: STORE_ID,
    secretKey: secretKey || '',
    webhookSecret: webhookSecret || '',
    allowedOrigins: origins,
    successUrl: `${site}/success.html`,
    cancelUrl: `${site}/cancel.html`,
    allowedReturnUrlPrefixes: origins.map((o) => `${o}/`),
  };
}

/** Test mode only in this phase: restricted (rk_test_) preferred, sk_test_ tolerated; anything live refused. */
export function assertTestModeOrFail(cfg) {
  if (!/^(rk|sk)_test_[A-Za-z0-9]+$/.test(cfg.secretKey || '')) throw Object.assign(new Error('test key required'), { code: 'NOT_TEST_MODE' });
}

export function assertReturnUrlAllowed(url, prefixes) {
  try {
    const u = new URL(url);
    return !u.username && !u.password && !u.hash && prefixes.some((p) => `${u.origin}/` === p);
  } catch { return false; }
}
