import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  alertsForScope,
  formatAlertTime,
  normalizeAlertsPayload,
  sessionAlertLabel,
  shortId,
} from '../lib/admin-alerts-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-system)', 'admin', 'system', 'alerts', 'page.tsx');
const CLIENT = read('app', '(authed-admin-system)', 'admin', 'system', 'alerts', 'admin-alerts.tsx');
const HUB = read('app', '(authed-admin-system)', 'admin', 'system', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-system)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-alerts-next.css');
const CONFIG = read('next.config.ts');

describe('/admin/system/alerts — native operational alerts', () => {
  test('owns the canonical route while preserving rollback HTML', () => {
    assert.match(PAGE, /function AdminAlertsPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/system\/alerts['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'system', 'alerts.html')));
    assert.match(HUB, /href="\/admin\/system\/alerts"/);
    assert.doesNotMatch(HUB, /href="\/pages\/admin\/system\/alerts\.html"/);
  });

  test('reads the canonical endpoint, guards stale responses, and never invents a mutation', () => {
    assert.match(CLIENT, /window\.api\.get<unknown>\('\/admin\/alerts\?limit=30'\)/);
    assert.match(CLIENT, /requestId !== sequence\.current/);
    assert.match(CLIENT, /return \(\) => \{ sequence\.current \+= 1; \}/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|patch|delete)/);
    assert.match(CLIENT, /Dữ liệu sự cố không đúng định dạng/);
    assert.match(CLIENT, /đang giữ dữ liệu của lần tải trước/);
    assert.match(CLIENT, /disabled=\{loading\}/);
  });

  test('uses native navigation, truthful artifact links, and responsive shared CSS', () => {
    assert.match(CLIENT, /href="\/admin\/system"/);
    assert.match(CLIENT, /\/pages\/admin\/speaking\/sessions\.html\?session=/);
    assert.match(CLIENT, /aria-live="polite"/);
    assert.match(CLIENT, /aria-busy=\{loading\}/);
    assert.match(LAYOUT, /admin-alerts-next\.css/);
    assert.doesNotMatch(LAYOUT, /['"]\/css\/aver-design\/admin-buttons\.css['"]/);
    assert.match(CSS, /calc\(100vw - 328px\)/);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(max-width: 430px\)/);
  });
});

describe('admin alerts canonical payload model', () => {
  const payload = normalizeAlertsPayload({
    session_errors: [{
      id: 'session-123456789', user_id: 'user-1', user_email: '',
      error_code: 'grading_failed', error_message: '<img src=x>',
      failed_step: 'admin_regrade_session', last_error_at: '2026-08-12T02:00:00Z',
      mode: 'full_test', part: 2, status: 'grading_failed',
    }, { missing: 'id' }],
    grading_failures: [{
      id: 'response-123456789', session_id: 'session-2', question_id: 'q-1',
      user_email: 'learner@example.com', grading_status: 'failed', stt_status: 'done',
    }, { id: 'orphan-response' }],
  });

  test('normalizes both canonical groups and reports malformed rows', () => {
    assert.ok(payload);
    assert.equal(payload.sessionErrors.length, 1);
    assert.equal(payload.gradingFailures.length, 1);
    assert.equal(payload.malformedCount, 2);
    assert.equal(payload.sessionErrors[0].userEmail, null);
    assert.equal(payload.sessionErrors[0].errorMessage, '<img src=x>');
    assert.equal(payload.sessionErrors[0].part, '2');
  });

  test('rejects a top-level contract that cannot distinguish empty from broken', () => {
    assert.equal(normalizeAlertsPayload({}), null);
    assert.equal(normalizeAlertsPayload({ session_errors: [], grading_failures: null }), null);
  });

  test('scopes client presentation without changing canonical counts', () => {
    assert.equal(alertsForScope(payload, 'sessions').gradingFailures.length, 0);
    assert.equal(alertsForScope(payload, 'grading').sessionErrors.length, 0);
    assert.equal(alertsForScope(payload, 'all').sessionErrors.length, 1);
  });

  test('formats labels, IDs and invalid timestamps without inventing values', () => {
    assert.equal(sessionAlertLabel('grading_failed'), 'Chấm bài');
    assert.equal(sessionAlertLabel('new_failure'), 'new_failure');
    assert.equal(shortId('session-123456789'), 'session-…');
    assert.equal(formatAlertTime('not-a-date'), 'Chưa rõ');
    assert.equal(formatAlertTime(null), 'Chưa rõ');
  });
});
