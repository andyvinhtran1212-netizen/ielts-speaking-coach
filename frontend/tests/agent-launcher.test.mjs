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
    copyFileSync(path.join(ROOT, 'frontend/tooling/generate-runtime-config.mjs'),
      path.join(frontend, 'tooling/generate-runtime-config.mjs'));
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, path.join(bin, 'node'));
    const marker = path.join(root, 'next-started');
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nif [ "$1" != "run" ]; then exit 0; fi\nprintf "%s\\n" "$AVER_API_BASE" "$VERCEL_ENV" > "$LAUNCH_MARKER"\n');
    chmodSync(path.join(bin, 'npm'), 0o755);
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith('AVER_') && !key.startsWith('VERCEL_')));
    Object.assign(env, { PATH: bin + path.delimiter + env.PATH, LAUNCH_MARKER: marker }, overrides);
    const result = spawnSync(launcher.runtimeExecutable, command, { cwd: root, env, encoding: 'utf8' });
    const configPath = path.join(frontend, 'public/js/runtime-config.js');
    const window = {};
    if (existsSync(configPath)) vm.runInNewContext(readFileSync(configPath, 'utf8'), { window });
    check(result, window.__AVER_RUNTIME_CONFIG__, existsSync(marker));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('fresh launcher generates staging auth and local API before Next starts', () => {
  launch({}, (result, config, started) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
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
  launch({ VERCEL_ENV: 'production', AVER_RUNTIME_CONFIG_OUT: '/dev/null' }, (result, config, started) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(started);
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
