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
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { load: loadYaml } = require('js-yaml');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const SANITIZE = path.join(FRONTEND, 'tooling', 'sanitize-artifacts.mjs');
const SCAN = path.join(FRONTEND, 'tooling', 'scan-artifact-secrets.mjs');

const redaction = require('../tooling/redact-secrets.cjs');
const { SECRET_ENV_NAMES, redactSecrets, redactError, countSecretMatches, readZip, writeZip } = redaction;

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

test('password/TOTP literals in report and trace are missed with bypass-only env and removed with all secret envs', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj481-artifacts-'));
  const fakePassword = 'passwordFAKE' + 'p'.repeat(20);
  const fakeTotp = 'JBSW' + 'Y3DP'.repeat(6);
  const env = {
    STAGING_BYPASS: FAKE_BYPASS,
    E2E_PASSWORD: fakePassword,
    STAGING_E2E_ADMIN_TOTP_SECRET: fakeTotp,
  };
  const literals = Object.values(env);
  try {
    const report = path.join(dir, 'index.html');
    const trace = path.join(dir, 'trace.zip');
    // Neutral text avoids contextual password/header patterns: these need env literals.
    const payload = JSON.stringify({ note: `form filled ${fakePassword}; step-up setup ${fakeTotp}` });
    writeFileSync(report, playwrightReportHtml([['report.json', payload]]));
    writeFileSync(trace, writeZip([{ name: 'trace.trace', data: Buffer.from(payload) }]));

    // This is the workflow hole: bypass-only env misses password/TOTP in the same report.
    const bypassOnly = run(SCAN, [dir], { STAGING_BYPASS: FAKE_BYPASS });
    assert.equal(bypassOnly.status, 0, bypassOnly.stdout + bypassOnly.stderr);
    assert.match(bypassOnly.stdout, /2 file\(s\) scanned, 0 flagged/);

    const before = run(SCAN, [dir], env);
    assert.equal(before.status, 1, 'all-secret guard must reject password/TOTP literals');
    const output = before.stdout + before.stderr;
    for (const literal of literals) assert.ok(!output.includes(literal), 'guard output must not print a literal');
    assert.deepEqual(output.trim().split('\n'), [
      `${report}: 2 secret-like match(es)`,
      `${trace}: 2 secret-like match(es)`,
      'scan-artifact-secrets: 2 file(s) scanned, 2 flagged',
      '::error::Artifact secret guard: secret-like values remain in files queued for upload; the upload is blocked.',
    ]);

    const sanitized = run(SANITIZE, [dir], env);
    assert.equal(sanitized.status, 0, sanitized.stderr);
    for (const literal of literals) {
      assert.ok(!(sanitized.stdout + sanitized.stderr).includes(literal), 'sanitize output must not print a literal');
    }
    const after = run(SCAN, [dir], env);
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.match(after.stdout, /2 file\(s\) scanned, 0 flagged/);

    const html = readFileSync(report, 'utf8');
    const embedded = html.match(redaction.PLAYWRIGHT_REPORT_RE);
    assert.ok(embedded && html.startsWith('<!DOCTYPE html>'), 'HTML report remains openable');
    for (const entries of [readZip(Buffer.from(embedded[2], 'base64')), readZip(readFileSync(trace))]) {
      assert.equal(entries.length, 1);
      const text = entries[0].data.toString('utf8');
      for (const literal of literals) assert.ok(!text.includes(literal), 'archive entry must contain zero literal matches');
      assert.equal(JSON.parse(text).note, 'form filled [REDACTED]; step-up setup [REDACTED]');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// PC-J481 R2 (Codex P2) — JSON reports escape `"` and `\`, nested JSON escapes
// them twice, URLs percent-encode. Synthetic passwords only.
const QUOTE_PW = 'pwFAKE"quote' + 'q'.repeat(10);
const BACKSLASH_PW = 'pwFAKE\\slash' + 's'.repeat(10);
const MIXED_PW = 'pwFAKE"\\mix' + 'm'.repeat(10);
const TRAILING_PW = 'pwFAKEtail' + 't'.repeat(10) + '\\';
const URL_PW = 'pwFAKE sp&amp%' + 'u'.repeat(10);
const ESCAPE_PWS = [QUOTE_PW, BACKSLASH_PW, MIXED_PW, TRAILING_PW, URL_PW];

function secretForms(secret) {
  const json = JSON.stringify(secret).slice(1, -1);
  const twice = JSON.stringify(json).slice(1, -1);
  const uri = encodeURIComponent(secret);
  return [...new Set([
    secret, json, twice, JSON.stringify(twice).slice(1, -1), uri, uri.replace(/%20/g, '+'),
    new URLSearchParams({ v: secret }).toString().slice(2),
  ])];
}

function assertNoForm(text, secret, label) {
  for (const form of secretForms(secret)) assert.ok(!text.includes(form), `${label}: a form of the secret survived`);
}

test('literal secrets are redacted and counted when JSON-escaped, double-escaped or URL-encoded', () => {
  for (const secret of ESCAPE_PWS) {
    const options = { literals: [secret] };
    const note = `form filled ${secret} then submitted`;
    const samples = {
      raw: note,
      json: JSON.stringify({ note }),
      nested: JSON.stringify({ trace: JSON.stringify({ note }) }),
      nestedTwice: JSON.stringify({ html: JSON.stringify({ trace: JSON.stringify({ note }) }) }),
      url: `https://staging.averlearning.com/login?next=%2Fhome&note=${encodeURIComponent(secret)}`,
      form: `email=qa%40example.com&note=${new URLSearchParams({ v: secret }).toString().slice(2)}`,
    };
    for (const [kind, text] of Object.entries(samples)) {
      const label = `${JSON.stringify(secret).slice(0, 12)} ${kind}`;
      assert.equal(countSecretMatches(text, NO_ENV), 0, `${label}: only the literal can find it`);
      assert.ok(countSecretMatches(text, options) > 0, `${label}: guard must count the leak`);
      const clean = redactSecrets(text, options);
      assertNoForm(clean, secret, label);
      assert.equal(countSecretMatches(clean, options), 0, `${label}: nothing left to count`);
      assert.equal(redactSecrets(clean, options), clean, `${label}: idempotent`);
    }
    // Longest form wins, so no escaped tail breaks the JSON around it.
    assert.equal(JSON.parse(redactSecrets(samples.json, options)).note, 'form filled [REDACTED] then submitted');
    const nested = JSON.parse(JSON.parse(redactSecrets(samples.nested, options)).trace);
    assert.equal(nested.note, 'form filled [REDACTED] then submitted');
  }
  assert.equal(countSecretMatches(JSON.stringify({ note: 'pwFAKE"' }), { literals: ['pwFAKE"'] }), 0, 'short literals stay ignored');
});

test('escaped password literals in JSON, trace zip and HTML report fail the guard and are sanitized', async () => {
  const { scanBuffer } = await import(pathToFileURL(SCAN).href);
  const { sanitizeBuffer } = await import(pathToFileURL(SANITIZE).href);
  const payloads = {
    json: (secret) => JSON.stringify({ note: `form filled ${secret}` }),
    nested: (secret) => JSON.stringify({ trace: JSON.stringify({ note: `form filled ${secret}` }) }),
  };
  const containers = {
    json: (payload) => Buffer.from(payload),
    'trace-zip': (payload) => writeZip([{ name: 'trace.trace', data: Buffer.from(payload) }]),
    'html-base64-zip': (payload) => Buffer.from(playwrightReportHtml([['report.json', payload]])),
  };
  const unpack = {
    json: (buffer) => buffer.toString('utf8'),
    'trace-zip': (buffer) => readZip(buffer)[0].data.toString('utf8'),
    'html-base64-zip': (buffer) => {
      const embedded = buffer.toString('utf8').match(redaction.PLAYWRIGHT_REPORT_RE);
      assert.ok(embedded, 'HTML report remains openable');
      return readZip(Buffer.from(embedded[2], 'base64'))[0].data.toString('utf8');
    },
  };
  for (const secret of [QUOTE_PW, BACKSLASH_PW, MIXED_PW]) {
    const options = { literals: [secret] };
    for (const [payloadKind, payload] of Object.entries(payloads)) {
      for (const [container, pack] of Object.entries(containers)) {
        const label = `${JSON.stringify(secret).slice(0, 12)} ${payloadKind} ${container}`;
        const buffer = pack(payload(secret));
        assert.deepEqual(scanBuffer(buffer, NO_ENV), { count: 0, unscannable: false }, `${label}: only the literal can find it`);
        const before = scanBuffer(buffer, options);
        assert.ok(before.count > 0 && !before.unscannable, `${label}: guard must count the leak`);
        const clean = sanitizeBuffer(buffer, options);
        assert.deepEqual(scanBuffer(clean, options), { count: 0, unscannable: false }, `${label}: guard passes after sanitize`);
        const text = unpack[container](clean);
        assertNoForm(text, secret, label);
        const parsed = JSON.parse(text);
        const note = payloadKind === 'nested' ? JSON.parse(parsed.trace).note : parsed.note;
        assert.equal(note, 'form filled [REDACTED]', `${label}: JSON stays parseable`);
      }
    }
  }

  // Same path through the CLIs with the secret supplied only via E2E_PASSWORD.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj481-escaped-'));
  try {
    const env = { E2E_PASSWORD: QUOTE_PW };
    writeFileSync(path.join(dir, 'results.json'), payloads.json(QUOTE_PW));
    writeFileSync(path.join(dir, 'trace.zip'), containers['trace-zip'](payloads.nested(QUOTE_PW)));
    writeFileSync(path.join(dir, 'index.html'), containers['html-base64-zip'](payloads.nested(QUOTE_PW)));
    const before = run(SCAN, [dir], env);
    assert.equal(before.status, 1, 'guard must reject escaped password literals');
    assert.match(before.stdout, /3 file\(s\) scanned, 3 flagged/);
    assertNoForm(before.stdout + before.stderr, QUOTE_PW, 'guard output');
    const sanitized = run(SANITIZE, [dir], env);
    assert.equal(sanitized.status, 0, sanitized.stderr);
    assertNoForm(sanitized.stdout + sanitized.stderr, QUOTE_PW, 'sanitize output');
    const after = run(SCAN, [dir], env);
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.match(after.stdout, /3 file\(s\) scanned, 0 flagged/);
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

test('every artifact guard receives every secret env used by its job from the same GitHub secret', () => {
  const missing = [];
  for (const [file, expected] of Object.entries(UPLOAD_GUARDS)) {
    const workflow = loadYaml(readFileSync(path.join(ROOT, file), 'utf8'));
    let guardCount = 0;
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const steps = job.steps || [];
      const guards = steps.filter((step) => step.run?.includes('scan-artifact-secrets.mjs'));
      guardCount += guards.length;
      const required = new Map();
      for (const step of steps) {
        for (const [name, value] of Object.entries(step.env || {})) {
          if (!SECRET_ENV_NAMES.includes(name)) continue;
          assert.match(value, /^\$\{\{\s*secrets\.[A-Za-z_]\w*\s*\}\}$/, `${file}: ${jobName}/${name} must come from secrets`);
          if (required.has(name)) assert.equal(value, required.get(name), `${file}: ${jobName}/${name} has conflicting sources`);
          required.set(name, value);
        }
      }
      for (const guard of guards) {
        for (const [name, value] of required) {
          if (guard.env?.[name] !== value) missing.push(`${file}: ${jobName}/${guard.id || guard.name}: ${name} must use ${value}`);
        }
      }
    }
    assert.equal(guardCount, expected, `${file}: all artifact guards must be checked`);
  }
  assert.deepEqual(missing, [], 'artifact guards must inherit every job secret env with the same source');
});

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
