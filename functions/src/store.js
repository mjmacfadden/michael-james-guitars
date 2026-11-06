// Order store on the named Enterprise (Native mode) Firestore database "orders".
// Server-only: Admin SDK bypasses rules; direct clients are denied by firestore.rules.
// Collections: checkoutRequests/{requestId}, orders/{orderRef}, webhookEvents/{eventId}
export const RANK = { created: 0, session_created: 1, pending: 2, paid: 3, failed: 3 };

/** Decide the next order state. Monotonic: paid is terminal; failed never overrides paid; pending never downgrades. */
export function nextState(current, incoming) {
  if (current === 'paid') return 'paid';
  if (current === 'failed') return incoming === 'paid' ? 'paid' : 'failed'; // a later verified paid event wins
  return RANK[incoming] >= (RANK[current] ?? 0) ? incoming : current;
}

export function createFirestoreStore(db, { now = () => new Date() } = {}) {
  const reqs = db.collection('checkoutRequests');
  const orders = db.collection('orders');
  const events = db.collection('webhookEvents');
  return {
    /** Atomically create request + order snapshot, or return the existing request. Never overwrites. */
    async reserveRequest(requestId, fingerprint, makeRecord) {
      return db.runTransaction(async (tx) => {
        const ref = reqs.doc(requestId);
        const snap = await tx.get(ref);
        if (snap.exists) {
          const row = snap.data();
          return row.fingerprint === fingerprint ? { row, created: false } : { conflict: true };
        }
        const { request, order } = makeRecord();
        const ts = now().toISOString();
        const row = { ...request, requestId, fingerprint, createdAt: ts };
        tx.create(ref, row);
        tx.create(orders.doc(order.orderRef), { ...order, state: 'created', createdAt: ts, updatedAt: ts });
        return { row, created: true };
      });
    },
    async setRequestSession(requestId, orderRef, s) {
      await db.runTransaction(async (tx) => {
        const oref = orders.doc(orderRef);
        const o = await tx.get(oref);
        const ts = now().toISOString();
        tx.update(reqs.doc(requestId), { sessionId: s.id, sessionUrl: s.url, sessionExpiresAt: s.expiresAt ?? null });
        const patch = { sessionId: s.id, updatedAt: ts };
        if (o.exists && o.data().state === 'created') patch.state = 'session_created';
        tx.update(oref, patch);
      });
    },
    async getOrder(orderRef) {
      const s = await orders.doc(orderRef).get();
      return s.exists ? s.data() : null;
    },
    /** One transaction: event dedupe + session binding + monotonic transition + verified paid record. */
    async recordWebhook({ eventId, eventType, orderRef, sessionId, state, paymentStatus, paid }) {
      return db.runTransaction(async (tx) => {
        const eref = events.doc(eventId);
        const oref = orders.doc(orderRef);
        const [e, o] = await Promise.all([tx.get(eref), tx.get(oref)]);
        if (e.exists) return { duplicate: true };
        if (!o.exists) return { missing: true };
        const order = o.data();
        if (order.sessionId && order.sessionId !== sessionId) return { sessionMismatch: true };
        const ts = now().toISOString();
        const to = nextState(order.state, state);
        const patch = { sessionId, state: to, paymentStatus, updatedAt: ts, lastEventId: eventId };
        if (to === 'paid' && order.state !== 'paid' && paid) Object.assign(patch, { paidAt: ts, paid });
        if (to === 'failed' && order.state !== 'failed') patch.failedAt = ts;
        tx.update(oref, patch);
        tx.create(eref, { type: eventType, orderRef, sessionId, appliedState: to, receivedAt: ts });
        return { duplicate: false, from: order.state, state: to };
      });
    },
  };
}
