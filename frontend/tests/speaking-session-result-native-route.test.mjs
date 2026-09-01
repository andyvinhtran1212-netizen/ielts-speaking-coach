import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-session-result)', 'result', 'page.tsx');
const LAYOUT = read('app', '(authed-session-result)', 'layout.tsx');
const BEHAVIOR = read('app', '(authed-session-result)', 'result', 'session-result-behavior.tsx');
const PRACTICE = read('public', 'js', 'practice.js');
const STATS = read('app', '(authed-speaking)', 'speaking', 'speaking-stats.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');

describe('/result — native React ownership', () => {
  test('uses AuthedShell and a declarative page without legacy result script injection', () => {
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /pageStylesheets=\{\['\/css\/result\.css'\]\}/);
    assert.match(PAGE, /<SessionResultBehavior/);
    assert.doesNotMatch(PAGE + BEHAVIOR, /result\.html|dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });

  test('uses keyed auth/query state and aborts reads on teardown', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /`\$\{user\.id\}:\$\{sessionId\}`/);
    assert.match(BEHAVIOR, /resultState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /data\.session\.user\?\.id !== user\?\.id/);
  });

  test('reads one canonical session snapshot and never races a second questions endpoint', () => {
    assert.match(BEHAVIOR, /window\.api\.getWith<any>\(`\/sessions\/\$\{encodedId\}`/);
    assert.doesNotMatch(BEHAVIOR, /\/sessions\/\$\{encodedId\}\/questions|\/questions`/);
    assert.match(BEHAVIOR, /session\?\.question_lookup_failed === true/);
    assert.match(BEHAVIOR, /session\?\.response_lookup_failed === true/);
    assert.match(BEHAVIOR, /không hiển thị dữ liệu rỗng để tránh báo sai kết quả/);
  });

  test('keeps sealed mock, unfinished aggregate and absent-score states honest', () => {
    assert.match(BEHAVIOR, /Kết quả chưa được công bố/);
    assert.match(BEHAVIOR, /view\.isSealed/);
    assert.match(BEHAVIOR, /trạng thái canonical là completed/);
    assert.match(BEHAVIOR, /rounded == null \? '—'/);
  });

  test('preserves all result capabilities without raw authored HTML', () => {
    for (const contract of [
      'Tải báo cáo PDF', 'Luyện lại chủ đề này', 'Grammar Resources',
      'Phân tích phát âm chuyên sâu', 'Từ vựng mới ghi nhận', 'Điểm cần luyện',
      'Grammar Issues (LanguageTool)', 'Bản ghi lời nói',
    ]) assert.match(BEHAVIOR, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(BEHAVIOR, /__html|\.innerHTML\s*=/);
  });

  test('renders persisted curated vocabulary recommendations defensively', () => {
    assert.match(BEHAVIOR, /function VocabRecommendations/);
    assert.match(BEHAVIOR, /Học từ lỗi vừa nói/);
    assert.match(BEHAVIOR, /\/vocabulary\/learn\/\$\{encodeURIComponent\(item\.slug\)\}/);
    assert.match(BEHAVIOR, /\^\[a-z0-9\]\+/);
    assert.match(BEHAVIOR, /feedback\?\.vocab_recommendations/);
  });

  test('audio and generated blob URLs are released on unmount', () => {
    assert.match(BEHAVIOR, /audioRef\.current\?\.pause\(\)/);
    assert.match(BEHAVIOR, /actionControllers\.current\.forEach\(\(controller\) => controller\.abort\(\)\)/);
    assert.match(BEHAVIOR, /fetch\(url, \{ signal: controller\.signal \}\)/);
    assert.match(BEHAVIOR, /if \(!alive\.current \|\| controller\.signal\.aborted\) return/);
    assert.match(BEHAVIOR, /blobUrls\.current\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/);
    assert.match(BEHAVIOR, /audio\.onended/);
    assert.doesNotMatch(BEHAVIOR, /window\.open\(/);
  });

  test('retry and PDF use synchronous refs; retry reuses a persisted UUID', () => {
    assert.match(BEHAVIOR, /if \(pdfInFlight\.current\) return/);
    assert.match(BEHAVIOR, /if \(retryInFlight\.current\) return/);
    assert.match(BEHAVIOR, /client_session_id: retryRequestId\.current/);
    assert.match(BEHAVIOR, /sessionStorage\.setItem\(storageKey, retryRequestId\.current\)/);
    assert.match(BEHAVIOR, /admitCorePlayer\('speaking', \{ session_id: nextId \}\)/);
    assert.doesNotMatch(BEHAVIOR, /\/pages\/practice\.html/);
    assert.match(BEHAVIOR, /Bấm lại sẽ kiểm tra cùng một yêu cầu, không tạo trùng/);
    assert.match(BEHAVIOR, /if \(view\.mode === 'test_full'\) return/);
    assert.match(BEHAVIOR, /view\.mode === 'test_full'[\s\S]*href="\/full-test"[\s\S]*Làm lại Full Test/);
  });

  test('request-key change remounts ResultContent and clears media/accordion state', () => {
    assert.match(BEHAVIOR, /<ResultContent key=\{requestKey \|\| ''\}/);
  });
});

describe('/result — coexistence entry points', () => {
  test('Next player chooses native result and legacy player keeps rollback URL', () => {
    assert.match(PRACTICE, /function _singleSessionResultUrl\(sessionId\)/);
    assert.match(PRACTICE, /_getNativeView\(\) \? '\/result' : '\/pages\/result\.html'/);
    assert.equal((PRACTICE.match(/_singleSessionResultUrl\(sessionId\)/g) || []).length, 3);
    assert.match(PRACTICE, /_singleSessionResultUrl\(_sessionId\)/);
  });

  test('native Speaking history links to native result', () => {
    assert.match(STATS, /href="\/result\?id=\$\{encodeURIComponent\(s\.id\)\}"/);
    assert.doesNotMatch(STATS, /href="\/pages\/result\.html\?id=/);
  });

  test('route ledger records native ownership and rollback boundary', () => {
    const row = LEDGER.split('\n').find((line) => line.startsWith('| `/result` |')) || '';
    assert.match(row, /native React behavior/);
    assert.match(row, /rollback target/);
    assert.match(row, /response lookup/);
  });
});
