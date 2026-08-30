import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateListeningFailureHtml,
  validateListeningFailureJson,
} from '../tooling/verify-gate-e-listening-failure-evidence.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = JSON.parse(
  readFileSync(path.join(FRONTEND, 'tooling', 'gate-e-listening-device-matrix.json'), 'utf8'),
);

const validReport = () => {
  const tests = Object.keys(MANIFEST.expected_project_counts).flatMap((projectName) => (
    MANIFEST.expected_tests.map((title) => ({
      title,
      projectName,
      status: 'expected',
      results: [{ status: 'passed' }],
    }))
  ));
  return {
    config: { projects: MANIFEST.automated_projects.map(({ project: name }) => ({ name })) },
    suites: [{ specs: [{ tests }] }],
    errors: [],
    stats: { expected: MANIFEST.expected_total_tests, skipped: 0, unexpected: 0, flaky: 0 },
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
  ['tooling/verify-gate-e-listening-failure-evidence.mjs'],
  {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { ...process.env, GATE_E_TESTED_ROOT: testedRoot },
  },
);

describe('Listening failure evidence is semantic and fail-closed', () => {
  test('accepts only the exact 36-test/3-project/twelve-path report', () => {
    assert.deepEqual(validateListeningFailureJson(MANIFEST, validReport()).project_counts, {
      'gate-e-listening-chromium-desktop': 12,
      'gate-e-listening-webkit-desktop': 12,
      'gate-e-listening-webkit-iphone13': 12,
    });
    assert.ok(validateListeningFailureHtml(validHtml()).embedded_bytes > 22);
  });

  test('rejects an empty report, wrong title and non-passing result', () => {
    const empty = validReport();
    empty.suites = [];
    assert.throws(() => validateListeningFailureJson(MANIFEST, empty), /JSON discovered 0 tests != 36/);
    const wrongTitle = validReport();
    wrongTitle.suites[0].specs[0].tests[0].title = 'not-a-listening-failure-path';
    assert.throws(() => validateListeningFailureJson(MANIFEST, wrongTitle), /unexpected test/);
    const failed = validReport();
    failed.suites[0].specs[0].tests[0].results[0].status = 'failed';
    assert.throws(() => validateListeningFailureJson(MANIFEST, failed), /exactly one passed result/);
  });

  test('accepts Playwright reports that identify projects with projectId', () => {
    const report = validReport();
    for (const item of report.suites[0].specs[0].tests) {
      item.projectId = item.projectName;
      delete item.projectName;
    }
    assert.equal(
      validateListeningFailureJson(MANIFEST, report).total_tests,
      MANIFEST.expected_total_tests,
    );
  });

  test('rejects truncated or semantically empty HTML', () => {
    assert.throws(() => validateListeningFailureHtml('<!DOCTYPE html><html><body></body>'), /embedded report bundle/);
    const truncated = validHtml().replace(/.{12}<\/template>$/, '</template>');
    assert.throws(() => validateListeningFailureHtml(truncated), /base64 is truncated|ZIP/);
  });

  test('CLI fails closed on missing files and accepts both complete reports', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'gate-e-listening-evidence-'));
    const resultFile = path.join(tempRoot, 'frontend/test-results/gate-e-listening-device-matrix-results.json');
    const htmlFile = path.join(tempRoot, 'frontend/playwright-report/gate-e-listening/index.html');
    try {
      mkdirSync(path.dirname(resultFile), { recursive: true });
      mkdirSync(path.dirname(htmlFile), { recursive: true });
      writeFileSync(resultFile, JSON.stringify(validReport()));
      assert.notEqual(runVerifier(tempRoot).status, 0, 'missing HTML must fail');
      writeFileSync(htmlFile, validHtml());
      assert.equal(runVerifier(tempRoot).status, 0, 'complete evidence must pass');
      rmSync(resultFile);
      assert.notEqual(runVerifier(tempRoot).status, 0, 'missing JSON must fail');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
