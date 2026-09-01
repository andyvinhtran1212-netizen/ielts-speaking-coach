import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateWritingFailureHtml,
  validateWritingFailureJson,
} from '../tooling/verify-gate-e-writing-failure-evidence.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = JSON.parse(readFileSync(path.join(FRONTEND, 'tooling', 'gate-e-writing-device-matrix.json'), 'utf8'));
const validReport = () => ({
  config: { projects: MANIFEST.automated_projects.map(({ project: name }) => ({ name })) },
  suites: [{ specs: [{ tests: Object.keys(MANIFEST.expected_project_counts).flatMap((projectName) => (
    MANIFEST.expected_tests.map((title) => ({ title, projectName, status: 'expected', results: [{ status: 'passed' }] }))
  )) }] }],
  errors: [],
  stats: { expected: 12, skipped: 0, unexpected: 0, flaky: 0 },
});
const reportZip = () => {
  const name = Buffer.from('report.json'); const body = Buffer.from('{}');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const localEntry = Buffer.concat([local, name, body]); const centralEntry = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(centralEntry.length, 12); eocd.writeUInt32LE(localEntry.length, 16);
  return Buffer.concat([localEntry, centralEntry, eocd]);
};
const validHtml = () => '<!DOCTYPE html><html><body></body><template id="playwrightReportBase64">data:application/zip;base64,' + reportZip().toString('base64') + '</template>';

describe('Writing failure evidence is semantic and fail closed', () => {
  test('accepts exact report and complete embedded HTML', () => {
    assert.equal(validateWritingFailureJson(MANIFEST, validReport()).total_tests, 12);
    assert.ok(validateWritingFailureHtml(validHtml()).embedded_bytes > 22);
  });
  test('rejects empty, wrong title, failed result and missing bundle', () => {
    const empty = validReport(); empty.suites = [];
    assert.throws(() => validateWritingFailureJson(MANIFEST, empty), /discovered 0 tests/);
    const wrong = validReport(); wrong.suites[0].specs[0].tests[0].title = 'wrong';
    assert.throws(() => validateWritingFailureJson(MANIFEST, wrong), /unexpected test/);
    const failed = validReport(); failed.suites[0].specs[0].tests[0].results[0].status = 'failed';
    assert.throws(() => validateWritingFailureJson(MANIFEST, failed), /exactly one passed/);
    assert.throws(() => validateWritingFailureHtml('<!DOCTYPE html><html><body></body>'), /bundle missing/);
  });
  test('accepts projectId reports', () => {
    const report = validReport();
    for (const item of report.suites[0].specs[0].tests) { item.projectId = item.projectName; delete item.projectName; }
    assert.equal(validateWritingFailureJson(MANIFEST, report).total_tests, 12);
  });
});
