import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const TOOLING = fileURLToPath(new URL('../tooling/', import.meta.url));
const bootstrap = `
  const runtime = JSON.parse(process.env.TEST_RUNTIME);
  const backend = JSON.parse(process.env.TEST_BACKEND);
  globalThis.fetch = async (url) => {
    if (url === 'https://staging.averlearning.com/js/runtime-config.js') {
      return { ok: true, text: async () => JSON.stringify(runtime) };
    }
    if (url === 'https://ielts-speaking-coach-staging.up.railway.app/health/runtime') {
      return { ok: true, json: async () => backend };
    }
    throw new Error('unexpected-network-request');
  };
  await import('./frontend/tooling/capture-staging-release-provenance.mjs');
`;

test('staging supersession uses authenticated release evidence and real Git ancestry', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'staging-superseded-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const checkout = path.join(root, 'checkout');
  const git = (cwd, ...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(root, 'init', '--bare', remote);
  git(root, 'init', '--initial-branch=staging', seed);
  const commit = (name) => {
    git(seed, '-c', 'user.name=Smoke test', '-c', 'user.email=smoke@example.invalid',
      'commit', '--allow-empty', '-m', name);
    return git(seed, 'rev-parse', 'HEAD');
  };
  const previous = commit('previous');
  const source = commit('source');
  const newer = commit('newer');
  const head = commit('head');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', `${source}:refs/heads/staging`);
  git(root, 'clone', '--depth=1', '--branch=staging', `file://${remote}`, checkout);
  // origin/staging in the checkout is stale; the gate must refresh it.
  git(seed, 'push', 'origin', 'staging');
  git(seed, 'checkout', '--detach', previous);
  const unrelated = commit('unrelated');
  git(seed, 'push', 'origin', `${unrelated}:refs/heads/unrelated`);

  const tooling = path.join(checkout, 'frontend', 'tooling');
  const helpers = path.join(checkout, 'frontend', 'tests', 'staging-e2e');
  mkdirSync(tooling, { recursive: true });
  mkdirSync(helpers, { recursive: true });
  for (const file of ['capture-staging-release-provenance.mjs', 'staging-release-superseded.mjs']) {
    cpSync(path.join(TOOLING, file), path.join(tooling, file));
  }
  const claims = Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url');
  writeFileSync(path.join(helpers, 'helpers.js'),
    `module.exports = { signInSession: async () => ({ access_token: 'header.${claims}.signature' }) };`);
  const output = path.join(root, 'step-output');
  const summary = path.join(root, 'step-summary');
  const run = ({ runSha = source, frontend = head, backend = head, allow = 'true', runtime = {}, health = {} } = {}) => {
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap], {
      cwd: checkout, encoding: 'utf8', timeout: 30000,
      env: {
        ...process.env, STAGING_BYPASS: 'test-bypass', E2E_PASSWORD: 'test-password',
        STAGING_E2E_ADMIN_TOTP_SECRET: 'test-totp', RELEASE_SOURCE_SHA: runSha,
        RELEASE_PROVENANCE_REQUIRED: 'true', STAGING_RELEASE_ALLOW_SUPERSEDED: allow,
        GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
        TEST_RUNTIME: JSON.stringify({
          environment: 'staging', release: frontend, gitRef: 'staging',
          apiBase: 'https://ielts-speaking-coach-staging.up.railway.app',
          supabaseUrl: 'https://zjphffoujxkpltixsbzj.supabase.co', supabaseAnonKey: 'public-test-key',
          ...runtime,
        }),
        TEST_BACKEND: JSON.stringify({ git_sha: backend, git_branch: 'staging', environment_name: 'staging', ...health }),
      },
    });
    assert.ifError(result.error);
    return {
      ...result,
      evidence: JSON.parse(readFileSync(path.join(checkout, 'frontend/test-results/staging-release-provenance.json'), 'utf8')),
      output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8'),
    };
  };
  const refused = (result) => {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.evidence.ok, false);
    assert.equal(result.evidence.superseded_by, null);
    assert.doesNotMatch(result.stdout, /::notice::superseded/);
    assert.equal(result.output, '');
    assert.equal(result.summary, '');
  };

  await t.test('superseded passes with notice, summary and output after deepening and refreshing staging', () => {
    assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.equal(git(checkout, 'rev-parse', 'origin/staging'), source);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.evidence.ok, false, 'supersession must never claim exact-release evidence');
    assert.equal(result.evidence.superseded_by, head);
    assert.match(result.stdout, new RegExp(`::notice::superseded by ${head}`));
    assert.equal(result.output, 'superseded=true\n');
    for (const sha of [source, head]) assert.ok(result.summary.includes(sha));
    assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'false');
    assert.equal(git(checkout, 'rev-parse', 'origin/staging'), head);
  });
  await t.test('current staging head fails when serving releases do not match', () => {
    refused(run({ runSha: head, frontend: newer, backend: newer }));
  });
  await t.test('unrelated deployment fails even after staging has advanced', () => {
    git(checkout, 'fetch', 'origin', 'unrelated');
    refused(run({ frontend: unrelated, backend: unrelated }));
    refused(run({ frontend: head, backend: unrelated }));
  });
  await t.test('rollback and partially replaced releases fail', () => {
    refused(run({ frontend: previous, backend: previous }));
    refused(run({ frontend: head, backend: source }));
  });
  await t.test('both services may be on different proven descendants of the run', () => {
    const result = run({ frontend: head, backend: newer });
    assert.equal(result.status, 0);
    assert.equal(result.evidence.superseded_by, head);
  });
  await t.test('exact latest SHA passes without supersession or skipped-smoke output', () => {
    const result = run({ runSha: head });
    assert.equal(result.status, 0);
    assert.equal(result.evidence.ok, true);
    assert.equal(result.evidence.superseded_by, null);
    assert.equal(result.output, '');
    assert.equal(result.summary, '');
  });
  await t.test('opt-in is required; wrong environments and incomplete markers fail', () => {
    refused(run({ allow: '' }));
    refused(run({ runtime: { environment: 'production' } }));
    refused(run({ health: { environment_name: 'production' } }));
    refused(run({ frontend: 'invalid' }));
    refused(run({ backend: null }));
  });
  await t.test('failure to refresh staging fails closed', () => {
    git(checkout, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    const result = run();
    refused(result);
    assert.equal(result.evidence.error, 'staging-ancestry-unavailable');
    assert.doesNotMatch(result.stdout + result.stderr, /missing\.git|test-password|test-bypass|test-totp/);
  });
});
