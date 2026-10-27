import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = JSON.parse(readFileSync(path.join(ROOT, 'backend/scripts/agent-config/launch.json'), 'utf8'))
  .configurations.find(({ name }) => name === 'frontend-next');

function launch(overrides, check, command = launcher.runtimeArgs) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-launcher-'));
  try {
    const frontend = path.join(root, 'frontend');
    mkdirSync(path.join(frontend, 'tooling'), { recursive: true });
    mkdirSync(path.join(frontend, 'public/js'), { recursive: true });
    for (const file of ['generate-runtime-config.mjs', 'runtime-origins.mjs', 'content-security-policy.mjs']) {
      copyFileSync(path.join(ROOT, 'frontend/tooling', file), path.join(frontend, 'tooling', file));
    }
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, path.join(bin, 'node'));
    const marker = path.join(root, 'next-started');
    // `npm run dev` stub: like `next dev`, build the real CSP from the
    // launcher's environment (next.config.ts throws on an unusable origin)
    // before recording that Next started.
    writeFileSync(path.join(bin, 'npm'), [
      '#!/bin/sh',
      'if [ "$1" != "run" ]; then exit 0; fi',
      'NODE_ENV=development node --input-type=module -e "import { buildContentSecurityPolicy } from \'./tooling/content-security-policy.mjs\'; process.stdout.write(buildContentSecurityPolicy(process.env));" > "$LAUNCH_MARKER.csp" || exit 1',
      'printf "%s\\n" "$AVER_API_BASE" "$VERCEL_ENV" > "$LAUNCH_MARKER"',
      '',
    ].join('\n'));
    chmodSync(path.join(bin, 'npm'), 0o755);
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith('AVER_') && !key.startsWith('VERCEL_')));
    Object.assign(env, { PATH: bin + path.delimiter + env.PATH, LAUNCH_MARKER: marker }, overrides);
    const result = spawnSync(launcher.runtimeExecutable, command, { cwd: root, env, encoding: 'utf8' });
    const configPath = path.join(frontend, 'public/js/runtime-config.js');
    const window = {};
    if (existsSync(configPath)) vm.runInNewContext(readFileSync(configPath, 'utf8'), { window });
    const csp = existsSync(marker + '.csp') ? readFileSync(marker + '.csp', 'utf8') : '';
    check(result, window.__AVER_RUNTIME_CONFIG__, existsSync(marker), csp);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function connectSrc(csp) {
  const entry = csp.split('; ').find((directive) => directive.startsWith('connect-src '));
  assert.ok(entry, csp);
  return entry.split(' ').slice(1);
}

test('fresh launcher generates staging auth and local API before Next starts', () => {
  launch({}, (result, config, started, csp) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
    // The dev CSP admits exactly the loopback API the runtime config points at.
    const connect = connectSrc(csp);
    assert.ok(connect.includes('http://localhost:8000'), connect.join(' '));
    assert.ok(connect.includes('https://zjphffoujxkpltixsbzj.supabase.co'), connect.join(' '));
    assert.ok(!connect.includes('https:') && !connect.includes('wss:'), connect.join(' '));
    assert.equal(config.environment, 'test');
    assert.equal(config.apiBase, 'http://localhost:8000');
    assert.equal(config.supabaseUrl, 'https://zjphffoujxkpltixsbzj.supabase.co');
    assert.ok(config.supabaseAnonKey);
  });
});

test('launcher accepts an explicit development Supabase pair', () => {
  launch({ AVER_SUPABASE_URL: 'https://dev-project.supabase.co', AVER_SUPABASE_ANON_KEY: 'dev-public-key' },
    (result, config, started) => {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(started);
      assert.equal(config.supabaseUrl, 'https://dev-project.supabase.co');
      assert.equal(config.supabaseAnonKey, 'dev-public-key');
    });
});

test('production auth override fails before Next starts', () => {
  launch({ VERCEL_ENV: 'production', AVER_SUPABASE_URL: 'https://huwsmtubwulikhlmcirx.supabase.co', AVER_SUPABASE_ANON_KEY: 'production-public-key' },
    (result, config, started) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /REFUSING to build/);
      assert.equal(config, undefined);
      assert.equal(started, false);
    });
});

for (const overrides of [
  { AVER_SUPABASE_URL: 'https://dev-project.supabase.co' },
  { AVER_SUPABASE_ANON_KEY: 'dev-public-key' },
  { AVER_SUPABASE_URL: 'https://dev-project.supabase.co', AVER_SUPABASE_ANON_KEY: '' },
  { AVER_SUPABASE_URL: '', AVER_SUPABASE_ANON_KEY: 'dev-public-key' },
]) {
  test('partial Supabase override fails before Next: ' + JSON.stringify(overrides), () => {
    launch(overrides, (result, config, started) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Set both AVER_SUPABASE_URL and AVER_SUPABASE_ANON_KEY/);
      assert.equal(config, undefined);
      assert.equal(started, false);
    });
  });
}

test('empty override pair uses the staging preset', () => {
  launch({ AVER_SUPABASE_URL: '', AVER_SUPABASE_ANON_KEY: '' }, (result, config, started) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
    assert.equal(config.supabaseUrl, 'https://zjphffoujxkpltixsbzj.supabase.co');
    assert.ok(config.supabaseAnonKey);
  });
});

test('inherited output override cannot leave served runtime config unconfigured', () => {
  launch({ AVER_RUNTIME_CONFIG_OUT: '/dev/null' }, (result, config, started) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
    assert.equal(config.apiBase, 'http://localhost:8000');
    assert.equal(config.supabaseUrl, 'https://zjphffoujxkpltixsbzj.supabase.co');
  });
});

const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const manualSetup = readme.match(/Frontend, in a separate terminal[\s\S]*?```bash\n([\s\S]*?)```/)[1];

test('documented manual setup generates local development config before startup', () => {
  launch({ VERCEL_ENV: 'production', AVER_RUNTIME_CONFIG_OUT: '/dev/null' }, (result, config, started, csp) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
    const connect = connectSrc(csp);
    assert.ok(connect.includes('http://localhost:8000'), connect.join(' '));
    assert.ok(connect.includes('https://your-dev-project.supabase.co'), connect.join(' '));
    assert.equal(config.environment, 'test');
    assert.equal(config.apiBase, 'http://localhost:8000');
    assert.equal(config.supabaseUrl, 'https://YOUR-DEV-PROJECT.supabase.co');
  }, ['-c', manualSetup]);
});

for (const [from, production] of [
  ['http://localhost:8000', 'https://ielts-speaking-coach-production.up.railway.app'],
  ['https://YOUR-DEV-PROJECT.supabase.co', 'https://huwsmtubwulikhlmcirx.supabase.co'],
]) {
  test('documented manual setup rejects production origin: ' + production, () => {
    launch({}, (result, config, started) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /REFUSING to build/);
      assert.equal(config, undefined);
      assert.equal(started, false);
    }, ['-c', manualSetup.replace(from, production)]);
  });
}
