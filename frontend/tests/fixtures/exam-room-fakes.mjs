// Fakes for the exam-room lib tests (EXAMROOM-0066 T001): an in-memory
// Storage, a storage that throws, and a Web Locks + BroadcastChannel pair.

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

export class BrokenStorage {
  get length() { throw new Error('blocked'); }
  key() { throw new Error('blocked'); }
  getItem() { throw new Error('blocked'); }
  setItem() { throw new Error('blocked'); }
  removeItem() { throw new Error('blocked'); }
}

/** One browser: shared lock manager and broadcast bus for several fake tabs. */
export function fakeBrowser() {
  const held = new Map(); // name -> { release }
  const waiters = new Map(); // name -> [{ grant, signal }]
  const channels = new Set();

  function grantNext(name) {
    const queue = waiters.get(name) || [];
    while (queue.length) {
      const w = queue.shift();
      if (w.signal?.aborted) continue;
      w.grant();
      return;
    }
  }

  const locks = {
    request(name, opts, cb) {
      return new Promise((resolve, reject) => {
        const run = () => {
          let release;
          const done = new Promise((r) => { release = r; });
          held.set(name, { release });
          Promise.resolve(cb({ name })).then((v) => {
            held.delete(name);
            resolve(v);
            grantNext(name);
          });
        };
        if (!held.has(name)) { run(); return; }
        if (opts.ifAvailable) { Promise.resolve(cb(null)).then(resolve); return; }
        const entry = { grant: run, signal: opts.signal };
        if (!waiters.has(name)) waiters.set(name, []);
        waiters.get(name).push(entry);
        opts.signal?.addEventListener?.('abort', () => {
          const q = waiters.get(name) || [];
          const i = q.indexOf(entry);
          if (i >= 0) q.splice(i, 1);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    },
    isHeld: (name) => held.has(name),
  };

  function channelFactory() {
    const ch = {
      onmessage: null,
      postMessage(data) {
        for (const other of channels) {
          if (other !== ch && other.onmessage) queueMicrotask(() => other.onmessage({ data: structuredClone(data) }));
        }
      },
      close() { channels.delete(ch); },
    };
    channels.add(ch);
    return ch;
  }

  return { locks, channelFactory };
}

/** Manual timers driven by advance(ms). */
export function fakeTimers() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { id += 1; tasks.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(i) { tasks.delete(i); },
    setInterval(fn, ms) { id += 1; const me = id; const tick = () => { tasks.set(me, { at: now + ms, fn: () => { fn(); tick(); } }); }; tick(); return me; },
    clearInterval(i) { tasks.delete(i); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await flushMicrotasks();
      }
      now = end;
      await flushMicrotasks();
    },
  };
}

export async function flushMicrotasks(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}
