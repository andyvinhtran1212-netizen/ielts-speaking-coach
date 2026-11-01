// PC-J441: offline only. Tokens are assembled fake values; no probe is run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateG2, parseLedger } from '../tooling/g2-floor.mjs';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const { PLAYWRIGHT_REPORT_RE, readZip, writeZip } = require('../tooling/redact-secrets.cjs');
const FRONTEND = fileURLToPath(new URL('../', import.meta.url));
const ROOT = path.resolve(FRONTEND, '..');
const JWT = 'eyJTEST' + 'x'.repeat(20) + '.eyJTEST' + 'y'.repeat(20) + '.sigFAKE';

function cli(script, targets) {
  const result = spawnSync(process.execPath, [path.join(FRONTEND, 'tooling', script), ...targets], {
    cwd: FRONTEND, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(JWT) && !output.includes('eyJTEST'), 'CLI must print no token fragments');
  return { status: result.status, output };
}

function cleanTargets(targets) {
  const sanitized = cli('sanitize-artifacts.mjs', targets);
  assert.equal(sanitized.status, 0, sanitized.output);
  const scanned = cli('scan-artifact-secrets.mjs', targets);
  assert.equal(scanned.status, 0, scanned.output);
  assert.match(scanned.output, /0 flagged/);
  return scanned.output;
}

test('production HTML embedded ZIP, error context and trace ZIP fail scan then sanitize cleanly', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj441-report-'));
  try {
    const report = path.join(dir, 'playwright-report');
    mkdirSync(path.join(report, 'data'), { recursive: true });
    const embedded = writeZip([{ name: 'report.json', data: Buffer.from(JSON.stringify({ error: `Bearer ${JWT}` })) }]);
    writeFileSync(path.join(report, 'index.html'), '<!DOCTYPE html><template id="playwrightReportBase64">data:application/zip;base64,' + embedded.toString('base64') + '</template>');
    writeFileSync(path.join(report, 'data', 'error.md'), `Authorization: Bearer ${JWT}\nroute failed`);
    writeFileSync(path.join(report, 'data', 'trace.zip'), writeZip([
      { name: 'trace.network', data: Buffer.from(JSON.stringify({ note: JWT })) },
    ]));
    const before = cli('scan-artifact-secrets.mjs', [report]);
    assert.equal(before.status, 1);
    for (const file of ['index.html', 'data/error.md', 'data/trace.zip']) {
      assert.ok(before.output.includes(`${path.join(report, file)}: 1 secret-like match(es)`), 'each representation must be counted');
    }
    t.diagnostic(before.output.trim());
    t.diagnostic(cleanTargets([report]).trim());
    const html = readFileSync(path.join(report, 'index.html'), 'utf8');
    const match = html.match(PLAYWRIGHT_REPORT_RE);
    assert.ok(match, 'report remains openable');
    const entries = readZip(Buffer.from(match[2], 'base64'));
    assert.equal(JSON.parse(entries[0].data.toString()).error, 'Bearer [REDACTED]');
    const trace = readZip(readFileSync(path.join(report, 'data', 'trace.zip')));
    assert.equal(JSON.parse(trace[0].data.toString()).note, '[REDACTED]');
    assert.match(readFileSync(path.join(report, 'data', 'error.md'), 'utf8'), /route failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both g2 ledgers remain valid JSONL with unchanged samples and verdict fields after both guards', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pcj441-ledger-'));
  try {
    const out = path.join(dir, 'out');
    mkdirSync(out);
    const files = [];
    const originals = [];
    for (const mode of ['tick', 'session']) {
      const samples = [
        { at: 1000, mode, ok: false, status: 401, route: '/auth/me', ms: 17, afterRefresh: false, note: `Bearer ${JWT}` },
        { at: 2000, mode, ok: false, status: 500, route: '/auth/profile', ms: 23, afterRefresh: true, note: `JWT ${JWT}` },
      ];
      const file = path.join(out, `g2-ledger-${mode}.jsonl`);
      writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
      files.push(file);
      originals.push(samples);
    }
    const untouched = path.join(out, 'unrelated.jsonl');
    writeFileSync(untouched, 'unrelated output\n');
    const before = cli('scan-artifact-secrets.mjs', files);
    assert.equal(before.status, 1);
    for (const file of files) assert.ok(before.output.includes(`${file}: 2 secret-like match(es)`));
    t.diagnostic(before.output.trim());
    // Pre-cache scrub, then pre-upload scrub: both use the same J437 helpers.
    t.diagnostic(cleanTargets(files).trim());
    const once = files.map((f) => readFileSync(f, 'utf8'));
    cleanTargets(files);
    assert.deepEqual(files.map((f) => readFileSync(f, 'utf8')), once, 'second guard is idempotent');
    assert.equal(readFileSync(untouched, 'utf8'), 'unrelated output\n');
    for (let i = 0; i < files.length; i += 1) {
      const parsed = parseLedger(once[i]);
      assert.equal(parsed.corruptLines, 0);
      assert.equal(parsed.samples.length, originals[i].length);
      const withoutNote = ({ note, ...fields }) => fields;
      assert.deepEqual(parsed.samples.map(withoutNote), originals[i].map(withoutNote));
      assert.ok(parsed.samples.every((s) => s.note.includes('[REDACTED]')));
      const options = { now: 2000, authenticated: true };
      const rawVerdict = evaluateG2(originals[i], options);
      const cleanVerdict = evaluateG2(parsed.samples, options);
      assert.deepEqual(cleanVerdict.stats, rawVerdict.stats);
      assert.equal(cleanVerdict.pass, rawVerdict.pass);
      assert.deepEqual(cleanVerdict.findings.map((f) => f.code), rawVerdict.findings.map((f) => f.code));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workflow(file) {
  return load(readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8'));
}

function assertGuard(guard, target) {
  assert.ok(guard?.id, 'the immediately preceding step must be an identified guard');
  assert.match(guard.if, /always\(\)/);
  assert.equal(guard['working-directory'], 'frontend');
  assert.equal(guard.run.trim(), `node tooling/sanitize-artifacts.mjs ${target}\nnode tooling/scan-artifact-secrets.mjs ${target}`);
  assert.ok(!guard['continue-on-error'], 'guard failures must fail the job');
}

for (const [file, target] of [
  ['production-smoke.yml', 'playwright-report'],
  ['g2-authed-probe.yml', 'out/g2-ledger-*.jsonl'],
]) {
  test(`${file}: every upload waits for its immediately preceding sanitize + scan guard`, () => {
    const uploads = [];
    for (const job of Object.values(workflow(file).jobs)) {
      job.steps.forEach((step, i) => {
        if (!step.uses?.startsWith('actions/upload-artifact@')) return;
        uploads.push(step);
        const guard = job.steps[i - 1];
        assertGuard(guard, target);
        assert.ok(!step['continue-on-error']);
        assert.equal(step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), `always() && steps.${guard.id}.outcome == 'success'`);
        if (file === 'g2-authed-probe.yml') {
          assert.equal(step.with['if-no-files-found'], 'ignore');
          assert.equal(job.steps[i - 2].name, 'Chấm sàn ADR-013-A1', 'upload guard runs after the verdict');
        }
      });
    }
    assert.equal(uploads.length, 1, 'expected production artifact sink');
  });
}

test('g2 cache-save is blocked unless the immediately preceding ledger guard succeeded', () => {
  const steps = workflow('g2-authed-probe.yml').jobs.probe.steps;
  const caches = steps.map((step, i) => ({ step, i })).filter(({ step }) => step.uses?.startsWith('actions/cache/save@'));
  assert.equal(caches.length, 1);
  for (const { step, i } of caches) {
    const guard = steps[i - 1];
    assertGuard(guard, 'out/g2-ledger-*.jsonl');
    assert.equal(guard.if, "${{ always() && env.PROBE_MODE != 'verdict' }}");
    assert.equal(step.if, `\${{ always() && env.PROBE_MODE != 'verdict' && steps.${guard.id}.outcome == 'success' }}`);
    assert.match(steps[i - 2].run, /^node tooling\/authed-probe.mjs --mode /, 'guard runs after the probe writes');
  }
});

test('production CI reporter reuses J437 redaction before github and HTML reporters', () => {
  const file = path.join(FRONTEND, 'playwright.production-smoke.config.js');
  const previous = process.env.CI;
  try {
    process.env.CI = '1';
    delete require.cache[require.resolve(file)];
    const config = require(file);
    assert.deepEqual(config.reporter, [
      ['./tests/staging-e2e/redaction-reporter.js'], ['github'], ['html', { open: 'never' }],
    ]);
    assert.equal(config.use.trace, 'retain-on-failure');
    assert.equal(config.use.screenshot, 'only-on-failure');
  } finally {
    if (previous === undefined) delete process.env.CI;
    else process.env.CI = previous;
    delete require.cache[require.resolve(file)];
  }
});
