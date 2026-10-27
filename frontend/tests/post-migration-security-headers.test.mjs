import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContentSecurityPolicy, sameOriginFramePolicy } from '../tooling/content-security-policy.mjs';
import { resolveRuntimeOrigins } from '../tooling/runtime-origins.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
const GLOBAL_ERROR = readFileSync(path.join(ROOT, 'app/global-error.tsx'), 'utf8');
const ERROR_STYLES = readFileSync(path.join(ROOT, 'app/error-screen.module.css'), 'utf8');
const NEXT_PROBE = readFileSync(path.join(ROOT, 'app/next-probe/page.tsx'), 'utf8');
const RECORDER_SPIKE = readFileSync(path.join(ROOT, 'app/(spike)/recorder-spike/page.tsx'), 'utf8');

const PRODUCTION_BUILD = Object.freeze({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
const STAGING_BUILD = Object.freeze({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging', NODE_ENV: 'production' });

function directives(policy) {
  return Object.fromEntries(policy.split('; ').map((entry) => {
    const [name, ...sources] = entry.split(' ');
    return [name, sources];
  }));
}

test('all Next responses carry the permanent security header baseline', () => {
  assert.match(CONFIG, /source:\s*'\/:path\*'/);
  for (const header of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Content-Security-Policy',
  ]) assert.match(CONFIG, new RegExp(`key: '${header}'`));
  assert.match(CONFIG, /buildContentSecurityPolicy\(process\.env\)/);
  assert.match(CONFIG, /sameOriginFramePolicy\(CONTENT_SECURITY_POLICY\)/);
  assert.doesNotMatch(CONFIG, /cdn\.jsdelivr\.net|unpkg\.com|connect-src '/);
  for (const env of [PRODUCTION_BUILD, STAGING_BUILD, {}]) {
    const policy = directives(buildContentSecurityPolicy(env));
    assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
    assert.deepEqual(policy['object-src'], ["'none'"]);
    assert.deepEqual(policy['base-uri'], ["'self'"]);
    assert.deepEqual(policy['form-action'], ["'self'"]);
  }
});

test('production connect-src is exactly self, the production API and the production Supabase project', () => {
  const policy = directives(buildContentSecurityPolicy(PRODUCTION_BUILD));
  assert.deepEqual(policy['connect-src'], [
    "'self'",
    'https://ielts-speaking-coach-production.up.railway.app',
    'https://huwsmtubwulikhlmcirx.supabase.co',
  ]);
  const serialized = buildContentSecurityPolicy(PRODUCTION_BUILD);
  assert.doesNotMatch(serialized, /vercel\.live|pusher\.com|assets\.vercel\.com/);
  assert.doesNotMatch(serialized, /unsafe-eval/);
  assert.equal(policy['frame-src'], undefined);
});

test('staging connect-src is the staging API + Supabase plus the Vercel toolbar, never production', () => {
  const serialized = buildContentSecurityPolicy(STAGING_BUILD);
  const policy = directives(serialized);
  assert.deepEqual(policy['connect-src'], [
    "'self'",
    'https://ielts-speaking-coach-staging.up.railway.app',
    'https://zjphffoujxkpltixsbzj.supabase.co',
    'https://vercel.live',
    'wss://ws-us3.pusher.com',
  ]);
  assert.doesNotMatch(serialized, /ielts-speaking-coach-production|huwsmtubwulikhlmcirx/);
  assert.ok(policy['script-src'].includes('https://vercel.live'));
  assert.ok(policy['style-src'].includes('https://vercel.live'));
  assert.deepEqual(policy['frame-src'], ["'self'", 'https://vercel.live']);
  assert.ok(policy['font-src'].includes('https://assets.vercel.com'));
  // The toolbar's image hosts are already covered by img-src https:.
  assert.ok(policy['img-src'].includes('https:'));
});

test('connect-src follows runtime-config overrides and has no scheme-wide source on Vercel builds', () => {
  for (const env of [
    PRODUCTION_BUILD,
    STAGING_BUILD,
    { VERCEL_ENV: 'preview', AVER_API_BASE: 'https://api.override.example', AVER_SUPABASE_URL: 'https://override.supabase.co/' },
  ]) {
    const connect = directives(buildContentSecurityPolicy(env))['connect-src'];
    assert.ok(!connect.includes('https:') && !connect.includes('wss:') && !connect.includes('*'), connect.join(' '));
    const config = resolveRuntimeOrigins(env);
    assert.ok(connect.includes(new URL(config.apiBase).origin));
    assert.ok(connect.includes(new URL(config.supabaseUrl).origin));
  }
});

test('a Vercel build fails closed instead of silently dropping an unusable origin', () => {
  assert.throws(() => buildContentSecurityPolicy({ VERCEL_ENV: 'preview', AVER_API_BASE: 'http://localhost:8000' }),
    /non-https browser origin/);
  assert.throws(() => buildContentSecurityPolicy({ VERCEL_ENV: 'production', AVER_SUPABASE_URL: 'not a url' }),
    /invalid browser origin/);
  // AVER_ENVIRONMENT=test never widens a Vercel build.
  const connect = directives(buildContentSecurityPolicy({ ...STAGING_BUILD, AVER_ENVIRONMENT: 'test' }))['connect-src'];
  assert.ok(!connect.includes('https:'));
});

test('local development (VERCEL_ENV=development) admits a loopback http API; deployments never do', () => {
  // The README / agent-launcher local dev environment.
  const LOCAL_DEV = { VERCEL_ENV: 'development', AVER_ENVIRONMENT: 'test', AVER_API_BASE: 'http://localhost:8000', NODE_ENV: 'development' };
  const connect = directives(buildContentSecurityPolicy(LOCAL_DEV))['connect-src'];
  assert.deepEqual(connect.slice(0, 3), [
    "'self'",
    'http://localhost:8000',
    'https://zjphffoujxkpltixsbzj.supabase.co',
  ]);
  assert.ok(!connect.includes('https:') && !connect.includes('wss:'), connect.join(' '));
  assert.ok(directives(buildContentSecurityPolicy({ ...LOCAL_DEV, AVER_API_BASE: 'http://127.0.0.1:8000' }))['connect-src']
    .includes('http://127.0.0.1:8000'));
  // Only loopback hosts, even in development.
  assert.throws(() => buildContentSecurityPolicy({ ...LOCAL_DEV, AVER_API_BASE: 'http://evil.example:8000' }),
    /non-https browser origin/);
  assert.throws(() => buildContentSecurityPolicy({ ...LOCAL_DEV, AVER_SUPABASE_URL: 'http://dev.supabase.co' }),
    /non-https browser origin/);
  // Deployed builds stay https-only, whatever NODE_ENV or AVER_ENVIRONMENT says.
  for (const VERCEL_ENV of ['production', 'preview']) {
    for (const host of ['localhost', '127.0.0.1']) {
      assert.throws(() => buildContentSecurityPolicy({ ...LOCAL_DEV, VERCEL_ENV, AVER_API_BASE: `http://${host}:8000` }),
        /non-https browser origin/);
      assert.throws(() => buildContentSecurityPolicy({ VERCEL_ENV, AVER_SUPABASE_URL: `http://${host}:54321` }),
        /non-https browser origin/);
    }
  }
  assert.doesNotMatch(buildContentSecurityPolicy(PRODUCTION_BUILD), /http:/);
});

test('local builds keep legacy inference; only local fixture builds may reach arbitrary https origins', () => {
  assert.deepEqual(directives(buildContentSecurityPolicy({}))['connect-src'], [
    "'self'",
    'http://localhost:8000',
    'https://ielts-speaking-coach-production.up.railway.app',
    'https://huwsmtubwulikhlmcirx.supabase.co',
  ]);
  assert.deepEqual(directives(buildContentSecurityPolicy({
    AVER_ENVIRONMENT: 'test', AVER_API_BASE: 'http://127.0.0.1:3999',
  }))['connect-src'], ["'self'", 'https:', 'wss:', 'http://127.0.0.1:3999']);
  assert.deepEqual(directives(buildContentSecurityPolicy({
    AVER_ENVIRONMENT: 'test', AVER_API_BASE: 'http://evil.example:3999',
  }))['connect-src'], ["'self'", 'https:', 'wss:']);
  assert.ok(directives(buildContentSecurityPolicy({ NODE_ENV: 'development' }))['script-src'].includes("'unsafe-eval'"));
});

test('embeddable workspaces differ from the global policy only in frame-ancestors', () => {
  const policy = buildContentSecurityPolicy(STAGING_BUILD);
  const framed = sameOriginFramePolicy(policy);
  assert.equal(framed, policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  assert.notEqual(framed, policy);
});

test('only the known exam and Writing drill-down workspaces can be framed by the same origin', () => {
  const allowlist = CONFIG.match(/const EMBEDDABLE_SAME_ORIGIN_ROUTES = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(allowlist);
  assert.deepEqual([...allowlist.matchAll(/'([^']+)'/g)].map((match) => match[1]), [
    '/core-player/launch',
    '/listening/test/session',
    '/reading/exam/session',
    '/admin/mock-exams',
    '/admin/mock-live',
    '/admin/mock-reviews',
    '/admin/writing/queue',
    '/admin/writing/status',
    '/admin/writing/grade',
  ]);
  assert.match(CONFIG, /EMBEDDABLE_SAME_ORIGIN_ROUTES\.map/);
  assert.match(CONFIG, /value: 'SAMEORIGIN'/);
  assert.match(CONFIG, /value: SAME_ORIGIN_FRAME_POLICY/);
  assert.match(sameOriginFramePolicy(buildContentSecurityPolicy(PRODUCTION_BUILD)), /frame-ancestors 'self'/);
});

test('mutable stable-name css and js always revalidate after a deploy', () => {
  const stableAssetRules = [...CONFIG.matchAll(
    /source:\s*'\/(?:js|css)\/:path\*'[\s\S]*?Cache-Control'[\s\S]*?value:\s*'([^']+)'/g,
  )].map((match) => match[1]);
  assert.deepEqual(stableAssetRules, [
    'public, max-age=0, must-revalidate',
    'public, max-age=0, must-revalidate',
  ]);
});

test('the root error boundary bootstraps the shared design system', () => {
  assert.match(GLOBAL_ERROR, /href="\/css\/aver-design\/tokens\.css"/);
  assert.match(ERROR_STYLES, /var\(--av-surface-page\)/);
  assert.match(ERROR_STYLES, /var\(--av-text-primary\)/);
  assert.doesNotMatch(ERROR_STYLES, /#[0-9a-f]{3,8}|rgba?\(/i);
});

// U-03 widened this from "every production deployment" to every deployment
// (staging/preview included) unless `next dev` or AVER_ENABLE_DIAGNOSTIC_ROUTES=1.
// Full contract: route-auth-guard-inventory.test.mjs.
test('diagnostic routes fail closed for every deployment unless explicitly enabled', () => {
  for (const source of [NEXT_PROBE, RECORDER_SPIKE]) {
    assert.match(source, /if \(!diagnosticRoutesEnabled\(\)\) notFound\(\);/);
    assert.doesNotMatch(source, /VERCEL_ENV === 'production'/);
  }
});
