// Repeat local fixture journeys; see tooling/README.md for build and shell usage.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { killGroup, spawnGroup } from './process-group.mjs';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const signalCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
const { values } = parseArgs({ options: {
  flow: { type: 'string' }, runs: { type: 'string' }, mode: { type: 'string', default: 'start' },
  'isolate-net': { type: 'boolean', default: false },
} });
const runs = Number(values.runs);
if (!values.flow || !/^\d+$/.test(values.runs || '') || !Number.isSafeInteger(runs) || runs < 1
    || !['start', 'dev'].includes(values.mode)) {
  throw new Error('Usage: node tooling/run-flow-repeat.mjs --flow tooling/xxx.mjs --runs N [--mode start|dev] [--isolate-net]');
}
const flow = resolve(frontend, values.flow);
const flowRelative = relative(resolve(frontend, 'tooling'), flow);
if (flowRelative.startsWith(`..${sep}`) || flowRelative === '..' || !flow.endsWith('.mjs') || !existsSync(flow)) {
  throw new Error('--flow must name an existing .mjs file under frontend/tooling');
}

// Linux only, fail closed if unshare/ip or namespace permissions are missing.
// The inner runner owns all servers and finishes their cleanup before exiting.
async function isolated() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--isolate-net');
  const child = spawnGroup('unshare', ['--user', '--map-root-user', '--net', '--', 'sh', '-c',
    'ip link set lo up || exit 1; exec "$@"', 'run-flow-repeat', process.execPath,
    fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
  const handlers = Object.keys(signalCodes).map((signal) => {
    const handler = () => { try { child.kill(signal); } catch {} };
    process.on(signal, handler);
    return [signal, handler];
  });
  const fallback = () => { void killGroup(child, 'SIGKILL').catch(() => {}); };
  process.on('exit', fallback);
  try {
    return await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => done(code ?? signalCodes[signal] ?? 1));
    });
  } finally {
    handlers.forEach(([signal, handler]) => process.off(signal, handler));
    process.off('exit', fallback);
  }
}

function groupMembers(groups) {
  // Check the PGIDs even after the leaders exit; PID-only checks miss workers.
  // Include leader PIDs too so a missing detached:true cannot pass this audit.
  const ids = new Set(groups.map(({ child }) => child.pid).filter(Boolean));
  return execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,comm='], { encoding: 'utf8' })
    .trim().split('\n').filter((line) => {
      const [pid, pgid] = line.trim().split(/\s+/).map(Number);
      return ids.has(pid) || ids.has(pgid);
    });
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const { port } = server.address();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

async function repeat() {
  if (values.mode === 'dev') {
    // Same step as npm predev: public/vendor/ is gitignored, so without it
    // next dev serves 404 for /vendor/* and journeys fail falsely.
    execFileSync(process.execPath, ['tooling/vendor-runtime.mjs'], { cwd: frontend, stdio: 'inherit' });
  }
  const controller = new AbortController();
  const { signal } = controller;
  const liveGroups = new Set();
  let current = [];
  let passed = 0;
  let failed = 0;
  let exitCode = 0;
  const stop = (error, code) => {
    exitCode ||= code;
    controller.abort(error);
  };
  const handlers = Object.entries(signalCodes).map(([name, code]) => {
    const handler = () => stop(new Error(`Interrupted by ${name}`), code);
    process.on(name, handler);
    return [name, handler];
  });
  const onFatal = (error) => stop(error instanceof Error ? error : new Error(String(error)), 1);
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);
  const fallback = () => {
    for (const { child, ended } of liveGroups) {
      // An unreaped direct child still owns its PID. Once it exits, a reused
      // PGID cannot establish ownership; async cleanup audits its workers.
      if (!ended) void killGroup(child, 'SIGKILL').catch(() => {});
    }
  };
  process.on('exit', fallback);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // It may fire between awaited operations; the next boundary still observes it.
  void aborted.catch(() => {});

  function start(label, args, env) {
    signal.throwIfAborted();
    const child = spawnGroup(process.execPath, args, { cwd: frontend, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { child, label, output: '', ended: false };
    entry.done = new Promise((done) => {
      child.once('error', (error) => { entry.ended = true; done({ error }); });
      child.once('exit', (code, signal) => { entry.ended = true; done({ code, signal }); });
    });
    current.push(entry);
    liveGroups.add(entry);
    const output = (chunk) => {
      entry.output = (entry.output + chunk).slice(-12000);
      if (label === 'flow') process.stdout.write(chunk);
    };
    child.stdout.on('data', output);
    child.stderr.on('data', output);
    console.log(`[repeat] ${label} PGID=${child.pid}`);
    return entry;
  }

  async function ready(entry, match) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (entry.ended) throw new Error(`${entry.label} exited before ready: ${entry.output}`);
      const value = match(entry.output);
      if (value) return value;
      await delay(50, undefined, { signal });
    }
    throw new Error(`${entry.label} startup timed out: ${entry.output}`);
  }

  async function cleanup() {
    const results = await Promise.allSettled(current.map(({ child }) => killGroup(child)));
    const errors = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
    const remaining = groupMembers(current);
    if (remaining.length) errors.push(new Error(`Owned processes remain (PID PGID STAT COMMAND):\n${remaining.join('\n')}`));
    else {
      await Promise.all(current.map((entry) => entry.done));
      for (const entry of current) liveGroups.delete(entry);
    }
    if (errors.length) throw new AggregateError(errors, 'Process group cleanup failed');
    console.log('[repeat] cleanup verified: no owned group members');
  }

  try {
    for (let run = 1; run <= runs && !signal.aborted; run++) {
      current = [];
      let error;
      let cleanupFailed = false;
      console.log(`[repeat] run ${run}/${runs} (${values.mode})`);
      try {
        const env = { ...process.env, AVER_ENVIRONMENT: 'test', VERCEL_ENV: 'development',
          NODE_ENV: values.mode === 'start' ? 'production' : 'development',
          AVER_SUPABASE_URL: 'https://example.supabase.co', AVER_SUPABASE_ANON_KEY: 'test-anon-key',
          SUPABASE_URL: 'https://example.supabase.co', NEXT_NATIVE_FIXTURE_PORT: '0' };
        const fixture = start('fixture', ['tooling/next-native-fixture-api.mjs'], env);
        const fixtureOrigin = await ready(fixture, (out) => /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1]);
        const health = await fetch(`${fixtureOrigin}/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
        if (!health.ok || (await health.json()).fixture !== 'next-native-browser') throw new Error('Fixture health check failed');
        const port = await freePort();
        const base = `http://127.0.0.1:${port}`;
        Object.assign(env, { AVER_API_BASE: fixtureOrigin, NEXT_NATIVE_FIXTURE_PORT: new URL(fixtureOrigin).port, TEST_PORT: String(port) });
        const next = start('next', ['node_modules/next/dist/bin/next', values.mode, '--hostname', '127.0.0.1', '--port', String(port)], env);
        await ready(next, (out) => out.includes('Ready in'));
        const response = await fetch(`${base}/js/runtime-config.js`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error(`Next readiness HTTP ${response.status}`);
        const journey = start('flow', [flow, base], env);
        let timeout;
        try {
          const result = await Promise.race([
            aborted, journey.done,
            ...[fixture, next].map((server) => server.done.then(() => { throw new Error(`${server.label} exited during flow: ${server.output}`); })),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Flow timed out after 5 minutes')), 300000); }),
          ]);
          if (result.error) throw result.error;
          if (result.code !== 0) throw new Error(`Flow exited ${result.code ?? result.signal}`);
        } finally { clearTimeout(timeout); }
      } catch (original) {
        error = original;
        console.error(`[repeat] run ${run}: ${original.stack || original}`);
      } finally {
        // Report both failures; a teardown error must not hide startup/flow errors.
        try { await cleanup(); } catch (cleanupError) {
          cleanupFailed = true;
          error ||= cleanupError;
          console.error(cleanupError, cleanupError.errors);
        }
      }
      if (error) { failed++; console.error(`[repeat] run ${run} FAIL`); }
      else { passed++; console.log(`[repeat] run ${run} PASS`); }
      if (cleanupFailed) break;
    }
  } finally {
    try {
      const remaining = groupMembers([...liveGroups]);
      if (remaining.length) throw new Error(`Final audit found owned processes:\n${remaining.join('\n')}`);
      console.log('[repeat] final audit: no owned group members');
    } catch (error) { exitCode ||= 1; console.error(error); }
    console.log(`[repeat] ${passed} pass / ${failed} fail (${runs} requested)`);
    handlers.forEach(([name, handler]) => process.off(name, handler));
    process.off('uncaughtException', onFatal);
    process.off('unhandledRejection', onFatal);
    signal.removeEventListener('abort', onAbort);
    // Retain the synchronous fallback if an audit failed.
    if (!exitCode && !failed) process.off('exit', fallback);
  }
  return exitCode || (failed ? 1 : 0);
}

// Cleanup/audits are complete. Exit explicitly even if a broken group helper
// left inherited worker pipes open; the nonzero audit result must reach callers.
process.exit(values['isolate-net'] ? await isolated() : await repeat());
