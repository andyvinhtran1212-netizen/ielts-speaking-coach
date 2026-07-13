// Runtime config (plan §7.1 / ADR-006) — the single generated public config
// shared by legacy pages and (later) Next.js. Pins:
//   1. the committed js/runtime-config.js is the UNCONFIGURED default,
//   2. the generator's environment resolution + preview fail-closed guard,
//   3. api.js prefers config over hostname inference,
//   4. every page that loads api.js loads runtime-config.js FIRST,
//   5. the production-hardcoded /api/public-stats external rewrite stays gone.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const GENERATOR = path.join(FRONTEND, 'tooling', 'generate-runtime-config.mjs');
const COMMITTED = path.join(FRONTEND, 'js', 'runtime-config.js');

const PROD_MARKERS = ['ielts-speaking-coach-production.up.railway.app', 'huwsmtubwulikhlmcirx'];

function runGenerator(env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rc-'));
  const out = path.join(dir, 'runtime-config.js');
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith('VERCEL') || k.startsWith('AVER_')) delete cleanEnv[k];
  }
  const res = spawnSync(process.execPath, [GENERATOR], {
    env: { ...cleanEnv, AVER_RUNTIME_CONFIG_OUT: out, ...env },
    encoding: 'utf8',
  });
  let content = null;
  try { content = readFileSync(out, 'utf8'); } catch { /* build refused */ }
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, content, stderr: res.stderr };
}

describe('committed default', () => {
  test('js/runtime-config.js is the unconfigured default (all null)', () => {
    const src = readFileSync(COMMITTED, 'utf8');
    assert.match(src, /window\.__AVER_RUNTIME_CONFIG__\s*=\s*Object\.freeze\(/);
    for (const field of ['environment', 'apiBase', 'supabaseUrl', 'supabaseAnonKey']) {
      assert.match(src, new RegExp(`"${field}": null`), `${field} must be null in the committed copy`);
    }
  });

  test('committed copy is byte-identical to a no-env generator run', () => {
    const { status, content } = runGenerator({});
    assert.equal(status, 0);
    assert.equal(content, readFileSync(COMMITTED, 'utf8'),
      'committed js/runtime-config.js drifted — run: node tooling/generate-runtime-config.mjs');
  });
});

describe('generator environment resolution', () => {
  test('VERCEL_ENV=preview resolves to staging with zero production origins', () => {
    const { status, content } = runGenerator({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging' });
    assert.equal(status, 0);
    assert.match(content, /"environment": "staging"/);
    assert.match(content, /ielts-speaking-coach-staging\.up\.railway\.app/);
    assert.match(content, /zjphffoujxkpltixsbzj/);
    for (const m of PROD_MARKERS) {
      assert.ok(!content.includes(m), `preview config must not contain production origin ${m}`);
    }
  });

  test('VERCEL_ENV=production resolves to production origins', () => {
    const { status, content } = runGenerator({ VERCEL_ENV: 'production' });
    assert.equal(status, 0);
    assert.match(content, /"environment": "production"/);
    assert.match(content, /ielts-speaking-coach-production\.up\.railway\.app/);
    assert.match(content, /huwsmtubwulikhlmcirx/);
  });

  test('FAIL-CLOSED: preview build pointing at production aborts', () => {
    const { status } = runGenerator({
      VERCEL_ENV: 'preview',
      AVER_API_BASE: 'https://ielts-speaking-coach-production.up.railway.app',
    });
    assert.notEqual(status, 0, 'generator must refuse preview builds with production origins');
  });
});

describe('api.js consumes the config first', () => {
  const api = readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8');

  test('_API_BASE prefers _RC.apiBase over hostname inference', () => {
    assert.match(api, /window\.__AVER_RUNTIME_CONFIG__/);
    assert.match(api, /_RC\.apiBase\s*\|\|/);
  });

  test('initSupabase prefers config url/key over page-hardcoded arguments', () => {
    assert.match(api, /_RC\.supabaseUrl\s*\|\|\s*url/);
    assert.match(api, /_RC\.supabaseAnonKey\s*\|\|\s*anonKey/);
  });
});

describe('page coverage sweep', () => {
  function findHtmlFiles(dir, acc = []) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (['node_modules', 'tooling', 'tests', 'css', 'js', 'images', 'fonts', 'aver-design', 'graphify-out'].includes(entry)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) findHtmlFiles(full, acc);
      else if (entry.endsWith('.html') && entry !== 'practice.legacy.html') acc.push(full);
    }
    return acc;
  }

  test('every page loading api.js loads runtime-config.js first (same prefix + defer)', () => {
    const offenders = [];
    for (const f of findHtmlFiles(FRONTEND)) {
      const html = readFileSync(f, 'utf8');
      const apiTag = html.match(/<script src="((?:\.\.\/|\/)?js\/)api\.js"( defer)?><\/script>/);
      if (!apiTag) continue;
      const rcTag = `<script src="${apiTag[1]}runtime-config.js"${apiTag[2] || ''}></script>`;
      const rcIdx = html.indexOf(rcTag);
      if (rcIdx === -1 || rcIdx > html.indexOf(apiTag[0])) {
        offenders.push(path.relative(FRONTEND, f));
      }
    }
    assert.deepEqual(offenders, [],
      `pages loading api.js without runtime-config.js before it: ${offenders.join(', ')}`);
  });
});

describe('vercel.json', () => {
  const cfg = JSON.parse(readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));

  test('build generates the runtime config', () => {
    assert.match(cfg.buildCommand || '', /generate-runtime-config\.mjs/);
    assert.equal(cfg.outputDirectory, '.');
  });

  test('the production-hardcoded /api/public-stats external rewrite stays gone', () => {
    for (const r of cfg.rewrites || []) {
      assert.ok(!(r.destination || '').includes('railway.app'),
        `external rewrite to Railway found (${r.source}) — use runtime-config apiBase instead`);
    }
  });
});

describe('public-stats call sites are environment-aware', () => {
  for (const page of ['index.html', 'login.html']) {
    test(`${page} builds the stats URL from runtime config`, () => {
      const html = readFileSync(path.join(FRONTEND, page), 'utf8');
      assert.match(html, /__AVER_RUNTIME_CONFIG__/);
      assert.match(html, /_apiBase \+ '\/api\/public-stats'/);
      assert.ok(!html.includes("fetch('/api/public-stats')"),
        'bare same-origin /api/public-stats fetch must not come back');
    });
  }
});
