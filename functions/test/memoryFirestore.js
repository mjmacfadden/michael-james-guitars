// Minimal in-memory Firestore double (collection/doc/get/runTransaction with create/update). MOCK, not the emulator.
export function memoryDb({ failOn } = {}) {
  const data = new Map();
  let chain = Promise.resolve();
  const doc = (c, id) => ({ path: `${c}/${id}`, async get() { const v = data.get(`${c}/${id}`); return { exists: v !== undefined, data: () => structuredClone(v) }; } });
  return {
    data,
    collection: (c) => ({ doc: (id) => doc(c, id) }),
    runTransaction(fn) {
      const run = chain.then(async () => {
        if (failOn && failOn()) throw new Error('unavailable');
        const writes = [];
        const tx = {
          get: (r) => r.get(),
          create: (r, v) => writes.push(() => { if (data.has(r.path)) throw new Error('ALREADY_EXISTS'); data.set(r.path, structuredClone(v)); }),
          update: (r, v) => writes.push(() => { if (!data.has(r.path)) throw new Error('NOT_FOUND'); data.set(r.path, { ...data.get(r.path), ...structuredClone(v) }); }),
        };
        const out = await fn(tx);
        writes.forEach((w) => w());
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
