import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activeAssignmentCount,
  normalizeCodesPayload,
  normalizeCohortsPayload,
  normalizeUsersPayload,
  quotaLabel,
  selectCodes,
  selectUsers,
  validateCodeDraft,
} from '../lib/admin-users-model.mjs';
import {
  buildLegacyRetirementRedirects,
  discoverLegacyHtmlPaths,
} from '../tooling/gate-f-retirement-redirects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-users)', 'admin', 'users', 'page.tsx');
const SHELL = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users.tsx');
const USERS = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users-panel.tsx');
const CODES = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const UI = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-user-ui.tsx');
const LAYOUT = read('app', '(authed-admin-users)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-users-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const NEXT_CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-users-flow.mjs');
const RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
  discoverLegacyHtmlPaths(join(ROOT, 'public')),
  { permanent: false },
);

describe('/admin/users — native ownership', () => {
  test('uses the backend admin gate and retains rollback artifacts', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="users">/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'users', 'index.html')));
    assert.ok(existsSync(join(ROOT, 'public', 'js', 'admin-users.js')));
    assert.ok(existsSync(join(ROOT, 'public', 'js', 'admin-access-codes.js')));
    assert.match(CHROME, /section: 'users'[^\n]+href: '\/admin\/users'/);
    assert.doesNotMatch(CHROME, /section: 'users'[^\n]+href: '\/pages\/admin\/users/);
  });

  test('owns the clean access-code alias without deleting the legacy consolidation path', () => {
    assert.match(NEXT_CONFIG, /source: '\/admin\/access-codes', destination: '\/admin\/users\?tab=codes', permanent: false/);
    assert.ok(RETIREMENT_REDIRECTS.some((entry) => (
      entry.source === '/pages/admin/access-codes/index.html'
        && entry.destination === '/admin/users?tab=codes'
        && entry.permanent === false
    )));
    assert.equal((OVERVIEW.match(/href="\/admin\/users/g) || []).length, 4);
  });

  test('loads the native admin cascade and contains wide tables locally', () => {
    for (const stylesheet of ['admin-surface.css', 'admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-users-next.css']) {
      assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    }
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(CSS, /calc\(100vw - 328px\)/);
    assert.match(CSS, /aver-admin-chrome\[data-collapsed="1"\] > \.au-shell/);
    assert.match(CSS, /\.au-table-scroll[^}]+overflow-x: auto[^}]+contain: layout paint/s);
    assert.match(CSS, /@media \(max-width: 768px\)/);
  });

  test('records native ownership, canonical reconciliation and rollback in the ledger', () => {
    assert.match(LEDGER, /`\/admin\/users`[^\n]+authed-admin-users[^\n]+canonical GET/);
    assert.match(LEDGER, /`\/pages\/admin\/users\/index\.html` remains rollback target/);
    assert.match(LEDGER, /`\/admin\/access-codes`[^\n]+Temporary redirect/);
  });
});

describe('/admin/users — canonical behavior', () => {
  test('reads users, cohorts and access codes from canonical endpoints', () => {
    assert.match(USERS, /window\.api\.get<unknown>\('\/admin\/users'\)/);
    assert.match(SHELL, /\/admin\/cohorts\?is_active=true/);
    assert.match(CODES, /window\.api\.get<unknown>\('\/admin\/access-codes'\)/);
  });

  test('preserves every user mutation and reconciles from backend truth', () => {
    for (const endpoint of [
      '/admin/users/${encodeURIComponent(user.id)}/role',
      "'/admin/students'",
      "'/admin/access-codes/generate-and-assign'",
      '/admin/access-codes/${encodeURIComponent(primary.id)}/users/${encodeURIComponent(user.id)}',
    ]) assert.ok(USERS.includes(endpoint), `missing ${endpoint}`);
    assert.match(USERS, /await action\(\);[\s\S]+await loadUsers\(true\)/);
    assert.match(USERS, /await window\.api\.post[\s\S]+await loadUsers\(true\)/);
  });

  test('surfaces rejected confirmation actions instead of leaking unhandled promises', () => {
    assert.match(USERS, /const runConfirm = async \(\) => \{[\s\S]+try \{[\s\S]+await current\.run\(\);[\s\S]+catch \(caught\)[\s\S]+setBanner\(\{ kind: 'error', text: messageOf\(caught\) \}\)/);
  });

  test('preserves the complete code lifecycle and canonical reload after writes', () => {
    for (const endpoint of [
      "'/admin/access-codes/generate'",
      '/admin/access-codes/${encodeURIComponent(edit.code.id)}',
      '/admin/access-codes/${encodeURIComponent(code.id)}/refill',
      '/admin/access-codes/${encodeURIComponent(code.id)}/users/${encodeURIComponent(user.user_id)}',
      '/admin/access-codes/${encodeURIComponent(code.id)}',
    ]) assert.ok(CODES.includes(endpoint), `missing ${endpoint}`);
    assert.match(CODES, /await action\(\);[\s\S]+await loadCodes\(true\)/);
    assert.match(CODES, /association_lookup_failed/);
    assert.match(CODES, /lookup failed/);
    assert.match(CODES, /lịch sử kích hoạt/);
  });

  test('suppresses stale account responses and never injects backend HTML', () => {
    assert.match(USERS, /requestId !== sequence\.current/);
    assert.match(CODES, /requestId !== sequence\.current/);
    assert.match(SHELL, /requestId === cohortSequence\.current/);
    for (const source of [SHELL, USERS, CODES, UI]) assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML/);
  });

  test('uses accessible tabs, dialogs, sorting and failure states', () => {
    assert.match(SHELL, /role="tablist"/);
    assert.match(SHELL, /aria-selected=\{tab === 'users'\}/);
    assert.match(SHELL, /aria-controls="users-panel"/);
    assert.match(SHELL, /onKeyDown=\{moveTabFocus\}/);
    assert.match(USERS, /id="users-panel"[^>]+role="tabpanel"[^>]+aria-labelledby="users-tab"/);
    assert.match(CODES, /id="codes-panel"[^>]+role="tabpanel"[^>]+aria-labelledby="codes-tab"/);
    assert.match(UI, /role="dialog"/);
    assert.match(UI, /aria-modal="true"/);
    assert.match(UI, /event\.key === 'Escape'/);
    assert.match(UI, /event\.key !== 'Tab'/);
    assert.match(UI, /focusable\[focusable\.length - 1\]/);
    assert.match(UI, /\}, \[open\]\);/);
    assert.match(UI, /busyRef\.current/);
    assert.match(UI, /aria-label=\{`Sắp xếp theo/);
    assert.match(USERS, /role="alert"/);
    assert.match(CODES, /role="alert"/);
  });

  test('gates its fixture-backed browser contract in CI', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-users\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-users-next\.css/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-users-flow\.mjs/);
    assert.match(BROWSER, /parsed\.pathname === '\/auth\/me'/);
    assert.match(BROWSER, /unexpectedWrites/);
    assert.match(BROWSER, /canonical reload/);
  });
});

describe('admin users model — hostile and partial payloads', () => {
  test('drops rows without ids and normalizes nested summaries', () => {
    const rows = normalizeUsersPayload([
      null,
      { email: 'missing@example.test' },
      { id: 'u1', email: '<img src=x>', role: 'owner', sessions_today: '4', cohort_names: ['Lớp A', 'Lớp B'], code_summary: { codes: [{ id: 'c1', code: '<script>' }], permissions: ['all', null], has_active_code: true } },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, 'student');
    assert.equal(rows[0].sessions_today, 4);
    assert.equal(rows[0].code_summary.codes[0].code, '<script>');
    assert.deepEqual(rows[0].code_summary.permissions, ['all']);
    assert.deepEqual(rows[0].cohort_names, ['Lớp A', 'Lớp B']);
  });

  test('normalizes lookup failures, fallback owners and quota without inventing associations', () => {
    const codes = normalizeCodesPayload([{ id: 'c1', code: 'ABC', association_lookup_failed: true, assigned_users: [{ user_id: 'u1', email: '<svg>', is_fallback_used_by: true, removable: false, quota: { used: '3', limit: '5' } }] }]);
    assert.equal(codes[0].association_lookup_failed, true);
    assert.equal(codes[0].assigned_users[0].is_fallback_used_by, true);
    assert.equal(codes[0].assigned_users[0].removable, false);
    assert.equal(quotaLabel(codes[0].assigned_users[0].quota), '3/5 · còn 2');
  });

  test('distinguishes real active assignments from a legacy fallback owner', () => {
    const [fallback, assigned] = normalizeCodesPayload([
      { id: 'legacy', code: 'OLD', assigned_user_count: 1, assigned_users: [{ user_id: 'u1', is_fallback_used_by: true, removable: false }] },
      { id: 'active', code: 'LIVE', assigned_user_count: 1, assigned_users: [{ user_id: 'u2', is_fallback_used_by: false, removable: true }] },
    ]);
    assert.equal(activeAssignmentCount(fallback), 0);
    assert.equal(activeAssignmentCount(assigned), 1);
    assert.match(CODES, /disabled=\{activeAssignments > 0 \|\| code\.association_lookup_failed\}/);
  });

  test('filters and sorts users and codes using the legacy semantics', () => {
    const users = normalizeUsersPayload([
      { id: 'u1', email: 'b@example.test', role: 'student', created_at: '2026-01-01' },
      { id: 'u2', email: 'a@example.test', role: 'admin', created_at: '2026-02-01' },
    ]);
    assert.deepEqual(selectUsers(users, { role: 'admin', search: 'a@' }, { field: 'created_at', order: 'desc' }).map((item) => item.id), ['u2']);
    const codes = normalizeCodesPayload([
      { id: 'c1', code: 'LIVE', is_active: true, created_at: '2026-01-01' },
      { id: 'c2', code: 'REVOKED', is_revoked: true, created_at: '2026-02-01' },
    ]);
    assert.deepEqual(selectCodes(codes, { status: '', search: '', type: '', cohort: '' }, { field: 'created_at', order: 'desc' }).map((item) => item.id), ['c1']);
    assert.deepEqual(selectCodes(codes, { status: 'revoked', search: 'rev', type: '', cohort: '' }, { field: 'status', order: 'asc' }).map((item) => item.id), ['c2']);
  });

  test('validates direct/cohort, permission, quota and batch count contracts', () => {
    assert.equal(validateCodeDraft({ codeType: 'direct', cohortId: '', permissions: ['all'], sessionLimitRaw: '' }).ok, false);
    assert.equal(validateCodeDraft({ codeType: 'mass', cohortId: 'cohort', permissions: ['all'], sessionLimitRaw: '' }).ok, false);
    assert.equal(validateCodeDraft({ codeType: 'mass', cohortId: '', permissions: [], sessionLimitRaw: '' }).ok, false);
    assert.equal(validateCodeDraft({ codeType: 'mass', cohortId: '', permissions: ['all'], sessionLimitRaw: '0' }).ok, false);
    assert.equal(validateCodeDraft({ codeType: 'mass', cohortId: '', permissions: ['all'], sessionLimitRaw: '3', countRaw: '101' }).ok, false);
    assert.deepEqual(normalizeCohortsPayload({ cohorts: [{ id: 'co1', name: '<b>Lớp</b>' }, { name: 'missing id' }] }), [{ id: 'co1', name: '<b>Lớp</b>' }]);
  });
});
