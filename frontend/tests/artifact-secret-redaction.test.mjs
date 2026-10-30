// PC-J437 — Playwright reports and CI artifacts must not carry bearer tokens,
// JWTs or the Vercel bypass value. Every token below is FAKE and assembled by
// concatenation so this file itself never matches the guard's patterns.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const SANITIZE = path.join(FRONTEND, 'tooling', 'sanitize-artifacts.mjs');
const SCAN = path.join(FRONTEND, 'tooling', 'scan-artifact-secrets.mjs');

const redaction = require('../tooling/redact-secrets.cjs');
const { redactSecrets, redactError, countSecretMatches, readZip, writeZip } = redaction;

const FAKE_JWT = 'eyJTEST' + 'x'.repeat(20) + '.eyJTEST' + 'y'.repeat(20) + '.sigFAKE';
const FAKE_REFRESH = 'rtFAKE' + 'r'.repeat(18);
const FAKE_BYPASS = 'bypassFAKE' + 'b'.repeat(22);
const FAKE_COOKIE = 'cookieFAKE' + 'c'.repeat(16);
const FAKE_MARKERS = [FAKE_JWT, 'eyJTEST', FAKE_REFRESH, FAKE_BYPASS, FAKE_COOKIE];
const NO_ENV = { literals: [] };

function assertClean(text, label = 'text') {
  for (const marker of FAKE_MARKERS) assert.ok(!text.includes(marker), `${label} still holds a fake secret marker`);
}

function callLog(token, bypass = FAKE_BYPASS) {
  return [
    'apiRequestContext.get: Request context disposed.',
    'Call log:',
    '\u001b[2m  - → GET https://ielts-speaking-coach-staging.up.railway.app/admin/access-codes\u001b[22m',
    '\u001b[2m    - user-agent: Playwright/1.60.0\u001b[22m',
    `\u001b[2m    - Authorization: Bearer ${token}\u001b[22m`,
    `\u001b[2m    - x-vercel-protection-bypass: ${bypass}\u001b[22m`,
    '',
    '    at /home/runner/work/frontend/tests/staging-e2e/gate-a-flows.spec.js:115:31',
  ].join('\n');
}

function playwrightReportHtml(entries) {
  const zip = writeZip(entries.map(([name, text]) => ({ name, data: Buffer.from(text) })));
  return '<!DOCTYPE html><html><head><script type="module">/* viewer */</script></head><body>'
    + `<div id="root"></div></body></html><template id="playwrightReportBase64">data:application/zip;base64,${zip.toString('base64')}</template>`;
}

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

test('redactSecrets removes bearer tokens, JWTs, auth cookies and bypass values but keeps diagnostics', () => {
  const samples = [
    `Authorization: Bearer ${FAKE_JWT}`,
    `authorization: Bearer ${FAKE_JWT}`,
    `token was ${FAKE_JWT} at login`,
    `{"access_token":"${FAKE_JWT}","refresh_token":"${FAKE_REFRESH}","user":{"id":"u1"}}`,
    `{\\"access_token\\":\\"${FAKE_JWT}\\",\\"refresh_token\\":\\"${FAKE_REFRESH}\\"}`,
    `cookie: sb-abc-auth-token=${FAKE_COOKIE}; _vercel_jwt=${FAKE_JWT}`,
    `set-cookie: _vercel_jwt=${FAKE_COOKIE}; Path=/; HttpOnly`,
    `x-vercel-protection-bypass: ${FAKE_BYPASS}`,
    `"x-vercel-protection-bypass":"${FAKE_BYPASS}"`,
    `https://staging.averlearning.com/?x-vercel-protection-bypass=${FAKE_BYPASS}&x=1`,
    `https://staging.averlearning.com/login#access_token=${FAKE_JWT}&refresh_token=${FAKE_REFRESH}`,
    `[{"name":"sb-abc-auth-token","value":"${FAKE_COOKIE}","domain":"x"}]`,
  ];
  for (const sample of samples) assertClean(redactSecrets(sample, NO_ENV), sample.slice(0, 30));

  const message = callLog(FAKE_JWT);
  const clean = redactSecrets(message, NO_ENV);
  assertClean(clean, 'call log');
  assert.match(clean, /GET https:\/\/ielts-speaking-coach-staging\.up\.railway\.app\/admin\/access-codes/);
  assert.match(clean, /- Authorization: \[REDACTED\]\u001b\[22m/);
  assert.match(clean, /- x-vercel-protection-bypass: \[REDACTED\]\u001b\[22m/);
  assert.match(clean, /gate-a-flows\.spec\.js:115:31/);
  assert.match(clean, /user-agent: Playwright\/1\.60\.0/);
  assert.equal(redactSecrets(clean, NO_ENV), clean, 'redaction is idempotent');

  const json = JSON.stringify({ message, stack: message });
  const cleanJson = redactSecrets(json, NO_ENV);
  assertClean(cleanJson, 'json-encoded call log');
  assert.deepEqual(Object.keys(JSON.parse(cleanJson)), ['message', 'stack']);
  assert.match(JSON.parse(cleanJson).message, /Call log:\n/);
});

test('literal secret values from the environment are redacted and counted', () => {
  const text = `bypass cookie primed with ${FAKE_BYPASS} (no header name)`;
  assertClean(redactSecrets(text, { literals: [FAKE_BYPASS] }));
  assert.equal(countSecretMatches(text, { literals: [FAKE_BYPASS] }), 1);
  assert.equal(countSecretMatches(text, NO_ENV), 0);
  assert.deepEqual(redaction.secretLiteralsFromEnv({ STAGING_BYPASS: FAKE_BYPASS, E2E_PASSWORD: 'short' }), [FAKE_BYPASS]);
});

test('guard patterns flag bearer and raw JWTs but not the public Supabase anon key', () => {
  assert.ok(countSecretMatches(`Authorization: Bearer ${FAKE_JWT}`, NO_ENV) >= 1);
  assert.ok(countSecretMatches(`bearers = ['${FAKE_JWT}']`, NO_ENV) >= 1);
  const anonPayload = Buffer.from(JSON.stringify({ iss: 'supabase', role: 'anon' })).toString('base64url');
  const anon = ['eyJhbGciOiJIUzI1NiJ9', anonPayload, 'sigFAKE'].join('.');
  assert.equal(countSecretMatches(`apikey: ${anon}\nAuthorization: Bearer ${anon}`, NO_ENV), 0);
  const userPayload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: 'u1' })).toString('base64url');
  const user = ['eyJhbGciOiJIUzI1NiJ9', userPayload, 'sigFAKE'].join('.');
  assert.equal(countSecretMatches(`Authorization: Bearer ${user}`, NO_ENV), 2);
  assert.equal(countSecretMatches(redactSecrets(`Authorization: Bearer ${user}`, NO_ENV), NO_ENV), 0);
});

test('guard fails with path + count only, sanitize makes it pass, report stays openable', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj437-artifacts-'));
  try {
    const report = path.join(dir, 'playwright-report');
    const results = path.join(dir, 'test-results', 'gate-a-admin');
    mkdirSync(path.join(report, 'data'), { recursive: true });
    mkdirSync(results, { recursive: true });
    const errorContext = `# Instructions\n\n# Test info\n\n# Error details\n\n\`\`\`\n${callLog(FAKE_JWT)}\n\`\`\`\n`;
    writeFileSync(path.join(report, 'data', 'abc123.md'), errorContext);
    writeFileSync(path.join(dir, 'test-results', 'staging-e2e-results.json'), JSON.stringify({
      suites: [{ specs: [{ tests: [{ results: [{
        errors: [{ message: callLog(FAKE_JWT) }],
        attachments: [{ name: 'note', contentType: 'text/plain', body: Buffer.from(`Bearer ${FAKE_JWT}`).toString('base64') }],
      }] }] }] }],
    }, null, 2));
    const reportJson = JSON.stringify({ tests: [{ results: [{ errors: [{ message: callLog(FAKE_JWT) }] }] }] });
    writeFileSync(path.join(report, 'index.html'), playwrightReportHtml([['report.json', '{"stats":{}}'], ['0123abcd.json', reportJson]]));
    const trace = writeZip([
      { name: 'trace.network', data: Buffer.from(`{"headers":[{"name":"authorization","value":"Bearer ${FAKE_JWT}"}]}\n`) },
      { name: 'resources/page.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
    ]);
    writeFileSync(path.join(results, 'trace.zip'), trace);
    writeFileSync(path.join(results, 'server.log'), `primed bypass ${FAKE_BYPASS}\n`);

    const env = { STAGING_BYPASS: FAKE_BYPASS };
    const before = run(SCAN, [report, path.join(dir, 'test-results')], env);
    assert.equal(before.status, 1, 'guard must fail while fakes are present');
    const output = before.stdout + before.stderr;
    assertClean(output, 'guard output');
    for (const file of ['data/abc123.md', 'index.html', 'staging-e2e-results.json', 'trace.zip', 'server.log']) {
      assert.match(output, new RegExp(`${file.replace(/[.]/g, '\\.')}: \\d+ secret-like match\\(es\\)`), `${file} flagged with a count`);
    }
    assert.match(output, /::error::Artifact secret guard/);

    const sanitized = run(SANITIZE, [report, path.join(dir, 'test-results')], env);
    assert.equal(sanitized.status, 0, sanitized.stderr);
    assertClean(sanitized.stdout + sanitized.stderr, 'sanitize output');
    const after = run(SCAN, [report, path.join(dir, 'test-results')], env);
    assert.equal(after.status, 0, after.stdout);
    assert.match(after.stdout, /0 flagged/);

    // The report and trace are still valid archives with readable JSON.
    const html = readFileSync(path.join(report, 'index.html'), 'utf8');
    const embedded = html.match(redaction.PLAYWRIGHT_REPORT_RE);
    assert.ok(embedded && html.startsWith('<!DOCTYPE html>'));
    const entries = readZip(Buffer.from(embedded[2], 'base64'));
    assert.deepEqual(entries.map((e) => e.name), ['report.json', '0123abcd.json']);
    const message = JSON.parse(entries[1].data.toString('utf8')).tests[0].results[0].errors[0].message;
    assert.match(message, /Authorization: \[REDACTED\]/);
    assert.match(message, /admin\/access-codes/);
    const traceEntries = readZip(readFileSync(path.join(results, 'trace.zip')));
    assert.deepEqual([...traceEntries[1].data], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3], 'binary entries untouched');
    JSON.parse(traceEntries[0].data.toString('utf8'));
    JSON.parse(readFileSync(path.join(dir, 'test-results', 'staging-e2e-results.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an archive that cannot be opened fails the guard and is removed by sanitize', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj437-broken-'));
  try {
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`Bearer ${FAKE_JWT}`)]);
    writeFileSync(path.join(dir, 'trace.zip'), broken);
    writeFileSync(path.join(dir, 'index.html'), '<template id="playwrightReportBase64">data:application/zip;base64,' + 'AAAA</template>');
    const before = run(SCAN, [dir]);
    assert.equal(before.status, 1);
    assert.match(before.stdout, /trace\.zip: .*archive could not be opened/);
    assert.match(before.stdout, /index\.html: archive could not be opened/);
    assertClean(before.stdout);
    const sanitized = run(SANITIZE, [dir]);
    assert.equal(sanitized.status, 0);
    assert.ok(!existsSync(path.join(dir, 'trace.zip')) && !existsSync(path.join(dir, 'index.html')));
    assert.equal(run(SCAN, [dir]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing APIRequestContext call is rethrown without the bearer token', async () => {
  const { installRequestErrorRedaction } = require('./staging-e2e/fixtures.js');
  const { request } = require('@playwright/test');
  const context = await request.newContext();
  try {
    installRequestErrorRedaction(Object.getPrototypeOf(context));
    // Port 9 (discard) on loopback is closed: the call fails with a call log.
    const error = await context.get('http://127.0.0.1:9/admin/access-codes', {
      headers: { Authorization: `Bearer ${FAKE_JWT}`, 'x-vercel-protection-bypass': FAKE_BYPASS },
    }).then(() => null, (caught) => caught);
    assert.ok(error instanceof Error, 'the request must fail');
    assert.match(error.message, /^apiRequestContext\.get: /, 'Playwright still names the call it failed in');
    assert.doesNotMatch(error.stack, /staging-e2e\/fixtures\.js/, 'the wrapper does not become the reported location');
    assert.match(error.message, /Call log:/);
    assert.match(error.message, /127\.0\.0\.1:9\/admin\/access-codes/);
    assertClean(error.message, 'message');
    assertClean(error.stack, 'stack');
    for (const key of ['get', 'fetch']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(context, key), `no ${key} shadow left on the instance`);
    }
  } finally {
    await context.dispose();
  }

  const nested = new Error(`outer Bearer ${FAKE_JWT}`, { cause: new Error(`inner ${FAKE_JWT}`) });
  redactError(nested);
  assertClean(nested.message);
  assertClean(nested.stack);
  assertClean(nested.cause.message);
});

test('redaction reporter scrubs errors, steps and stdio before other reporters read them', () => {
  const Reporter = require('./staging-e2e/redaction-reporter.js');
  const result = {
    errors: [{ message: callLog(FAKE_JWT), stack: callLog(FAKE_JWT), snippet: 'x' }],
    error: { message: `Bearer ${FAKE_JWT}` },
    stdout: [`token ${FAKE_JWT}\n`, Buffer.from('binary')],
    stderr: [],
    steps: [{ error: { message: `Bearer ${FAKE_JWT}` }, steps: [{ error: { stack: FAKE_JWT } }] }],
  };
  new Reporter().onTestEnd({}, result);
  assertClean(JSON.stringify({ ...result, stdout: result.stdout.map(String) }), 'reporter result');
  assert.match(result.errors[0].message, /admin\/access-codes/);
});

test('staging config keeps trace off and runs the redaction reporter first on CI', () => {
  const source = readFileSync(path.join(FRONTEND, 'playwright.staging.config.js'), 'utf8');
  assert.match(source, /trace: 'off'/);
  const ci = source.slice(source.indexOf('reporter: process.env.CI'));
  assert.ok(ci.indexOf('redaction-reporter') > 0 && ci.indexOf('redaction-reporter') < ci.indexOf("['github']"));
});

test('every staging-e2e spec imports test/expect from the redacting fixture', () => {
  const dir = path.join(FRONTEND, 'tests', 'staging-e2e');
  const specs = spawnSync('ls', [dir], { encoding: 'utf8' }).stdout.split('\n').filter((name) => name.endsWith('.spec.js'));
  assert.ok(specs.length >= 13);
  for (const name of specs) {
    const source = readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(source, /require\('@playwright\/test'\)/, `${name} bypasses the fixture`);
    assert.match(source, /const \{ test, expect \} = require\('\.\/fixtures'\);/, name);
  }
});

const UPLOAD_GUARDS = {
  '.github/workflows/staging-release-smoke.yml': 2,
  '.github/workflows/e2e.yml': 2,
  '.github/workflows/next-native-browser.yml': 2,
};

test('every artifact upload in the staging/PR workflows waits for sanitize + scan', () => {
  for (const [file, expected] of Object.entries(UPLOAD_GUARDS)) {
    const steps = readFileSync(path.join(ROOT, file), 'utf8').split(/\n      - (?=name: |uses: )/);
    const uploads = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.includes('actions/upload-artifact@'));
    assert.equal(uploads.length, expected, file);
    for (const { step, index } of uploads) {
      const guard = steps[index - 1];
      const id = guard.match(/\n        id: (\S+)/)?.[1];
      assert.ok(id, `${file}: the step before each upload is an identified guard`);
      assert.match(guard, /node tooling\/sanitize-artifacts\.mjs /, file);
      assert.match(guard, /node tooling\/scan-artifact-secrets\.mjs /, file);
      assert.ok(guard.indexOf('sanitize-artifacts') < guard.indexOf('scan-artifact-secrets'), `${file}: sanitize before scan`);
      assert.doesNotMatch(guard, /continue-on-error/, file);
      assert.ok(step.includes(`steps.${id}.outcome == 'success'`), `${file}: upload is gated on ${id}`);
    }
  }
});

test('the new redaction sources hold no secret-like literal', () => {
  const files = [
    'tooling/redact-secrets.cjs',
    'tooling/sanitize-artifacts.mjs',
    'tooling/scan-artifact-secrets.mjs',
    'tests/staging-e2e/fixtures.js',
    'tests/staging-e2e/redaction-reporter.js',
    'tests/artifact-secret-redaction.test.mjs',
  ].map((file) => path.join(FRONTEND, file));
  const scan = run(SCAN, files);
  assert.equal(scan.status, 0, scan.stdout);
});
