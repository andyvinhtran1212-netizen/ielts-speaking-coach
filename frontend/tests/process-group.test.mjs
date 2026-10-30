import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { killGroup, spawnGroup } from '../tooling/process-group.mjs';

// Fallback so a regressed helper fails (or times out) without leaking children.
const spawned = new Set();
after(() => {
  for (const pid of spawned) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
});

function start(source) {
  const child = spawnGroup(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'inherit'] });
  spawned.add(child.pid);
  return child;
}

async function ready(child) {
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes('\n')) {
      const pid = Number(output.trim());
      spawned.add(pid);
      return pid;
    }
  }
  throw new Error('Child exited before readiness');
}

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

const pgid = (pid) => Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[2]);

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
