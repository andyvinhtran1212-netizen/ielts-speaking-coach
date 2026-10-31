import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, test } from 'node:test';
import { killGroup, spawnGroup } from '../tooling/process-group.mjs';
import { descendants } from './fixtures/owned-process-tree.mjs';

// Fallback so a regressed helper fails (or times out) without leaking children.
const spawned = new Map();
afterEach(async () => {
  for (const [child, reaped] of spawned) {
    if (child.pid && child.exitCode === null && child.signalCode === null) await killGroup(child, 'SIGKILL');
    await reaped;
  }
  spawned.clear();
  assert.deepEqual(descendants(process.pid), [], 'test left live or zombie descendants');
});

function start(source) {
  const child = spawnGroup(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'inherit'] });
  spawned.set(child, new Promise((done) => {
    child.once('exit', done);
    child.once('error', done);
  }));
  return child;
}

async function ready(child) {
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes('\n')) {
      const pid = Number(output.trim());
      return pid;
    }
  }
  throw new Error('Child exited before readiness');
}

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

// `ps -o pgid=` is POSIX (procps on Linux, BSD ps on macOS); /proc is Linux-only.
function pgid(pid) {
  const value = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
  assert.ok(Number.isInteger(value) && value > 0, `no process group for pid ${pid}`);
  return value;
}

test('spawnGroup makes the child lead its own process group', { timeout: 10000 }, async () => {
  const child = start('setInterval(() => {}, 1000); console.log(process.pid);');
  try {
    await ready(child);
    assert.equal(pgid(child.pid), child.pid);
    assert.notEqual(pgid(child.pid), pgid(process.pid));
  } finally {
    await killGroup(child, 'SIGKILL');
  }
});

test('cleanup terminates a detached server and its worker, and tolerates repeat calls', { timeout: 10000 }, async () => {
  const child = start(`
    const { spawn } = require('node:child_process');
    const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    process.on('SIGTERM', () => {});
    worker.once('exit', () => process.exit(0));
    worker.on('spawn', () => console.log(worker.pid));
  `);
  const exited = once(child, 'exit');
  try {
    const workerPid = await ready(child);
    await killGroup(child);
    assert.deepEqual(await exited, [0, null]);
    assertGone(child.pid);
    assertGone(workerPid);
    await killGroup(child);
  } finally {
    await killGroup(child, 'SIGKILL');
  }
});

test('cleanup escalates when a server ignores SIGTERM', { timeout: 10000 }, async () => {
  const child = start(`
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    console.log(process.pid);
  `);
  const exited = once(child, 'exit');
  try {
    await ready(child);
    const started = Date.now();
    await killGroup(child, 'SIGTERM', { graceMs: 150 });
    assert.ok(Date.now() - started >= 150, 'SIGKILL waits for the grace period');
    assert.deepEqual(await exited, [null, 'SIGKILL']);
    assertGone(child.pid);
  } finally {
    await killGroup(child, 'SIGKILL');
  }
});

test('cleanup tolerates a child that never spawned', async () => {
  const child = spawnGroup('/nonexistent/grammar-navigation-node', []);
  await once(child, 'error');
  await killGroup(child);
  await killGroup(undefined);
});
