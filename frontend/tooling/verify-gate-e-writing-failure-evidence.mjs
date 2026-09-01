import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fail = (message) => { throw new Error(`Writing failure evidence: ${message}`); };
const sorted = (values) => [...values].sort();
const collectTests = (suites, output = []) => {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) output.push({ ...test, title: test.title || spec.title });
    }
    collectTests(suite.suites, output);
  }
  return output;
};

export function validateWritingFailureJson(manifest, report) {
  const expectedCounts = manifest.expected_project_counts || {};
  const expectedProjects = manifest.automated_projects?.map(({ project }) => project) || [];
  const expectedTests = manifest.expected_tests || [];
  if (!Number.isInteger(manifest.expected_total_tests) || manifest.expected_total_tests <= 0) fail('manifest total invalid');
  if (!expectedTests.length || new Set(expectedTests).size !== expectedTests.length) fail('manifest tests invalid');
  if (JSON.stringify(sorted(Object.keys(expectedCounts))) !== JSON.stringify(sorted(expectedProjects))) fail('project counts mismatch');
  if (Object.values(expectedCounts).reduce((sum, count) => sum + count, 0) !== manifest.expected_total_tests) fail('project total mismatch');
  if (expectedTests.length * expectedProjects.length !== manifest.expected_total_tests) fail('matrix is incomplete');
  const configuredProjects = report?.config?.projects?.map(({ name }) => name) || [];
  if (JSON.stringify(sorted(configuredProjects)) !== JSON.stringify(sorted(expectedProjects))) fail('configured projects mismatch');
  if (!Array.isArray(report.errors) || report.errors.length !== 0) fail('top-level errors present');
  const stats = report.stats || {};
  for (const field of ['skipped', 'unexpected', 'flaky']) if (stats[field] !== 0) fail(`stats.${field} must be zero`);
  if (stats.expected !== manifest.expected_total_tests) fail(`stats.expected ${stats.expected} != ${manifest.expected_total_tests}`);
  const tests = collectTests(report.suites);
  if (tests.length !== manifest.expected_total_tests) fail(`discovered ${tests.length} tests != ${manifest.expected_total_tests}`);
  const actualCounts = Object.fromEntries(expectedProjects.map((project) => [project, 0]));
  const actualTitles = Object.fromEntries(expectedProjects.map((project) => [project, []]));
  for (const item of tests) {
    const project = item.projectName || item.projectId;
    if (!Object.hasOwn(actualCounts, project)) fail(`unexpected project ${project || '<missing>'}`);
    if (!expectedTests.includes(item.title)) fail(`${project} unexpected test ${item.title || '<missing>'}`);
    if (item.status !== 'expected') fail(`${project} non-passing status ${item.status || '<missing>'}`);
    if (!Array.isArray(item.results) || item.results.length !== 1 || item.results[0]?.status !== 'passed') {
      fail(`${project} must contain exactly one passed result per test`);
    }
    actualCounts[project] += 1;
    actualTitles[project].push(item.title);
  }
  for (const [project, expected] of Object.entries(expectedCounts)) {
    if (actualCounts[project] !== expected) fail(`${project} executed ${actualCounts[project]} tests != ${expected}`);
    if (JSON.stringify(sorted(actualTitles[project])) !== JSON.stringify(sorted(expectedTests))) fail(`${project} required paths mismatch`);
  }
  return { total_tests: tests.length, project_counts: actualCounts };
}

export function validateWritingFailureHtml(html) {
  if (!/^\s*<!DOCTYPE html>/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) fail('HTML shell missing');
  const template = html.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=\r\n]+)<\/template>\s*$/);
  if (!template) fail('HTML embedded report bundle missing');
  const encoded = template[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('HTML embedded report is not base64');
  const zip = Buffer.from(encoded, 'base64');
  if (zip.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) fail('HTML embedded report base64 is truncated');
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) fail('HTML embedded report is not ZIP');
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) fail('HTML ZIP end record missing');
  const commentLength = zip.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== zip.length) fail('HTML ZIP truncated');
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount < 1 || centralOffset + centralSize !== eocd) fail('HTML ZIP central directory incomplete');
  if (!zip.includes(Buffer.from('report.json'))) fail('HTML ZIP report.json missing');
  return { embedded_bytes: zip.length };
}

export function run() {
  const testedRoot = path.resolve(process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND));
  const manifest = JSON.parse(readFileSync(path.join(AUDITOR_FRONTEND, 'tooling', 'gate-e-writing-device-matrix.json'), 'utf8'));
  const report = JSON.parse(readFileSync(path.join(testedRoot, 'frontend', 'test-results', 'gate-e-writing-device-matrix-results.json'), 'utf8'));
  const html = readFileSync(path.join(testedRoot, 'frontend', 'playwright-report', 'gate-e-writing', 'index.html'), 'utf8');
  const json = validateWritingFailureJson(manifest, report);
  const embedded = validateWritingFailureHtml(html);
  console.log(`Writing failure evidence verified: ${json.total_tests} tests, ${Object.keys(json.project_counts).length} projects, ${embedded.embedded_bytes} embedded bytes`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
