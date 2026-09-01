import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dictationReportsHref, dictationReportsRollbackHref, formatDictationDuration,
  normalizeDictationAggregate, normalizeDictationReportDetail,
  normalizeDictationReportFilters, normalizeDictationReportList,
} from '../lib/admin-listening-dictation-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'dictation', 'page.tsx');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'dictation', 'admin-listening-dictation.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = readFileSync(join(here, '..', '..', 'backend', 'routers', 'admin_overview.py'), 'utf8');

const row = (patch = {}) => ({
  id: 'session-1', user_id: 'user-1', test_id_external: 'C19-T1', section_num: 2,
  section_title: 'Section 2', total_sentences: 4, correct_count: 3, accuracy: 0.875,
  total_time_seconds: 150, completed_at: '2026-08-14T00:02:30Z', created_at: '2026-08-14T00:00:00Z',
  user: { id: 'user-1', email: 'learner@example.com', display_name: 'Học viên A' }, ...patch,
});
const list = (patch = {}) => ({
  items: [row()], total: 1, limit: 50, offset: 0,
  association_lookup_failed: false, association_lookup_failures: [], ...patch,
});

describe('Admin Listening dictation model', () => {
  test('filters round-trip through the native URL and rollback keeps supported user filter', () => {
    assert.deepEqual(normalizeDictationReportFilters({ user: ' a@b.com ', test: ' C19 ', page: '0', session: ' s1 ' }), { user: 'a@b.com', test: 'C19', page: 1, session: 's1' });
    assert.equal(dictationReportsHref({ user: 'a@b.com', test: 'C19 T1', page: 2, session: 's1' }), '/admin/listening/dictation?user=a%40b.com&test=C19+T1&page=2&session=s1');
    assert.equal(dictationReportsRollbackHref({ user: 'a@b.com', test: 'ignored' }), '/pages/admin/listening/dictation-reports.html?user=a%40b.com');
  });

  test('list preserves backend total, excludes malformed rows and exposes lookup truth', () => {
    const normalized = normalizeDictationReportList(list({ items: [row(), row({ id: 'bad', accuracy: 2 })], total: 75 }), { limit: 50, offset: 0 });
    assert.equal(normalized.rows.length, 1);
    assert.equal(normalized.malformedCount, 1);
    assert.equal(normalized.total, 75);
    assert.equal(normalizeDictationReportList(list({ association_lookup_failed: true })), null);
    assert.equal(normalizeDictationReportList(list({ association_lookup_failed: true, association_lookup_failures: ['users'] })).associationLookupFailed, true);
  });

  test('aggregate distinguishes no sessions from zero accuracy and counts malformed words', () => {
    assert.deepEqual(normalizeDictationAggregate({ session_count: 0, mean_accuracy: 0, top_missed: [], top_wrong: [] }), { sessionCount: 0, meanAccuracy: 0, topMissed: [], topWrong: [], malformedWordCount: 0 });
    const aggregate = normalizeDictationAggregate({ session_count: 3, mean_accuracy: 0.625, top_missed: [{ word: 'Brighton', count: 4 }, { word: '', count: 1 }], top_wrong: [{ expected: 'address', count: 2 }] });
    assert.equal(aggregate.meanAccuracy, 0.625);
    assert.equal(aggregate.malformedWordCount, 1);
    assert.equal(normalizeDictationAggregate({ session_count: 0, mean_accuracy: 1, top_missed: [], top_wrong: [] }), null);
  });

  test('detail keeps the reference sentence and filters duplicate/malformed evidence', () => {
    const sentence = { sentence_idx: 0, reference: 'The address is Brighton.', user_text: '<script>', score: 0.75, correct_words: 3, total_words: 4, listen_count: 2, time_seconds: 30, ops: { miss: 0, wrong: 1, extra: 0 } };
    const detail = normalizeDictationReportDetail({
      ...row(), total_words: 16, correct_words: 14,
      results: [sentence, sentence, { ...sentence, sentence_idx: -1 }],
      error_trends: { op_counts: { miss: 1, wrong: 2, extra: 0 } },
      association_lookup_failed: false, association_lookup_failures: [],
    }, 'session-1');
    assert.equal(detail.sentences.length, 1);
    assert.equal(detail.malformedSentenceCount, 2);
    assert.equal(detail.missingSentenceCount, 3);
    assert.equal(detail.sentences[0].reference, 'The address is Brighton.');
    assert.equal(detail.sentences[0].userText, '<script>');
    assert.equal(normalizeDictationReportDetail({ ...row(), total_words: 1, correct_words: 1, results: [], association_lookup_failed: false, association_lookup_failures: [] }, 'other'), null);
  });

  test('duration formatting never invents missing values', () => {
    assert.equal(formatDictationDuration(150), '2 phút 30 giây');
    assert.equal(formatDictationDuration(null), '—');
    assert.equal(formatDictationDuration(-1), '—');
  });
});

describe('native route ownership and operational behavior', () => {
  test('page uses admin gate, Suspense and dictation subsection', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<Suspense/);
    assert.match(PAGE, /subsection="dictation-reports"/);
  });

  test('client scopes stale reads, separates list/aggregate failures and owns URL detail identity', () => {
    assert.match(CLIENT, /profile\.id/);
    assert.match(CLIENT, /listSequence\.current/);
    assert.match(CLIENT, /aggregateSequence\.current/);
    assert.match(CLIENT, /normalizeDictationReportDetail/);
    assert.match(CLIENT, /Lookup học viên thất bại/);
    assert.match(CLIENT, /Evidence chưa đầy đủ/);
    assert.match(CLIENT, /Không tải được tổng hợp/);
    assert.match(CLIENT, /Không tải được danh sách/);
  });

  test('navigation enters the native route while rollback stays explicit', () => {
    assert.match(CHROME, /slug: 'dictation-reports',\s+label: 'Báo cáo chép chính tả',\s+href: '\/admin\/listening\/dictation'/);
    assert.match(OVERVIEW, /"link":\s+"\/admin\/listening\/dictation"/);
    assert.match(CLIENT, /dictationReportsRollbackHref/);
    assert.match(CLIENT, /href="\/admin\/feedback"/);
  });

  test('detail renders reference and learner text with responsive route CSS', () => {
    assert.match(CLIENT, /Câu chuẩn/);
    assert.match(CLIENT, /Học viên gõ/);
    assert.match(CLIENT, /aria-label="Chi tiết từng câu dictation"/);
    assert.match(LAYOUT, /admin-listening-dictation-next\.css/);
  });
});
