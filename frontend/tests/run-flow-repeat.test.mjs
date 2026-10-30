import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const runnerSource = await readFile(new URL('../tooling/run-flow-repeat.mjs', import.meta.url), 'utf8');
const groupSource = await readFile(new URL('../tooling/process-group.mjs', import.meta.url), 'utf8');
const readme = await readFile(new URL('../tooling/README.md', import.meta.url), 'utf8');
const shellSource = /```bash\n(# Shell fallback[\s\S]*?)```/.exec(readme)[1];

// A server plus a sleeping worker, like next dev -> next-server. The parent
// reaps its worker on TERM, but never forwards TERM: leader-only kills leak.
const serverSource = `
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const fixture = process.argv[1].includes('fixture');
if (!fixture && process.env.STUB_STARTUP_FAIL) {
  console.error('original startup failure'); process.exit(42);
}
const log = (role) => appendFileSync(process.env.PID_LOG, JSON.stringify({pid:process.pid, role})+'\\n');
const worker = spawn(process.execPath, ['--input-type=module', '-e', \`
  import { appendFileSync } from 'node:fs';
  appendFileSync(process.env.PID_LOG, JSON.stringify({pid:process.pid, role:'worker'})+'\\\\n');
  if (process.env.STUB_STUBBORN) process.on('SIGTERM', () => {});
  process.send('ready'); setInterval(() => {}, 1000);
\`], { stdio:['ignore','ignore','inherit','ipc'] });
let server;
process.on('SIGTERM', () => {});
worker.once('exit', () => { if (server) server.close(() => process.exit(0)); else process.exit(0); });
worker.once('message', () => {
  server = createServer((req, res) => res.end(JSON.stringify({fixture:'next-native-browser'})));
  const port = fixture ? Number(process.env.NEXT_NATIVE_FIXTURE_PORT) : Number(process.argv.at(-1));
  server.listen(port, '127.0.0.1', () => {
    log(fixture ? 'fixture' : 'next');
    console.log(fixture ? 'listening on http://127.0.0.1:'+server.address().port : 'Ready in 1ms');
  });
});
`;
const flowSource = `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.PID_LOG, JSON.stringify({pid:process.pid,role:'flow'})+'\\n');
if (process.env.STUB_WAIT) setInterval(() => {}, 1000);
else { await fetch(process.argv[2]+'/js/runtime-config.js'); process.exitCode=Number(process.env.STUB_FAIL || 0); }
`;

function processTable() {
  return execFileSync('ps', ['-A', '-o', 'pid=,pgid='], { encoding: 'utf8' }).trim().split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
}
function members(ids) {
  return processTable().filter(([pid, pgid]) => ids.has(pid) || ids.has(pgid));
}
async function until(check, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await delay(25); }
  throw new Error(`Timed out waiting for ${label}`);
}

async function harness(t, { helper = groupSource, runner = runnerSource, env = {}, shell = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'flow-repeat-'));
  const ids = new Set();
  let child;
  let output = '';
  let result;
  const pidLog = join(dir, 'pids.jsonl');
  const records = async () => {
    const text = await readFile(pidLog, 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; });
    const rows = text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line)) : [];
    rows.forEach(({ pid }) => ids.add(pid));
    return rows;
  };
  t.after(async () => {
    await records();
    // Independent fallback: mutations must fail assertions without leaking.
    if (child?.pid) ids.add(child.pid);
    for (const [pid, pgid] of members(ids)) {
      if (ids.has(pgid)) { try { process.kill(-pgid, 'SIGKILL'); } catch {} }
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    if (result) await result;
    await until(() => members(ids).length === 0, 'fallback process cleanup');
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, 'tooling'), { recursive: true });
  await mkdir(join(dir, 'node_modules/next/dist/bin'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'tooling/process-group.mjs'), helper);
  await writeFile(join(dir, 'tooling/run-flow-repeat.mjs'), runner);
  await writeFile(join(dir, 'tooling/next-native-fixture-api.mjs'), serverSource);
  await writeFile(join(dir, 'node_modules/next/dist/bin/next'), serverSource);
  // The extensionless Next bin is a module in its actual npm package too.
  await writeFile(join(dir, 'node_modules/next/package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'tooling/fake-flow.mjs'), flowSource);
  await writeFile(join(dir, 'shell.sh'), shellSource);
  return {
    ids, records,
    get output() { return output; },
    start(extra = []) {
      child = spawn(shell ? 'bash' : process.execPath, shell ? ['shell.sh'] : [
        'tooling/run-flow-repeat.mjs', '--flow', 'tooling/fake-flow.mjs', '--runs', '2', ...extra,
      ], { cwd: dir, env: { ...process.env, PID_LOG: pidLog, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      ids.add(child.pid);
      const collect = (chunk) => {
        output += chunk;
        for (const match of output.matchAll(/PGID=(\d+)/g)) ids.add(Number(match[1]));
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      result = new Promise((done, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => done({ code, signal }));
      });
      return { child, result };
    },
    async assertClean() {
      await records();
      assert.deepEqual(members(ids), [], `owned PID/PGID remains; output:\n${output}`);
    },
  };
}

test('repeat runner cleans every round after success, including next workers', { timeout: 30000 }, async (t) => {
  const h = await harness(t);
  assert.deepEqual(await h.start().result, { code: 0, signal: null });
  assert.match(h.output, /2 pass \/ 0 fail/);
  assert.equal(h.output.match(/cleanup verified/g)?.length, 2);
  assert.equal((await h.records()).filter(({ role }) => role === 'worker').length, 4);
  await h.assertClean();
});

test('failed flows still repeat and clean fixture, next, flow and workers', { timeout: 30000 }, async (t) => {
  const h = await harness(t, { env: { STUB_FAIL: '2' } });
  assert.equal((await h.start(['--mode', 'dev']).result).code, 1);
  assert.match(h.output, /0 pass \/ 2 fail/);
  assert.equal(h.output.match(/cleanup verified/g)?.length, 2);
  await h.assertClean();
});

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  test(`${signal} during a flow cleans all owned groups`, { timeout: 30000 }, async (t) => {
    const h = await harness(t, { env: { STUB_WAIT: '1' } });
    const run = h.start();
    await until(async () => (await h.records()).some(({ role }) => role === 'flow'), 'flow readiness');
    run.child.kill(signal);
    assert.equal((await run.result).code, code);
    assert.match(h.output, /final audit: no owned group members/);
    await h.assertClean();
  });
}

test('SIGINT during fixture startup prevents next and flow spawning', { timeout: 30000 }, async (t) => {
  const h = await harness(t);
  const run = h.start();
  await until(() => h.output.includes('fixture PGID='), 'fixture spawn');
  run.child.kill('SIGINT');
  assert.equal((await run.result).code, 130);
  assert.doesNotMatch(h.output, /next PGID=|flow PGID=/);
  await h.assertClean();
});

test('SIGKILL escalation waits until the stubborn server groups are gone', { timeout: 30000 }, async (t) => {
  const h = await harness(t, { env: { STUB_STUBBORN: '1' } });
  const started = Date.now();
  assert.equal((await h.start(['--runs', '1']).result).code, 0);
  assert.ok(Date.now() - started >= 5000);
  await h.assertClean();
});

test('startup failure stays visible when cleanup also fails', { timeout: 30000 }, async (t) => {
  const helper = groupSource.replace('export async function killGroup(', 'async function realKillGroup(')
    + '\nexport async function killGroup(...args) { await realKillGroup(...args); throw new Error("injected cleanup failure"); }\n';
  const h = await harness(t, { helper, env: { STUB_STARTUP_FAIL: '1' } });
  assert.equal((await h.start().result).code, 1);
  assert.match(h.output, /original startup failure/);
  assert.match(h.output, /injected cleanup failure/);
  await h.assertClean();
});

test('an uncaught runner exception aborts the flow and cleans servers', { timeout: 30000 }, async (t) => {
  const runner = runnerSource.replace('current.push(entry);', `
    if (label === 'flow') setTimeout(() => { throw new Error('injected uncaught exception'); }, 100);
    current.push(entry);`);
  const h = await harness(t, { runner, env: { STUB_WAIT: '1' } });
  assert.equal((await h.start().result).code, 1);
  assert.match(h.output, /injected uncaught exception/);
  await h.assertClean();
});

for (const [name, helper] of [
  ['missing detached', groupSource.replace('{ ...opts, detached: true }', '{ ...opts, detached: false }')],
  ['leader-only kill', groupSource.replace('process.kill(-child.pid, signal)', 'process.kill(child.pid, signal)')],
]) {
  test(`negative control rejects ${name} and detects the leaked worker`, { timeout: 30000 }, async (t) => {
    const h = await harness(t, { helper });
    assert.equal((await h.start(['--runs', '1']).result).code, 1);
    await assert.rejects(h.assertClean(), /owned PID\/PGID remains/);
    // t.after uses its own PID/group kills, independent of the mutated helper.
  });
}

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  test(`documented setsid shell trap cleans next and fixture on ${signal}`, { timeout: 30000 }, async (t) => {
    // Fixture and fake Next accept port 0, avoiding shared-machine collisions.
    const h = await harness(t, { shell: true, env: { NEXT_NATIVE_FIXTURE_PORT: '0', TEST_PORT: '0' } });
    const run = h.start();
    await until(async () => (await h.records()).filter(({ role }) => ['next', 'fixture'].includes(role)).length === 2, 'shell servers');
    run.child.kill(signal);
    assert.equal((await run.result).code, code);
    await h.assertClean();
  });
}
