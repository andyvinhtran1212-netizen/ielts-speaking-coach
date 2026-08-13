import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isWritingStatusTerminal,
  normalizeWritingStatusPayload,
  normalizeWritingStatusQuery,
  writingStatusHref,
  writingStatusPhase,
  writingStatusProgress,
} from '../lib/admin-writing-status-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-status)', 'admin', 'writing', 'status', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-status)', 'admin', 'writing', 'status', 'admin-writing-status.tsx');
const LAYOUT = read('app', '(authed-admin-writing-status)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-status-next.css');
const QUEUE_MODEL = read('lib', 'admin-writing-queue-model.mjs');
const LEGACY_QUEUE = read('public', 'js', 'admin-writing-queue.js');
const LEGACY_NEW = read('public', 'pages', 'admin', 'writing', 'new.html');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const raw = {
  essay_id: 'e1', status: 'grading', error_message: null, eta_seconds: 120,
  grading_tier: 'standard', created_at: '2026-08-13T00:00:00Z',
  attempt_count: 2, max_attempts: 3, attempt_failures: 1,
  last_failure: { attempt: 1, model: '<img onerror=x>', kind: 'timeout', message: 'slow', at: '2026-08-13T00:01:00Z' },
};

describe('Admin Writing Status native model', () => {
  test('normalizes query flags and preserves clean native hops', () => {
    assert.deepEqual(normalizeWritingStatusQuery({ id: ' e1 ', embed: '1', mocklane: true }), { essayId: 'e1', embed: true, mocklane: true });
    assert.equal(writingStatusHref('grade', { essayId: 'e/1', embed: true, mocklane: true }), '/admin/writing/grade?essay_id=e%2F1&embed=1&mocklane=1');
    assert.equal(writingStatusHref('queue', { essayId: 'e1', embed: false, mocklane: false }), '/admin/writing/queue?status=grading');
    assert.equal(writingStatusHref('queue', { essayId: 'e1', embed: true, mocklane: true }), '/admin/writing/queue?embed=1&mocklane=1');
  });

  test('requires exact canonical identity and bounded required fields', () => {
    const result = normalizeWritingStatusPayload(raw, 'e1');
    assert.equal(result.essayId, 'e1');
    assert.equal(result.lastFailure.model, '<img onerror=x>');
    assert.equal(normalizeWritingStatusPayload({ ...raw, essay_id: 'other' }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, status: 'invented' }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, eta_seconds: 0 }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, created_at: 'invalid' }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, attempt_count: true }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, attempt_count: 4, max_attempts: 3 }, 'e1'), null);
    assert.equal(normalizeWritingStatusPayload({ ...raw, attempt_count: 1, attempt_failures: 2 }, 'e1'), null);
  });

  test('drops malformed optional retry detail without discarding canonical status', () => {
    const result = normalizeWritingStatusPayload({ ...raw, error_message: 44, last_failure: { nope: true } }, 'e1');
    assert.equal(result.status, 'grading');
    assert.equal(result.errorMessage, null);
    assert.equal(result.lastFailure, null);
    assert.equal(result.malformedOptional, 2);
    assert.equal(normalizeWritingStatusPayload({ ...raw, last_failure: { ...raw.last_failure, attempt: 3 } }, 'e1').malformedOptional, 1);
    assert.equal(normalizeWritingStatusPayload({ ...raw, last_failure: null }, 'e1').malformedOptional, 1);
    assert.equal(normalizeWritingStatusPayload({ ...raw, attempt_failures: 0, last_failure: null }, 'e1').malformedOptional, 0);
  });

  test('marks terminal states and labels all progress as time estimates', () => {
    for (const status of ['graded', 'reviewed', 'delivered', 'failed']) assert.equal(isWritingStatusTerminal(status), true);
    assert.equal(isWritingStatusTerminal('grading'), false);
    assert.equal(writingStatusProgress('pending', 999, 60), 8);
    assert.equal(writingStatusProgress('grading', 60, 120), 50);
    assert.equal(writingStatusProgress('grading', 999, 60), 92);
    assert.equal(writingStatusProgress('failed', 1, 60), 100);
    assert.equal(writingStatusPhase('grading', 'deep', 179), 'Deep tier · pha 2/3 ước tính');
  });
});

describe('/admin/writing/status native ownership and UX contract', () => {
  test('owns clean route while direct legacy HTML remains rollback', () => {
    assert.match(PAGE, /function AdminWritingStatusPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/status['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'status.html')));
    assert.match(QUEUE_MODEL, /['"]\/admin\/writing\/status['"]/);
    assert.match(LEGACY_QUEUE, /\/admin\/writing\/status\?essay_id=/);
    assert.match(LEGACY_NEW, /\/admin\/writing\/status\?essay_id=/);
    assert.match(LEDGER, /`\/admin\/writing\/status`[^\n]+authed-admin-writing-status[^\n]+native React ownership/);
  });

  test('fails closed, polls sequentially and suppresses stale account/essay responses', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="queue"/);
    assert.match(COMPONENT, /currentKey\.current !== requestKey/);
    assert.match(COMPONENT, /requestId !== sequence\.current/);
    assert.match(COMPONENT, /window\.setTimeout\(cycle, delay\)/);
    assert.match(COMPONENT, /schedule\(POLL_MS\)/);
    assert.doesNotMatch(COMPONENT, /setInterval\(poll|window\.setInterval\(cycle/);
    assert.match(COMPONENT, /document\.hidden/);
    assert.match(COMPONENT, /visibilitychange/);
    assert.match(COMPONENT, /isWritingStatusTerminal\(next\.status\)/);
    assert.match(COMPONENT, /data\?\.status/);
  });

  test('does not invent writes or realtime percent truth', () => {
    assert.doesNotMatch(COMPONENT, /window\.api\.(?:post|patch|delete|upload)|\bfetch\(/);
    assert.match(COMPONENT, /Tiến độ thời gian ước tính/);
    assert.match(COMPONENT, /không phải phần trăm xử lý realtime/);
    assert.match(COMPONENT, /Đang hiển thị snapshot gần nhất/);
    assert.match(COMPONENT, /Reliability ledger/);
    assert.match(COMPONENT, /role="progressbar"/);
  });

  test('loads governed responsive styles and CI browser verifier', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-status-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-writing-status/);
    assert.match(WORKFLOW, /verify-admin-writing-status-flow\.mjs/);
  });
});
