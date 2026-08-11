import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const fail = (message) => {
  throw new Error(`Speaking failure evidence: ${message}`);
};

const sorted = (values) => [...values].sort();

const collectTests = (suites, output = []) => {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) output.push(...(spec.tests || []));
    collectTests(suite.suites, output);
  }
  return output;
};

export function validateSpeakingFailureJson(manifest, report) {
  const expectedCounts = manifest.expected_project_counts || {};
  const expectedProjects = manifest.automated_projects?.map(({ project }) => project) || [];
  if (!Number.isInteger(manifest.expected_total_tests) || manifest.expected_total_tests <= 0) {
    fail('manifest expected_total_tests must be a positive integer');
  }
  if (JSON.stringify(sorted(Object.keys(expectedCounts))) !== JSON.stringify(sorted(expectedProjects))) {
    fail('manifest project counts do not match automated projects');
  }
  const countTotal = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
  if (countTotal !== manifest.expected_total_tests) {
    fail(`manifest project counts total ${countTotal} != ${manifest.expected_total_tests}`);
  }

  const configuredProjects = report?.config?.projects?.map(({ name }) => name) || [];
  if (JSON.stringify(sorted(configuredProjects)) !== JSON.stringify(sorted(expectedProjects))) {
    fail('JSON configured projects do not match the frozen matrix');
  }
  if (!Array.isArray(report.errors) || report.errors.length !== 0) {
    fail('JSON report contains top-level errors');
  }
  const stats = report.stats || {};
  for (const field of ['skipped', 'unexpected', 'flaky']) {
    if (stats[field] !== 0) fail(`JSON stats.${field} must be zero`);
  }
  if (stats.expected !== manifest.expected_total_tests) {
    fail(`JSON stats.expected ${stats.expected} != ${manifest.expected_total_tests}`);
  }

  const tests = collectTests(report.suites);
  if (tests.length !== manifest.expected_total_tests) {
    fail(`JSON discovered ${tests.length} tests != ${manifest.expected_total_tests}`);
  }
  const actualCounts = Object.fromEntries(expectedProjects.map((project) => [project, 0]));
  for (const test of tests) {
    if (!Object.hasOwn(actualCounts, test.projectName)) {
      fail(`JSON contains unexpected project ${test.projectName || '<missing>'}`);
    }
    if (test.status !== 'expected') {
      fail(`${test.projectName} contains non-passing test status ${test.status || '<missing>'}`);
    }
    if (!Array.isArray(test.results) || test.results.length !== 1 || test.results[0]?.status !== 'passed') {
      fail(`${test.projectName} must contain exactly one passed result per test`);
    }
    actualCounts[test.projectName] += 1;
  }
  for (const [project, expected] of Object.entries(expectedCounts)) {
    if (actualCounts[project] !== expected) {
      fail(`${project} executed ${actualCounts[project]} tests != ${expected}`);
    }
  }

  return { total_tests: tests.length, project_counts: actualCounts };
}

export function validateSpeakingFailureHtml(html) {
  if (!/^\s*<!DOCTYPE html>/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    fail('HTML report is missing its document shell');
  }
  const template = html.match(
    /<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=\r\n]+)<\/template>\s*$/,
  );
  if (!template) fail('HTML report is missing a complete embedded report bundle');

  const encoded = template[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('HTML embedded report is not base64');
  const zip = Buffer.from(encoded, 'base64');
  if (zip.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    fail('HTML embedded report base64 is truncated');
  }
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) {
    fail('HTML embedded report is not a ZIP bundle');
  }
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) fail('HTML embedded ZIP has no complete end record');
  const commentLength = zip.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== zip.length) fail('HTML embedded ZIP is truncated');
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount < 1 || centralOffset + centralSize !== eocd) {
    fail('HTML embedded ZIP central directory is incomplete');
  }
  if (centralOffset + 4 > zip.length || zip.readUInt32LE(centralOffset) !== 0x02014b50) {
    fail('HTML embedded ZIP central directory is invalid');
  }
  if (!zip.includes(Buffer.from('report.json'))) fail('HTML embedded ZIP is missing report.json');

  return { embedded_bytes: zip.length };
}

export function verifySpeakingFailureEvidence({ manifest, report, html }) {
  return {
    json: validateSpeakingFailureJson(manifest, report),
    html: validateSpeakingFailureHtml(html),
  };
}

export function run() {
  const testedRoot = path.resolve(
    process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND),
  );
  const manifest = JSON.parse(
    readFileSync(path.join(AUDITOR_FRONTEND, 'tooling', 'gate-e-speaking-device-matrix.json'), 'utf8'),
  );
  const report = JSON.parse(
    readFileSync(
      path.join(testedRoot, 'frontend', 'test-results', 'gate-e-speaking-device-matrix-results.json'),
      'utf8',
    ),
  );
  const html = readFileSync(
    path.join(testedRoot, 'frontend', 'playwright-report', 'gate-e', 'index.html'),
    'utf8',
  );
  const result = verifySpeakingFailureEvidence({ manifest, report, html });
  console.log(
    `Speaking failure evidence verified: ${result.json.total_tests} tests, `
    + `${Object.keys(result.json.project_counts).length} projects`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
