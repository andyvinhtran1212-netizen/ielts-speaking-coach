import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeResponseRegrade,
  normalizeSessionRegrade,
  normalizeSpeakingSessionDetail,
  normalizeSpeakingSessionFilters,
  normalizeSpeakingSessionList,
  normalizeSummaryRebuild,
  speakingSessionSearch,
} from '../lib/admin-speaking-sessions-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-speaking-sessions)', 'admin', 'speaking', 'sessions', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-speaking-sessions)', 'admin', 'speaking', 'sessions', 'admin-speaking-sessions.tsx');
const LAYOUT = read('app', '(authed-admin-speaking-sessions)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-speaking-sessions-next.css');
const HUB = read('app', '(authed-admin-speaking)', 'admin', 'speaking', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const CONFIG = read('next.config.ts');

const row = { id: 's1', user_id: 'u1', user_email: 'student@example.test', user_lookup_failed: false, mode: 'test_part', part: 2, topic: 'Home', status: 'completed', started_at: '2026-08-12T00:00:00Z', completed_at: null, overall_band: 6.5, band_fc: 6, band_lr: 6.5, band_gra: 6, band_p: 7, error_code: null, error_message: null, failed_step: null, last_error_at: null };

describe('Speaking Sessions native model', () => {
  test('normalizes URL filters and preserves valid deep-link state', () => {
    const filters = normalizeSpeakingSessionFilters({ email: ' x@example.test ', mode: 'test_part', status: 'completed', error: 'has_error', dateFrom: '2026-08-01', dateTo: '2026-08-13' });
    assert.deepEqual(filters, { email: 'x@example.test', mode: 'test_part', status: 'completed', error: 'has_error', dateFrom: '2026-08-01', dateTo: '2026-08-13' });
    assert.equal(speakingSessionSearch(filters, 's/1'), 'email=x%40example.test&mode=test_part&status=completed&error=has_error&from=2026-08-01&to=2026-08-13&session=s%2F1');
    assert.deepEqual(normalizeSpeakingSessionFilters({ mode: 'evil', status: 'done', error: 'x', dateFrom: '../x' }), { email: '', mode: '', status: '', error: '', dateFrom: '', dateTo: '' });
  });

  test('keeps lookup failure truthful and discards malformed list rows', () => {
    const result = normalizeSpeakingSessionList([{ ...row, user_lookup_failed: true }, { nope: true }]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].userLookupFailed, true);
    assert.equal(result.malformedCount, 1);
    assert.equal(result.returnedCount, 2);
    assert.equal(normalizeSpeakingSessionList({}), null);
  });

  test('normalizes detail, feedback and rejects unsafe audio URL', () => {
    const result = normalizeSpeakingSessionDetail({ ...row, questions: [{ id: 'q1', question_text: '<script>x</script>', order_num: 1 }], responses: [{ id: 'r1', question_id: 'q1', transcript: '<img onerror=x>', overall_band: 6, feedback: JSON.stringify({ grammar_issues: ['issue'], sample_answer: 'safe' }), audio_playback_url: 'javascript:alert(1)', audio_storage_path: 'stored', grading_status: 'completed', stt_status: 'completed' }], questions_lookup_failed: false, responses_lookup_failed: false }, 's1');
    assert.equal(result.questions[0].text, '<script>x</script>');
    assert.equal(result.responses[0].transcript, '<img onerror=x>');
    assert.equal(result.responses[0].audioUrl, null);
    assert.equal(result.responses[0].audioStored, true);
    assert.deepEqual(result.responses[0].feedback.grammarIssues, ['issue']);
    assert.equal(normalizeSpeakingSessionDetail({ ...row, questions: [], responses: [] }, 'other'), null);
  });

  test('requires mutation acknowledgements to match exact resources', () => {
    assert.ok(normalizeResponseRegrade({ ok: true, response_id: 'r1', session_id: 's1', overall_band: 7, session_updated: true, remaining_failed: 0 }, 'r1', 's1'));
    assert.equal(normalizeResponseRegrade({ ok: true, response_id: 'other', session_id: 's1', remaining_failed: 0 }, 'r1', 's1'), null);
    assert.equal(normalizeResponseRegrade({ ok: true, response_id: 'r1', session_id: 's1', session_updated: true }, 'r1', 's1'), null);
    assert.deepEqual(normalizeSessionRegrade({ ok: false, partial_failure: true, session_id: 's1', regraded: 1, skipped: 2, failed: 1, failed_details: ['x'] }, 's1').failedDetails, ['x']);
    assert.equal(normalizeSessionRegrade({ ok: true, partial_failure: false, session_id: 's1', regraded: -1, skipped: 0, failed: 0 }, 's1'), null);
    assert.equal(normalizeSummaryRebuild({ ok: true, sessions: [{ session_id: 's1', ok: true }, { session_id: 's2', ok: false, error: 'x' }] }, ['s1', 's2']).length, 2);
    assert.equal(normalizeSummaryRebuild({ ok: true, sessions: [{ session_id: 's1', ok: true }] }, ['s1', 's2']), null);
  });
});

describe('/admin/speaking/sessions native ownership and UX contract', () => {
  test('owns clean route while preserving direct rollback page', () => {
    assert.match(PAGE, /function AdminSpeakingSessionsPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/speaking\/sessions['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'speaking', 'sessions.html')));
    assert.match(HUB, /href: '\/admin\/speaking\/sessions'/);
    assert.match(CHROME, /slug: 'sessions'[^\n]+href: '\/admin\/speaking\/sessions'/);
  });

  test('uses backend admin truth, shared dialog and canonical readback', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="sessions"/);
    assert.match(COMPONENT, /Promise\.all\(\[loadDetail\(action\.sessionId\), loadList\(filters, true\)\]\)/);
    assert.match(COMPONENT, /mutationLock\.current/);
    assert.match(COMPONENT, /listSequence/);
    assert.match(COMPONENT, /detailSequence/);
    assert.match(COMPONENT, /user_email/);
    assert.match(COMPONENT, /profileId\.current !== account/);
    assert.match(COMPONENT, /snapshot\?\.key === targetKey/);
    assert.doesNotMatch(COMPONENT, /window\.api\.get<unknown>\('\/admin\/users'\)/);
    assert.match(COMPONENT, /<Dialog open=/);
    assert.doesNotMatch(COMPONENT, /\balert\(|\bconfirm\(|dangerouslySetInnerHTML/);
  });

  test('loads governed styles and CI browser verifier', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-speaking-sessions-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-speaking-sessions/);
    assert.match(WORKFLOW, /verify-admin-speaking-sessions-flow\.mjs/);
  });
});
