import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  classifyListeningAudit,
  filterListeningAuditRows,
  listeningAuditDetailRollbackHref,
  listeningAuditHref,
  normalizeListeningAuditFilters,
  normalizeListeningAuditInventoryPage,
  normalizeListeningAuditSnapshot,
  summarizeListeningAuditRows,
} from '../lib/admin-listening-audit-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const component = read('app/(authed-admin-listening)/admin/listening/audit/admin-listening-audit.tsx');
const backend = read('../backend/routers/listening.py');
const page = read('app/(authed-admin-listening)/admin/listening/audit/page.tsx');
const css = read('public/css/admin-listening-audit-next.css');
const workflow = read('../.github/workflows/parity-gate.yml');

const testRow = (id = 'test-1', testId = 'ILR-LIS-001') => ({
  id, test_id: testId, title: `Title ${testId}`, status: 'published', test_type: 'full', exam_only: false,
  section_count: 4, audio_ready_count: 4, accent_profile: [], band_target: 7, created_at: '2026-08-14T00:00:00Z', updated_at: '2026-08-14T01:00:00Z',
});

function issue(severity, index = 1) {
  return { q_num: index, dimension: 'audio', severity, code: `${severity}_${index}`, message: `${severity} finding`, resolved: false };
}

function auditRaw({ id = 'test-1', testId = 'ILR-LIS-001', errors = 0, warnings = 0, saved = null } = {}) {
  const issues = [
    ...Array.from({ length: errors }, (_, index) => issue('error', index + 1)),
    ...Array.from({ length: warnings }, (_, index) => issue('warning', errors + index + 1)),
  ];
  return {
    uuid: id, test_id: testId, title: `Title ${testId}`, status: 'published', test_type: 'full',
    question_count: 40, section_count: 4, sections: [],
    live: { issues, health: { error_count: errors, warning_count: warnings, status: errors ? 'has_issues' : 'passed' } },
    saved,
  };
}

describe('audit model rejects incomplete truth', () => {
  it('normalizes shareable filters and encodes rollback identities', () => {
    assert.deepEqual(normalizeListeningAuditFilters({ search: ' CAM 20 ', type: 'drill', health: 'lookup', saved: 'fixed' }), { search: 'CAM 20', type: 'drill', health: 'lookup', saved: 'fixed' });
    assert.equal(listeningAuditHref({ search: 'A&B', health: 'error' }), '/admin/listening/audit?search=A%26B&health=error');
    assert.equal(listeningAuditDetailRollbackHref('uuid/x'), '/pages/admin/listening/audit-detail.html?id=uuid%2Fx');
  });

  it('accepts exact inventory pages and rejects one malformed row', () => {
    const good = { items: [testRow()], total: 1, limit: 100, offset: 0 };
    assert.equal(normalizeListeningAuditInventoryPage(good, { limit: 100, offset: 0 }).rows.length, 1);
    assert.equal(normalizeListeningAuditInventoryPage({ ...good, items: [{ ...testRow(), section_count: -1 }] }, { limit: 100, offset: 0 }), null);
    assert.equal(normalizeListeningAuditInventoryPage({ ...good, offset: 1 }, { limit: 100, offset: 0 }), null);
  });

  it('binds audit identity, live counts and saved full-run evidence', () => {
    const savedIssues = [issue('warning')];
    const saved = { test_id: 'test-1', status: 'passed', issues: savedIssues, health: { error_count: 0, warning_count: 1, status: 'passed' }, audited_at: '2026-08-14T02:00:00Z', updated_at: '2026-08-14T02:00:00Z' };
    const value = normalizeListeningAuditSnapshot(auditRaw({ warnings: 2, saved }), { id: 'test-1', testId: 'ILR-LIS-001' });
    assert.equal(value.live.warningCount, 2);
    assert.equal(value.saved.status, 'passed');
    assert.equal(value.saved.health.warningCount, 1);
  });

  it('keeps saved full-run health historical after human issue resolution', () => {
    const resolved = { ...issue('error'), resolved: true };
    const saved = { test_id: 'test-1', status: 'fixed', issues: [resolved], health: { error_count: 1, warning_count: 0, status: 'has_issues' }, audited_at: '2026-08-14T02:00:00Z' };
    const value = normalizeListeningAuditSnapshot(auditRaw({ saved }), { id: 'test-1', testId: 'ILR-LIS-001' });
    assert.equal(value.saved.status, 'fixed');
    assert.equal(value.saved.health.errorCount, 1);
  });

  it('labels legacy persisted audits with missing timestamps as unknown time, not never run', () => {
    assert.match(component, /saved\.status === 'pending' \? 'Chưa có full run đã lưu' : 'Đã chạy · không rõ thời điểm'/);
    assert.match(backend, /"audited_at": audited_at/);
  });

  it('rejects identity drift, inconsistent health and malformed saved issues', () => {
    assert.equal(normalizeListeningAuditSnapshot(auditRaw(), { id: 'other', testId: 'ILR-LIS-001' }), null);
    const wrongCount = auditRaw({ errors: 1 }); wrongCount.live.health.error_count = 0; wrongCount.live.health.status = 'passed';
    assert.equal(normalizeListeningAuditSnapshot(wrongCount, { id: 'test-1', testId: 'ILR-LIS-001' }), null);
    const badSaved = { test_id: 'test-1', status: 'fixed', issues: [{}], health: { error_count: 0, warning_count: 0, status: 'passed' } };
    assert.equal(normalizeListeningAuditSnapshot(auditRaw({ saved: badSaved }), { id: 'test-1', testId: 'ILR-LIS-001' }), null);
  });

  it('keeps lookup failure separate from clean health in filters and summary', () => {
    const clean = normalizeListeningAuditSnapshot(auditRaw({ id: 'a', testId: 'A' }), { id: 'a', testId: 'A' });
    const warning = normalizeListeningAuditSnapshot(auditRaw({ id: 'b', testId: 'B', warnings: 1 }), { id: 'b', testId: 'B' });
    const rows = [
      { test: { id: 'a', testId: 'A', title: 'Alpha', type: 'full' }, audit: { phase: 'ready', value: clean } },
      { test: { id: 'b', testId: 'B', title: 'Beta', type: 'full' }, audit: { phase: 'ready', value: warning } },
      { test: { id: 'c', testId: 'C', title: 'Gamma', type: 'drill' }, audit: { phase: 'error', message: '503' } },
    ];
    assert.equal(classifyListeningAudit(rows[2].audit), 'lookup');
    assert.deepEqual(summarizeListeningAuditRows(rows), { total: 3, loading: 0, lookup: 1, error: 0, warning: 1, clean: 1, savedPending: 2 });
    assert.deepEqual(filterListeningAuditRows(rows, { health: 'lookup' }).map((row) => row.test.id), ['c']);
    assert.deepEqual(filterListeningAuditRows(rows, { search: 'alp', saved: 'pending' }).map((row) => row.test.id), ['a']);
  });
});

describe('native audit dashboard contracts', () => {
  it('owns the clean route with explicit HTML watchdog rollback', () => {
    assert.match(page, /AdminListeningAudit/);
    assert.match(page, /watchdogScript\('\/pages\/admin\/listening\/audit\.html'\)/);
    assert.match(component, /href="\/pages\/admin\/listening\/audit\.html"/);
    assert.match(component, /listeningAuditDetailRollbackHref/);
  });

  it('fails closed on partial paging and batches canonical audit GETs', () => {
    assert.match(component, /page\.total !== expectedTotal/);
    assert.match(component, /page\.rows\.length < PAGE_LIMIT/);
    assert.match(component, /rows\.length !== expectedTotal/);
    assert.match(component, /offset \+= AUDIT_BATCH/);
    assert.doesNotMatch(component, /Promise\.all\(tests\.map/);
  });

  it('never converts GET failures into a clean row and exposes GET-only retry', () => {
    assert.match(component, /phase: 'error', message: messageOf\(caught\)/);
    assert.match(component, /Lookup failed/);
    assert.match(component, /Retry \{failedTests\.length\} lookup failed/);
    assert.doesNotMatch(component, /window\.api\.(post|patch|upload|delete)/);
  });

  it('pins account/request freshness before committing async state', () => {
    assert.match(component, /activeAccount\.current !== owner/);
    assert.match(component, /request !== scanSequence\.current/);
    assert.match(component, /request !== inventorySequence\.current/);
  });

  it('has accessible progress, mobile cards and token-only styling', () => {
    assert.match(component, /role="progressbar"/);
    assert.match(component, /aria-valuetext/);
    assert.match(css, /@media\(max-width:700px\)/);
    assert.match(css, /content:attr\(data-label\)/);
    assert.match(css, /min-height:44px/);
    assert.match(css, /prefers-reduced-motion/);
    assert.equal((css.match(/#[0-9a-fA-F]{3,8}/g) || []).length, 0);
  });

  it('is wired into parity gate with route and browser dependencies', () => {
    assert.match(workflow, /admin-listening-audit-next-behavior\.test\.mjs/);
    assert.match(workflow, /verify-admin-listening-audit-flow\.mjs/);
    assert.match(workflow, /admin\/listening\/audit\/\*\*/);
  });
});
