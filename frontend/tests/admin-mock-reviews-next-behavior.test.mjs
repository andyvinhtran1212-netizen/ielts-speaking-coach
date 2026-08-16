import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const COMPONENT = read('app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx');
const REPORT = read('app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'report', 'admin-mock-review-report.tsx');
const PAGE = read('app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-mock-reviews)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-mock-reviews-next.css');
const COCKPIT = read('app', '(authed-admin-mock-tests)', 'admin', 'mock-tests', 'admin-mock-tests.tsx');
const MODEL = read('lib', 'admin-mock-tests-model.mjs');

describe('/admin/mock-reviews native ownership', () => {
  test('owns the canonical routes behind the backend admin gate', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /mock_exam_id/);
    assert.ok(existsSync(join(ROOT, 'app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'report', 'page.tsx')));
    assert.match(LAYOUT, /admin-mock-reviews-next\.css/);
    assert.match(MODEL, /\/admin\/mock-reviews\?mock_exam_id=/);
    assert.doesNotMatch(MODEL, /pages\/admin\/mock-reviews\/index\.html/);
    assert.doesNotMatch(COCKPIT, /id: 'review'[^\n]+legacy: true/);
  });

  test('fails closed on missing identity and keeps lookup failures distinct from empty truth', () => {
    for (const token of ['Thiếu mock_exam_id', 'Không tải được bảng lớp', 'Thử lại bảng lớp', 'Không tải được tổng kết test lại', 'normalizeReviewRoster', 'normalizeRetestSummary', 'requestRef.current', 'detailRequestRef.current', 'accountRef.current !== account']) assert.ok(COMPONENT.includes(token), token);
    assert.doesNotMatch(COMPONENT, /catch\s*\([^)]*\)\s*\{\s*\}/);
  });

  test('reconciles every canonical mutation and names partial batch refusals', () => {
    for (const token of ['loadRoster()', 'loadSummary()', 'openDetail(id, activeSkill)', 'normalizeBulkAck', 'Backend không xác nhận', 'Không tự gửi lại', 'setSkips(allSkips)', 'sittingId.slice(0, 8)', 'Dialog open={Boolean(releaseTarget)}', 'Xác nhận công bố', 'value.review.claimedBy === profile.id', "['grading', 'graded', 'reviewed', 'delivered'].includes(canonical.status)"]) assert.ok(COMPONENT.includes(token), token);
  });

  test('preserves skill review, Writing, Speaking and final-band capabilities', () => {
    for (const token of ['/api/reading/test/attempts/', '/api/listening/tests/attempts/', '/admin/writing/essays/', '/start-grading', '/speaking-assessment', '/final-bands', '/release-claim', '/full-test-result?session_id=', '/admin/writing/grade?essay_id=', 'Cần test lại', 'Overall xem trước']) assert.ok(COMPONENT.includes(token), token);
  });

  test('renders report from canonical final bands including LRW live Speaking extras', () => {
    for (const token of ['normalizeReviewDetail', 'reportSkills(detail)', 'detail.review.finalBands.overall != null', "['reviewed', 'released']", 'Object.values(detail.review.retestFlags).some(Boolean)', 'window.print()']) assert.ok(REPORT.includes(token), token);
  });

  test('ships responsive accessible styles rather than an iframe-sized legacy surface', () => {
    for (const token of ['@media (max-width: 900px)', '@media (max-width: 640px)', '@media print', '.mrr-band-grid', '.mrr-report-grid']) assert.ok(CSS.includes(token), token);
    assert.doesNotMatch(COMPONENT, /dangerouslySetInnerHTML|<iframe/);
  });
});
