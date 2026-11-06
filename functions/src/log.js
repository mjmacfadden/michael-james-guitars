// Structured logs with an allowlist of non-PII keys. Never pass emails, names, addresses, phones, secrets.
const SAFE = new Set(['event_id', 'event_type', 'session_id', 'order_ref', 'reason', 'code', 'status', 'duplicate']);
export function log(msg, fields = {}) {
  const out = { msg };
  for (const [k, v] of Object.entries(fields)) if (SAFE.has(k)) out[k] = typeof v === 'string' ? v.slice(0, 80) : v;
  console.log(JSON.stringify(out));
}
