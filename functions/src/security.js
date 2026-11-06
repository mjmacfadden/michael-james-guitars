export function originAllowed(origin, allowed) {
  return typeof origin === 'string' && allowed.includes(origin);
}
export function applyCors(req, res, allowed) {
  res.set('Vary', 'Origin');
  const o = req.headers.origin;
  if (originAllowed(o, allowed)) {
    res.set('Access-Control-Allow-Origin', o);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    res.set('Access-Control-Max-Age', '600');
  }
}
/** Per-instance fixed-window limiter (best effort; maxInstances bounds total). */
export function createRateLimiter({ windowMs = 60000, max = 20, maxKeys = 5000 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now - e.start > windowMs) { if (hits.size >= maxKeys) hits.clear(); e = { start: now, count: 0 }; hits.set(key, e); }
    return ++e.count > max;
  };
}
