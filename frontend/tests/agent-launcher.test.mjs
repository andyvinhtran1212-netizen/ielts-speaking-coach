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

function launch(overrides, check) {
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
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$AVER_API_BASE" "$VERCEL_ENV" > "$LAUNCH_MARKER"\n');
    chmodSync(path.join(bin, 'npm'), 0o755);
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith('AVER_') && !key.startsWith('VERCEL_')));
    Object.assign(env, { PATH: bin + path.delimiter + env.PATH, LAUNCH_MARKER: marker }, overrides);
    const result = spawnSync(launcher.runtimeExecutable, launcher.runtimeArgs, { cwd: root, env, encoding: 'utf8' });
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
  launch({ VERCEL_ENV: 'production', AVER_SUPABASE_URL: 'https://huwsmtubwulikhlmcirx.supabase.co' },
    (result, config, started) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /REFUSING to build/);
      assert.equal(config, undefined);
      assert.equal(started, false);
    });
});
