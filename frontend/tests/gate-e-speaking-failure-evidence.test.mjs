import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateSpeakingFailureHtml,
  validateSpeakingFailureJson,
} from '../tooling/verify-gate-e-speaking-failure-evidence.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = JSON.parse(
  readFileSync(path.join(FRONTEND, 'tooling', 'gate-e-speaking-device-matrix.json'), 'utf8'),
);

const validReport = () => {
  const tests = Object.entries(MANIFEST.expected_project_counts).flatMap(([projectName, count]) => (
    Array.from({ length: count }, () => ({
      projectName,
      status: 'expected',
      results: [{ status: 'passed' }],
    }))
  ));
  return {
    config: { projects: MANIFEST.automated_projects.map(({ project: name }) => ({ name })) },
    suites: [{ specs: [{ tests }] }],
    errors: [],
    stats: {
      expected: MANIFEST.expected_total_tests,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    },
  };
};

const minimalReportZip = () => {
  const name = Buffer.from('report.json');
  const body = Buffer.from('{}');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);

  const localEntry = Buffer.concat([local, name, body]);
  const centralEntry = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  return Buffer.concat([localEntry, centralEntry, eocd]);
};

const validHtml = () => (
  '<!DOCTYPE html><html><head></head><body></body>'
  + '<template id="playwrightReportBase64">data:application/zip;base64,'
  + `${minimalReportZip().toString('base64')}</template>`
);

const runVerifier = (testedRoot) => spawnSync(
  process.execPath,
  ['tooling/verify-gate-e-speaking-failure-evidence.mjs'],
  {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { ...process.env, GATE_E_TESTED_ROOT: testedRoot },
  },
);

describe('Speaking failure evidence is semantic and fail-closed', () => {
  test('accepts the exact frozen 46-test/3-project report and complete HTML bundle', () => {
    assert.deepEqual(validateSpeakingFailureJson(MANIFEST, validReport()).project_counts, {
      'gate-e-chromium-desktop': 16,
      'gate-e-webkit-desktop': 15,
      'gate-e-webkit-iphone13': 15,
    });
    assert.ok(validateSpeakingFailureHtml(validHtml()).embedded_bytes > 22);
  });

  test('rejects malformed JSON and a syntactically valid empty-suite report', () => {
    assert.throws(() => JSON.parse('{"suites":'), SyntaxError);
    const empty = validReport();
    empty.suites = [];
    assert.throws(
      () => validateSpeakingFailureJson(MANIFEST, empty),
      /JSON discovered 0 tests != 46/,
    );
  });

  test('rejects wrong project counts and non-passing results', () => {
    const wrongCount = validReport();
    wrongCount.suites[0].specs[0].tests.pop();
    assert.throws(
      () => validateSpeakingFailureJson(MANIFEST, wrongCount),
      /JSON discovered 45 tests != 46/,
    );

    const failed = validReport();
    failed.suites[0].specs[0].tests[0].results[0].status = 'failed';
    assert.throws(
      () => validateSpeakingFailureJson(MANIFEST, failed),
      /must contain exactly one passed result/,
    );
  });

  test('rejects a truncated or semantically empty HTML report', () => {
    assert.throws(() => validateSpeakingFailureHtml('<!DOCTYPE html><html><body></body>'), /embedded report bundle/);
    const truncated = validHtml().replace(/.{12}<\/template>$/, '</template>');
    assert.throws(() => validateSpeakingFailureHtml(truncated), /base64 is truncated|ZIP/);
  });

  test('CLI fails when either report is missing and passes only with both valid reports', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'gate-e-speaking-evidence-'));
    const resultFile = path.join(
      tempRoot,
      'frontend/test-results/gate-e-speaking-device-matrix-results.json',
    );
    const htmlFile = path.join(tempRoot, 'frontend/playwright-report/gate-e/index.html');
    try {
      mkdirSync(path.dirname(resultFile), { recursive: true });
      mkdirSync(path.dirname(htmlFile), { recursive: true });
      writeFileSync(resultFile, JSON.stringify(validReport()));
      assert.notEqual(runVerifier(tempRoot).status, 0, 'missing HTML must fail');

      writeFileSync(htmlFile, validHtml());
      assert.equal(runVerifier(tempRoot).status, 0, 'complete evidence must pass');

      writeFileSync(resultFile, '{"suites":');
      assert.notEqual(runVerifier(tempRoot).status, 0, 'malformed JSON must fail');

      const empty = validReport();
      empty.suites = [];
      writeFileSync(resultFile, JSON.stringify(empty));
      assert.notEqual(runVerifier(tempRoot).status, 0, 'empty-suite JSON must fail');

      writeFileSync(resultFile, JSON.stringify(validReport()));
      rmSync(resultFile);
      assert.notEqual(runVerifier(tempRoot).status, 0, 'missing JSON must fail');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
