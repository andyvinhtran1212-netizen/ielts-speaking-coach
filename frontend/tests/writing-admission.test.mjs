import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createWritingAdmissionController, clearWritingAdmissionIntents, shouldUseWritingAdmission } from '../lib/writing-admission.mjs';

function harness() {
  const h = { account: randomUUID(), assignment: randomUUID(), command: randomUUID(),
    episode: randomUUID(), epoch: randomUUID(), rows: new Map(), calls: [], classifications: [], lookups: [], events: [], minted: [] };
  h.current = h.account;
  h.storage = {
    get length() { return h.rows.size; }, key: i => [...h.rows.keys()][i] ?? null,
    getItem: key => h.rows.get(key) ?? null,
    setItem: (key, value) => h.rows.set(key, value), removeItem: key => h.rows.delete(key),
  };
  h.reply = (phase = 'accepted') => ({
    assignment_id: h.assignment, started: phase === 'bound',
    command: { command_id: h.command, episode_id: h.episode, activity_epoch_id: h.epoch,
      phase, generation: phase === 'unstarted_expired' ? 1 : 0, execute_before: '2026-09-10T12:02:00Z' },
    timer: { started_at: phase === 'bound' ? '2026-09-10T12:00:00Z' : null,
      is_timed: true, time_limit_minutes: 40, expires_at: phase === 'bound' ? '2026-09-10T12:40:00Z' : null,
      time_remaining_seconds: phase === 'bound' ? 2400 : null, is_expired: false,
      status: phase === 'bound' ? 'in_progress' : 'pending', auto_submitted: false },
  });
  h.respond = async (method, path) => h.reply(method === 'GET' || path.endsWith('/execute') ? 'bound' : 'accepted');
  h.entry = (kind = 'eligible', started = false) => {
    const { command, ...value } = h.reply(started ? 'bound' : 'accepted');
    if (kind === 'terminal') value.timer.status = 'submitted';
    return { ...value, kind };
  };
  h.classify = async () => h.entry();
  h.lookup = async () => ({ found: false, admission: null });
  h.make = (extra = {}) => createWritingAdmissionController({
    getAccountId: async () => h.current, getStorage: () => h.storage,
    mintId: () => { const id = randomUUID(); h.minted.push(id); return id; },
    request: async (...args) => {
      h.events.push(args);
      if (args[0] === 'GET' && args[1].includes('/admission-intents/')) {
        h.lookups.push(args); return h.lookup(...args);
      }
      if (args[0] === 'GET' && args[1].endsWith('/entry')) {
        h.classifications.push(args); return h.classify(...args);
      }
      h.calls.push(args); assert.ok(h.rows.size > 0, 'persist intent before mutation/recovery'); return h.respond(...args);
    },
    ...extra,
  });
  h.record = () => JSON.parse([...h.rows.values()][0]);
  return h;
}

test('explicit start persists nonce before A, command before B and canonical timer after B', async () => {
  const h = harness(), c = h.make();
  h.respond = async (method, path) => {
    const saved = h.record();
    assert.equal(saved.nonce, h.minted[0]);
    if (path.endsWith('/execute')) assert.equal(saved.commandId, h.command);
    return h.reply(path.endsWith('/execute') ? 'bound' : 'accepted');
  };
  const value = await c.enter(h.account, h.assignment);
  assert.equal(h.classifications.length, 1);
  assert.equal(h.events[0][1].endsWith('/entry'), true);
  assert.equal(value.timer.started_at, '2026-09-10T12:00:00Z');
  assert.equal(h.calls.length, 2); assert.equal(h.record().state, 'complete');
  assert.deepEqual(h.calls[0][2], { protocol: 'admission-v1', launch_nonce: h.minted[0] });
  assert.deepEqual(h.calls[1][2], { protocol: 'admission-v1', generation: 0 });
  assert.deepEqual(Object.keys(h.record()).sort(), ['v','accountId','assignmentId','nonce','commandId','state'].sort());
});

test('double click is single flight', async () => {
  const h = harness(), c = h.make();
  const first = c.enter(h.account, h.assignment), second = c.enter(h.account, h.assignment);
  assert.equal(first, second);
  assert.equal(await first, await second);
  assert.equal(h.calls.length, 2); assert.equal(h.minted.length, 1);
});

test('lost prepare acknowledgment retries the same nonce after reload', async () => {
  const h = harness();
  h.respond = async () => { throw Error('network error with private detail'); };
  await assert.rejects(h.make().enter(h.account, h.assignment), error => error.writingAdmission && !error.message.includes('private detail'));
  const nonce = h.record().nonce;
  h.respond = async (method, path) => h.reply(path.endsWith('/execute') ? 'bound' : 'accepted');
  await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(h.minted.length, 1);
  assert.equal(h.calls[0][2].launch_nonce, nonce); assert.equal(h.calls[1][2].launch_nonce, nonce);
});

test('lost execute acknowledgment recovers via owned GET without another POST', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Error('lost B ACK');
    return h.reply();
  };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.record().commandId, h.command);
  h.respond = async () => h.reply('bound');
  const recovered = await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(recovered.command.phase, 'bound');
  assert.deepEqual(h.calls.map(call => call[0]), ['POST','POST','GET']);
});

test('server-expired execution fences the same command once, never creates a replacement automatically', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Object.assign(Error('command expired'), { status: 410 });
    return h.reply(path.endsWith('/reconcile') ? 'unstarted_expired' : 'accepted');
  };
  await assert.rejects(h.make().enter(h.account, h.assignment), /đã hết hạn và được khóa/);
  assert.equal(h.record().state, 'fenced'); assert.equal(h.minted.length, 1);
  assert.deepEqual(h.calls.map(call => call[1].split('/').at(-1)), ['admissions', 'execute', 'reconcile']);
  assert.deepEqual(h.calls.at(-1)[2], { protocol: 'admission-v1' });
  assert.ok(h.calls.at(-1)[1].includes(h.command));
});

test('expired renderer lease cannot prematurely fence a command or cause repeated execute', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Object.assign(Error('lease expired'), { status: 410 });
    return h.reply();
  };
  await assert.rejects(h.make().enter(h.account, h.assignment), /Bản nháp/);
  assert.equal(h.record().state, 'pending'); assert.equal(h.minted.length, 1);
  assert.equal(h.calls.length, 3);
});

test('executor winning a reconciliation race returns canonical bound result', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Object.assign(Error('expired response'), { status: 410 });
    return h.reply(path.endsWith('/reconcile') ? 'bound' : 'accepted');
  };
  const value = await h.make().enter(h.account, h.assignment);
  assert.equal(value.command.phase, 'bound'); assert.equal(h.record().state, 'complete');
  assert.equal(h.calls.length, 3);
});

test('lost fence ACK retains pending identity; reload GET recovers fenced status without another write', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Object.assign(Error('expired'), { status: 410 });
    if (path.endsWith('/reconcile')) throw Error('lost fence ACK');
    return h.reply();
  };
  await assert.rejects(h.make().enter(h.account, h.assignment), /Chưa xác nhận/);
  assert.equal(h.record().state, 'pending');
  const nonce = h.record().nonce;
  h.respond = async () => h.reply('unstarted_expired');
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }), /đã hết hạn và được khóa/);
  assert.equal(h.calls.length, 4); assert.equal(h.calls.at(-1)[0], 'GET');
  assert.equal(h.record().nonce, nonce); assert.equal(h.record().state, 'fenced');
});

test('ambiguous executor failure never calls the mutating reconciler', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Object.assign(Error('unknown'), { status: 503 });
    return h.reply();
  };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.calls.length, 2); assert.equal(h.record().state, 'pending');
});

test('reload with no intent cannot silently start; completed reload reads same command', async () => {
  const h = harness();
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }), /Bấm Bắt đầu/);
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 0);
  await h.make().enter(h.account, h.assignment);
  await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(h.calls.at(-1)[0], 'GET'); assert.equal(h.minted.length, 1);
});

test('explicit re-entry after completed acknowledgment uses new command intent, not a new timer locally', async () => {
  const h = harness();
  const first = await h.make().enter(h.account, h.assignment);
  h.command = randomUUID();
  const second = await h.make().enter(h.account, h.assignment);
  assert.equal(h.minted.length, 2); assert.notEqual(h.minted[0], h.minted[1]);
  assert.equal(first.timer.started_at, second.timer.started_at);
});

test('fenced command needs another explicit action, never automatic nonce rotation', async () => {
  const h = harness(); h.respond = async () => h.reply('unstarted_expired');
  await assert.rejects(h.make().enter(h.account, h.assignment), /được khóa/);
  assert.equal(h.calls.length, 1); assert.equal(h.record().state, 'fenced');
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }), /được khóa/);
  assert.equal(h.minted.length, 1);
  h.command = randomUUID(); h.respond = async (method, path) => h.reply(path.endsWith('/execute') ? 'bound' : 'accepted');
  await h.make().enter(h.account, h.assignment);
  assert.equal(h.minted.length, 2);
});

for (const status of [401, 403, 404, 409, 410, 422, 503]) {
  test(`HTTP ${status} keeps pending intent and cannot be mistaken for a submitted essay`, async () => {
    const h = harness();
    h.respond = async () => { throw Object.assign(Error('private'), { status }); };
    await assert.rejects(h.make().enter(h.account, h.assignment), err => err.writingAdmission === true && err.status === undefined);
    assert.equal(h.calls.length, 1); assert.equal(h.record().state, 'pending');
    assert.equal(shouldUseWritingAdmission({ enabled: false, getStorage: () => h.storage, accountId: h.account, assignmentId: h.assignment }), true);
  });
}

test('missing status after reload does not mint a nonce or fall back to prepare/start', async () => {
  const h = harness();
  h.respond = async (method, path) => { if (path.endsWith('/execute')) throw Error(); return h.reply(); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  h.respond = async () => { throw Object.assign(Error(), { status: 404 }); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.calls.at(-1)[0], 'GET'); assert.equal(h.minted.length, 1);
});

test('storage failure before A sends nothing', async () => {
  const h = harness(); h.storage.setItem = () => { throw Error('quota'); };
  await assert.rejects(h.make().enter(h.account, h.assignment), /lưu mã/);
  assert.equal(h.calls.length, 0);
});

test('storage failure after A prevents B, retaining original nonce for recovery', async () => {
  const h = harness();
  h.respond = async () => { h.storage.setItem = () => { throw Error('quota'); }; return h.reply(); };
  await assert.rejects(h.make().enter(h.account, h.assignment), /lưu mã/);
  assert.equal(h.calls.length, 1); assert.equal(h.record().commandId, null);
});

test('cleanup failure after confirmed B cannot make the canonical start a failure', async () => {
  const h = harness();
  h.respond = async (method, path) => {
    if (path.endsWith('/execute')) { h.storage.setItem = () => { throw Error('quota'); }; return h.reply('bound'); }
    return h.reply();
  };
  assert.equal((await h.make().enter(h.account, h.assignment)).command.phase, 'bound');
  assert.equal(h.record().state, 'pending');
});

test('malformed local receipt blocks instead of overwriting an uncertain identity', async () => {
  const h = harness(); h.rows.set(`aver:writing-admission:v1:${h.account}:${h.assignment}`, '{broken');
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.calls.length, 0); assert.equal(h.minted.length, 0);
});

for (const malformed of ['assignment', 'command', 'phase', 'timer']) {
  test(`malformed ${malformed} acknowledgment cannot start or acknowledge another assignment`, async () => {
    const h = harness();
    h.respond = async () => {
      const value = h.reply();
      if (malformed === 'assignment') value.assignment_id = randomUUID();
      if (malformed === 'command') value.command.command_id = 'bad-id';
      if (malformed === 'phase') value.command.phase = 'successful';
      if (malformed === 'timer') value.timer = null;
      return value;
    };
    await assert.rejects(h.make().enter(h.account, h.assignment));
    assert.equal(h.calls.length, 1); assert.equal(h.record().state, 'pending');
  });
}

test('account change during A suppresses B and cannot resurrect cleaned metadata', async () => {
  const h = harness();
  h.respond = async () => { h.current = randomUUID(); clearWritingAdmissionIntents(h.storage); return h.reply(); };
  await assert.rejects(h.make().enter(h.account, h.assignment), /đăng nhập/);
  assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
});

test('disposed controller stops before a request, while timeout preserves nonce and aborts transport', async () => {
  const h = harness(), c = h.make(); c.dispose();
  await assert.rejects(c.enter(h.account, h.assignment)); assert.equal(h.calls.length, 0);
  h.respond = () => new Promise(() => {});
  await assert.rejects(h.make({ timeoutMs: 10 }).enter(h.account, h.assignment), /Chưa xác nhận/);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][4].aborted, true);
  assert.equal(h.record().state, 'pending');
});

test('default OFF with no pending intent stays legacy; cleanup preserves only current account', async () => {
  const h = harness();
  const config = { enabled: false, getStorage: () => h.storage, accountId: h.account, assignmentId: h.assignment };
  assert.equal(shouldUseWritingAdmission(config), false);
  await h.make().enter(h.account, h.assignment);
  assert.equal(shouldUseWritingAdmission(config), false);
  h.rows.set('unrelated', 'retained');
  clearWritingAdmissionIntents(h.storage, h.account); assert.equal(h.rows.size, 2);
  clearWritingAdmissionIntents(h.storage); assert.deepEqual([...h.rows.keys()], ['unrelated']);
});

for (const kind of ['baseline_untracked', 'baseline_unclaimed']) {
  test(`${kind}: classify before mint, explicit baseline start and resume preserve canonical timer`, async () => {
    const h = harness();
    h.classify = async () => {
      if (h.classifications.length === 1) assert.equal(h.minted.length, 0);
      return h.entry(kind, h.calls.length > 0);
    };
    h.respond = async (method, path, body) => {
      assert.equal(method, 'POST'); assert.ok(path.endsWith('/baseline-entry'));
      assert.equal(body.protocol, 'baseline-v1'); return h.entry(kind, true);
    };
    const first = await h.make().enter(h.account, h.assignment);
    assert.equal(h.record().kind, 'baseline'); assert.equal(h.record().state, 'complete');
    assert.equal(h.record().commandId, null); assert.equal(h.calls[0][2].allow_start, true);
    const resumed = await h.make().enter(h.account, h.assignment, { allowCreate: false });
    assert.equal(h.calls[1][2].allow_start, false);
    assert.equal(resumed.timer.started_at, first.timer.started_at); assert.equal(h.minted.length, 1);
    assert.equal(h.calls[0][2].launch_nonce, h.calls[1][2].launch_nonce);
  });
}

test('fresh baseline URL reads an existing clock without minting or writing, but cannot start a null clock', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_untracked', true);
  const result = await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(result.started, true); assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 0);
  h.classify = async () => h.entry('baseline_untracked', false);
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }), /Bấm Bắt đầu/);
  assert.equal(h.calls.length, 0); assert.equal(h.minted.length, 0);
});

test('fresh terminal entry creates no nonce or mutation', async () => {
  const h = harness(); h.classify = async () => h.entry('terminal', true);
  const result = await h.make().enter(h.account, h.assignment);
  assert.equal(result.timer.status, 'submitted'); assert.equal(h.calls.length, 0); assert.equal(h.minted.length, 0);
});

test('lost baseline ACK retains nonce; reload revalidates resume-only without claiming an admission', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_unclaimed', h.calls.length > 0);
  h.respond = async () => { throw Error('lost ACK'); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  const pending = h.record(); assert.equal(pending.kind, undefined); assert.equal(pending.state, 'pending');
  assert.equal(shouldUseWritingAdmission({ enabled: false, getStorage: () => h.storage, accountId: h.account, assignmentId: h.assignment }), true);
  h.respond = async () => h.entry('baseline_unclaimed', true);
  await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(h.record().nonce, pending.nonce); assert.equal(h.record().kind, 'baseline');
  assert.equal(h.calls.at(-1)[2].allow_start, false); assert.equal(h.minted.length, 1);
});

test('old baseline-rejected A metadata is reused, never discarded or rotated before proof', async () => {
  const h = harness();
  h.respond = async () => { throw Object.assign(Error('old baseline rejection'), { status: 409 }); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  const pending = h.record();
  h.classify = async () => h.entry('baseline_untracked', true);
  h.respond = async () => { assert.equal(h.record().kind, undefined); return h.entry('baseline_untracked', true); };
  await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(h.record().nonce, pending.nonce); assert.equal(h.calls.at(-1)[2].launch_nonce, pending.nonce);
  assert.equal(h.calls.at(-1)[2].allow_start, false); assert.equal(h.minted.length, 1);
});

test('stale baseline hint rejected by SQL keeps unknown A metadata and cannot fall back', async () => {
  const h = harness(); h.respond = async () => { throw Error('lost A'); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  const pending = h.record(); h.classify = async () => h.entry('baseline_untracked', true);
  h.respond = async () => { throw Object.assign(Error('existing admission'), { status: 409 }); };
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }));
  assert.deepEqual(h.record(), pending); assert.equal(h.calls.length, 2);
  assert.ok(h.calls.at(-1)[1].endsWith('/baseline-entry')); assert.equal(h.minted.length, 1);
});

test('known pending command ignores even a baseline classification and recovers only its command', async () => {
  const h = harness(); h.respond = async (method, path) => {
    if (path.endsWith('/execute')) throw Error('lost B'); return h.reply();
  };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  h.classify = async () => assert.fail('known command must not classify');
  h.respond = async () => h.reply('bound');
  await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(h.calls.at(-1)[0], 'GET'); assert.ok(h.calls.at(-1)[1].endsWith(h.command));
});

for (const invalid of ['unknown', 'assignment', 'timer', 'terminal', 'eligible', 'admitted']) {
  test(`invalid entry ${invalid} is rejected before mint or write`, async () => {
    const h = harness();
    h.classify = async () => {
      const entry = h.entry();
      if (invalid === 'unknown') entry.kind = 'unexpected';
      if (invalid === 'assignment') entry.assignment_id = randomUUID();
      if (invalid === 'timer') entry.timer = null;
      if (invalid === 'terminal') entry.kind = 'terminal';
      if (invalid === 'eligible') entry.timer.status = 'in_progress';
      if (invalid === 'admitted') entry.kind = 'admitted';
      return entry;
    };
    await assert.rejects(h.make().enter(h.account, h.assignment));
    assert.equal(h.minted.length, 0); assert.equal(h.calls.length, 0);
  });
}

test('blocked or unavailable classification cannot mint intent or bypass to legacy', async () => {
  const h = harness(); h.classify = async () => h.entry('blocked');
  await assert.rejects(h.make().enter(h.account, h.assignment), /cần kiểm tra/);
  h.classify = async () => { throw Object.assign(Error('unavailable'), { status: 503 }); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.minted.length, 0); assert.equal(h.calls.length, 0);
});

test('unconfirmed baseline response never marks metadata complete', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_untracked');
  h.respond = async () => h.entry('baseline_untracked', false);
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.equal(h.record().state, 'pending'); assert.equal(h.record().kind, undefined);
});

test('baseline metadata cannot be repurposed as an eligible admission', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_untracked');
  h.respond = async () => h.entry('baseline_untracked', true);
  await h.make().enter(h.account, h.assignment);
  const saved = h.record(); h.classify = async () => h.entry('eligible');
  await assert.rejects(h.make().enter(h.account, h.assignment));
  assert.deepEqual(h.record(), saved); assert.equal(h.calls.length, 1);
});

test('account switch during classification sends no subsequent mutation', async () => {
  const h = harness(); h.classify = async () => { h.current = randomUUID(); return h.entry('baseline_untracked'); };
  await assert.rejects(h.make().enter(h.account, h.assignment), /đăng nhập/);
  assert.equal(h.minted.length, 0); assert.equal(h.calls.length, 0);
});

test('lost baseline request before commit cannot start on reload; a new explicit action uses the same nonce', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_untracked');
  h.respond = async () => { throw Error('request never committed'); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  const pending = h.record();
  h.respond = async (method, path, body) => {
    if (!body.allow_start) throw Object.assign(Error('explicit action required'), { status: 409 });
    return h.entry('baseline_untracked', true);
  };
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }));
  assert.equal(h.calls.at(-1)[2].allow_start, false); assert.deepEqual(h.record(), pending);
  await h.make().enter(h.account, h.assignment);
  assert.equal(h.calls.at(-1)[2].allow_start, true); assert.equal(h.record().nonce, pending.nonce);
  assert.equal(h.minted.length, 1); assert.equal(h.record().state, 'complete');
});

test('lost baseline cleanup is recoverable and cannot turn confirmed source state into a failure', async () => {
  const h = harness(); h.classify = async () => h.entry('baseline_unclaimed');
  h.respond = async () => { h.storage.setItem = () => { throw Error('storage full'); }; return h.entry('baseline_unclaimed', true); };
  const result = await h.make().enter(h.account, h.assignment);
  assert.equal(result.started, true); assert.equal(h.record().state, 'pending');
  assert.equal(h.record().kind, undefined);
});

test('terminal source cannot erase a pending unknown admission when absent lookup races admission commit', async () => {
  const h = harness(); h.respond = async () => { throw Error('lost A ACK'); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  const pending = h.record(); h.classify = async () => h.entry('terminal', true);
  h.respond = async () => { throw Object.assign(Error('existing admission'), { status: 409 }); };
  await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }));
  assert.deepEqual(h.record(), pending); assert.equal(h.minted.length, 1);
  assert.equal(h.calls.length, 2); assert.ok(h.calls.at(-1)[1].endsWith('/baseline-entry'));
  // If A commits after an absent lookup, the baseline RPC still refuses it.
  // Next recovery must read the now-visible command rather than discard it.
});

for (const phase of ['accepted', 'bound', 'unstarted_expired']) {
  test(`lost command ID with terminal source recovers ${phase} by nonce without executing or inventing success`, async () => {
    const h = harness(); h.respond = async () => { throw Error('lost A ACK'); };
    await assert.rejects(h.make().enter(h.account, h.assignment));
    const nonce = h.record().nonce;
    const canonical = h.reply(phase); canonical.timer.status = 'submitted';
    h.lookup = async () => ({ found: true, admission: canonical });
    h.classify = async () => assert.fail('found command must bypass entry classification');
    h.respond = async () => assert.fail('terminal read must not execute, prepare or baseline-start');
    const result = await h.make().enter(h.account, h.assignment, { allowCreate: false });
    assert.equal(result.timer.status, 'submitted'); assert.equal(result.command.phase, phase);
    assert.equal(h.lookups.length, 1); assert.ok(h.lookups[0][1].endsWith(nonce));
    assert.equal(h.record().commandId, h.command); assert.equal(h.record().nonce, nonce);
    assert.equal(h.record().state, phase === 'bound' ? 'complete' : phase === 'accepted' ? 'pending' : 'fenced');
    assert.equal(h.calls.length, 1); assert.equal(h.minted.length, 1);
  });
}

test('nonce recovery persists command before execution and skips a new prepare', async () => {
  const h = harness(); h.respond = async () => { throw Error('lost A'); };
  await assert.rejects(h.make().enter(h.account, h.assignment));
  h.lookup = async () => ({ found: true, admission: h.reply() });
  h.respond = async (method, path) => {
    assert.equal(h.record().commandId, h.command); assert.ok(path.endsWith('/execute')); return h.reply('bound');
  };
  const result = await h.make().enter(h.account, h.assignment, { allowCreate: false });
  assert.equal(result.command.phase, 'bound'); assert.equal(h.calls.length, 2);
  assert.equal(h.classifications.length, 1); assert.equal(h.minted.length, 1);
});

for (const malformed of ['missing', 'boolean', 'false_with_result', 'true_without_result', 'wrong_assignment']) {
  test(`malformed nonce lookup ${malformed} cannot become absence or permit a write`, async () => {
    const h = harness(); h.respond = async () => { throw Error('lost A'); };
    await assert.rejects(h.make().enter(h.account, h.assignment));
    const pending = h.record();
    h.lookup = async () => {
      if (malformed === 'missing') return {};
      if (malformed === 'boolean') return { found: 'false', admission: null };
      if (malformed === 'false_with_result') return { found: false, admission: h.reply() };
      if (malformed === 'true_without_result') return { found: true, admission: null };
      return { found: true, admission: { ...h.reply(), assignment_id: randomUUID() } };
    };
    await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }));
    assert.deepEqual(h.record(), pending); assert.equal(h.calls.length, 1); assert.equal(h.classifications.length, 1);
  });
}

for (const status of [404, 503]) {
  test(`nonce lookup HTTP ${status} is not missing-command proof`, async () => {
    const h = harness(); h.respond = async () => { throw Error('lost A'); };
    await assert.rejects(h.make().enter(h.account, h.assignment));
    const pending = h.record(); h.lookup = async () => { throw Object.assign(Error(), { status }); };
    await assert.rejects(h.make().enter(h.account, h.assignment, { allowCreate: false }));
    assert.deepEqual(h.record(), pending); assert.equal(h.calls.length, 1); assert.equal(h.minted.length, 1);
  });
}
