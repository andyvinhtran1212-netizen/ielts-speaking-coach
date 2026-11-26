import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activeAssignmentCount,
  auditActionLabel,
  codeLedgerState,
  DEFAULT_CODE_EXPIRING_DAYS,
  expiringDaysFromThresholds,
  grantCreditsLabel,
  normalizeCodeAudit,
  normalizeCodeDetail,
  normalizeCodesPayload,
  normalizeCohortsPayload,
  normalizeUsersPayload,
  quotaLabel,
  revokeUsedDraftError,
  revokeUsedResultMessage,
  selectCodes,
  selectUsers,
  validateCodeDraft,
} from '../lib/admin-users-model.mjs';
import {
  buildLegacyRetirementRedirects,
  LEGACY_RETIREMENT_PATHS,
} from '../tooling/legacy-url-redirects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin)/(users)', 'admin', 'users', 'page.tsx');
const SHELL = read('app', '(authed-admin)/(users)', 'admin', 'users', 'admin-users.tsx');
const USERS = read('app', '(authed-admin)/(users)', 'admin', 'users', 'admin-users-panel.tsx');
const CODES = read('app', '(authed-admin)/(users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const LEDGER_PAGE = read('app', '(authed-admin)/(users)', 'admin', 'activation-codes', 'page.tsx');
const LEDGER_SHELL = read('app', '(authed-admin)/(users)', 'admin', 'activation-codes', 'admin-activation-codes.tsx');
const UI = read('app', '(authed-admin)/(users)', 'admin', 'users', 'admin-user-ui.tsx');
const LAYOUT = read('app', '(authed-admin)', 'layout.tsx') + read('app', '(authed-admin)', '(users)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-users-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin)', '(overview)', 'admin', 'admin-overview.tsx');
const NEXT_CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'next-native-browser.yml');
const BROWSER = read('tooling', 'verify-admin-users-flow.mjs');
const API = read('lib', 'admin-users-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(LEGACY_RETIREMENT_PATHS);

describe('/admin/users — native ownership', () => {
  test('uses the backend admin gate and retains a non-deployable historical fixture', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="users">/);
    assert.ok(existsSync(join(ROOT, 'tests', 'fixtures', 'legacy-html-retired',
      'pages', 'admin', 'users', 'index.html')));
    // LEGACYJS-0075 W3a retired the legacy controllers; the fixture stays (ADR-005).
    assert.equal(existsSync(join(ROOT, 'public', 'js', 'admin-users.js')), false);
    assert.equal(existsSync(join(ROOT, 'public', 'js', 'admin-access-codes.js')), false);
    assert.match(CHROME, /section: 'users'[^\n]+href: '\/admin\/users'/);
    assert.doesNotMatch(CHROME, /section: 'users'[^\n]+href: '\/pages\/admin\/users/);
  });

  test('owns the clean access-code alias without deleting the legacy consolidation path', () => {
    // ADMINIA-0074 FR-048: the alias now lands on the activation-code ledger,
    // and the former codes tab URL 307s there.
    assert.match(NEXT_CONFIG, /source: '\/admin\/access-codes', destination: '\/admin\/activation-codes', permanent: true/);
    assert.match(NEXT_CONFIG, /source: '\/admin\/users',\s+has: \[\{ type: 'query', key: 'tab', value: 'codes' \}\],\s+destination: '\/admin\/activation-codes',\s+permanent: false,/);
    assert.ok(RETIREMENT_REDIRECTS.some((entry) => (
      entry.source === '/pages/admin/access-codes/index.html'
        && entry.destination === '/admin/users?tab=codes'
        && entry.permanent === true
    )));
    assert.equal((OVERVIEW.match(/href="\/admin\/users/g) || []).length, 2);
    assert.equal((OVERVIEW.match(/href="\/admin\/activation-codes"/g) || []).length, 2);
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
    assert.match(LEDGER, /`\/admin\/users`[^\n]+\(authed-admin\)\/\(users\)[^\n]+canonical GET/);
    assert.match(LEDGER, /`\/pages\/admin\/users\/index\.html` remains rollback target/);
    assert.match(LEDGER, /`\/admin\/access-codes`[^\n]+Permanent redirect to `\/admin\/activation-codes`/);
    assert.match(LEDGER, /`\/admin\/activation-codes`[^\n]+activation-codes\/page\.tsx/);
  });
});

describe('/admin/users — canonical behavior', () => {
  test('reads users, cohorts and access codes from canonical endpoints', () => {
    assert.match(API, /getBrowserJson\('\/admin\/users'\)/);
    assert.match(API, /getBrowserJson\('\/admin\/access-codes'\)/);
    assert.match(USERS, /getAdminUsers\(\)/);
    assert.match(SHELL, /getAdminCohorts\(\{ isActive: true \}\)/);
    assert.match(LEDGER_SHELL, /getAdminCohorts\(\{ isActive: true \}\)/);
    assert.match(LEDGER_SHELL, /getAdminThresholds\(\)/);
    assert.match(API, /getBrowserJson\('\/admin\/settings\/thresholds'\)/);
    assert.match(CODES, /getAdminAccessCodes\(\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["AdminUserDirectoryRowOut"\]\[\]/);
    assert.doesNotMatch(USERS, /window\.api\.get/);
    assert.doesNotMatch(CODES, /window\.api\.get/);
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

  test('preserves the code lifecycle except creation, with canonical reload after writes', () => {
    // ADMINIA-0074 FR-048: codes are issued from a class page only.
    assert.doesNotMatch(CODES, /'\/admin\/access-codes\/generate'/);
    assert.doesNotMatch(CODES, />Tạo mã mới</);
    assert.match(CODES, /Tạo mã cho một lớp/);
    assert.match(CODES, /`\/admin\/classes\/\$\{encodeURIComponent\(classPicker\.cohortId\)\}`/);
    for (const endpoint of [
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
    assert.match(LEDGER_SHELL, /requestId !== sequence\.current/);
    for (const source of [SHELL, USERS, CODES, UI, LEDGER_PAGE, LEDGER_SHELL]) assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML/);
  });

  test('uses accessible pages, dialogs, row menus, sorting and failure states', () => {
    // ADMINIA-0074 FR-048: users and codes are separate pages, not tabs.
    assert.doesNotMatch(SHELL, /role="tablist"|role="tab"/);
    assert.doesNotMatch(USERS, /role="tabpanel"|aria-labelledby="users-tab"/);
    assert.doesNotMatch(CODES, /role="tabpanel"|aria-labelledby="codes-tab"/);
    assert.match(SHELL, /href="\/admin\/activation-codes"/);
    assert.match(LEDGER_PAGE, /<AdminAccessGate>/);
    assert.match(LEDGER_PAGE, /<aver-admin-chrome active="access-codes">/);
    assert.match(UI, /aria-haspopup="menu"/);
    assert.match(UI, /role="menuitem"/);
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
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin\)\/\(users\)\/\*\*/);
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
    // FR-055: revoke is the last "⋯" item and is refused while the code is in use.
    // A legacy code with only used_by has no active assignment but is still
    // used; either way the revoke goes to the code page's danger zone.
    assert.equal(codeLedgerState(fallback).state, 'used');
    assert.match(CODES, /label: 'Thu hồi mã',[\s\S]+disabledReason: activeAssignments > 0 \|\| entry\?\.state === 'used' \? 'Mã đã dùng; thu hồi ở Vùng nguy hiểm của trang mã\.'\s+: code\.association_lookup_failed \?/);
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

  test('ADMINIA-0074 FR-048: ledger states, credits label and expiring threshold', () => {
    const now = Date.parse('2026-11-23T00:00:00Z');
    const day = 86_400_000;
    const at = (offset) => new Date(now + offset * day).toISOString();
    const [unused, soon, expired, used, legacyUsed, revoked, credited] = normalizeCodesPayload([
      { id: 'a', code: 'A', expires_at: at(30) },
      { id: 'b', code: 'B', expires_at: at(10) },
      { id: 'c', code: 'C', expires_at: at(-1) },
      { id: 'd', code: 'D', is_used: true, used_at: at(-3), expires_at: at(-1), assigned_users: [{ user_id: 'u1', removable: true }] },
      { id: 'e', code: 'E', used_by: 'u2' },
      { id: 'f', code: 'F', is_revoked: true, is_used: true },
      { id: 'g', code: 'G', grant_credits: '1200' },
    ]);
    const state = (code, expiringDays) => codeLedgerState(code, { now, expiringDays });
    assert.deepEqual(state(unused), { state: 'unused', label: 'Chưa dùng', expiringSoon: false });
    assert.deepEqual(state(soon), { state: 'unused', label: 'Chưa dùng', expiringSoon: true });
    assert.equal(state(soon, 7).expiringSoon, false, 'threshold comes from code_expiring_days');
    assert.equal(state(expired).state, 'expired');
    assert.equal(state(expired).label, 'Hết hạn nhập');
    assert.equal(state(used).state, 'used', 'a used code is never reported as expired');
    assert.equal(state(legacyUsed).state, 'used', 'legacy used_by owner still counts');
    assert.equal(state(revoked).state, 'revoked');
    assert.equal(grantCreditsLabel(unused), 'chưa có', 'missing G04 data is shown, never guessed');
    assert.equal(grantCreditsLabel(credited), `${(1200).toLocaleString('vi-VN')} lượt`);
    assert.equal(DEFAULT_CODE_EXPIRING_DAYS, 14);
    assert.equal(expiringDaysFromThresholds({ items: [{ key: 'code_expiring_days', value: 21 }] }), 21);
    assert.equal(expiringDaysFromThresholds({ items: [{ key: 'code_expiring_days', value: null }] }), 14);
    assert.equal(expiringDaysFromThresholds(null), 14);
  });
});

describe('ADMINIA-0074 FR-055 code page and danger-zone revoke', () => {
  const DETAIL_PAGE = read('app', '(authed-admin)/(users)', 'admin', 'activation-codes', '[codeId]', 'page.tsx');
  const DETAIL = read('app', '(authed-admin)/(users)', 'admin', 'activation-codes', '[codeId]', 'admin-activation-code-detail.tsx');

  test('transforms the detail shape explicitly instead of reusing the list shape', () => {
    const detail = normalizeCodeDetail({
      id: 'c4', code: 'OLD', is_used: true, used_by: 'u1', is_revoked: false,
      assignments: [
        { id: null, user_id: 'u1', display_name: 'Alice', email: 'a@x.test', is_active: false, is_fallback_used_by: true, removable: false },
        { id: 'as2', user_id: 'u2', display_name: 'Bob', email: 'b@x.test', is_active: true, assigned_at: '2026-11-01T00:00:00Z' },
        { id: 'as3', user_id: 'u3', display_name: 'Cee', email: 'c@x.test', is_active: false },
      ],
    });
    assert.deepEqual(detail.assigned_users.map((user) => [user.user_id, user.name, user.is_active, user.is_fallback_used_by, user.removable]), [
      ['u1', 'Alice', false, true, false], ['u2', 'Bob', true, false, true], ['u3', 'Cee', false, false, false],
    ]);
    assert.equal(activeAssignmentCount(detail), 1);
    assert.equal(codeLedgerState(detail).state, 'used');
    assert.equal(detail.access_holders, null);
    assert.equal(normalizeCodeDetail(null), null);
    // The danger zone uses the server's list, not a recount of `assignments`.
    const mixed = normalizeCodeDetail({ id: 'm', code: 'MIX', used_by: 'legacy', assignments: [{ user_id: 'u2', is_active: true }],
      access_holders: [{ user_id: 'legacy', email: 'l@x.test' }, { user_id: 'u2', email: 'b@x.test' }, { email: 'no-id' }] });
    assert.deepEqual(mixed.access_holders.map((holder) => holder.user_id), ['legacy', 'u2']);
    assert.match(DETAIL, /const losing = detail\?\.access_holders \?\? \[\];/);
  });

  test('reads the audit history with the revoke reason and the people affected', () => {
    const [entry, bare] = normalizeCodeAudit([
      { id: 7, action: 'revoke', created_at: '2026-11-23T10:00:00Z', after: { reason: 'Mã bị lộ', affected_user_ids: ['u1', 'u2'], source: 'danger_zone' } },
      { id: 'a1', action: 'create', after: null },
      { action: 'edit' },
    ]);
    assert.deepEqual([entry.id, entry.reason, entry.affected_user_count, entry.source], ['7', 'Mã bị lộ', 2, 'danger_zone']);
    assert.deepEqual([bare.reason, bare.affected_user_count], [null, null]);
    assert.equal(auditActionLabel('revoke'), 'Thu hồi mã');
    assert.equal(auditActionLabel('mystery'), 'mystery');
  });

  test('a revoke needs the code retyped and a reason of 10 to 500 characters', () => {
    const draft = { code: 'ABCD-1234', confirmCode: ' abcd-1234 ', reason: 'Học viên đã nghỉ học' };
    assert.equal(revokeUsedDraftError(draft), null);
    assert.equal(revokeUsedDraftError({ ...draft, confirmCode: 'ABCD-123' }), 'Gõ lại đúng mã cần thu hồi.');
    assert.equal(revokeUsedDraftError({ ...draft, code: '', confirmCode: '' }), 'Gõ lại đúng mã cần thu hồi.');
    assert.equal(revokeUsedDraftError({ ...draft, reason: '   ngắn quá  ' }), 'Lý do cần ít nhất 10 ký tự.');
    assert.equal(revokeUsedDraftError({ ...draft, reason: 'x'.repeat(501) }), 'Lý do tối đa 500 ký tự.');
  });

  test('the result message never hides a missing audit row', () => {
    assert.deepEqual(revokeUsedResultMessage({ code: 'A', affected_user_count: 2, audit_recorded: true }), { kind: 'success', text: 'Đã thu hồi mã A. 2 học viên mất quyền từ mã này.' });
    assert.equal(revokeUsedResultMessage({ code: 'A', affected_user_count: 0, audit_recorded: false }).kind, 'error');
    assert.match(revokeUsedResultMessage({ code: 'A', audit_recorded: false }).text, /Chưa ghi được lý do vào nhật ký mã/);
    assert.equal(revokeUsedResultMessage({ code: 'A', already_revoked: true, audit_recorded: true }).text, 'Mã A đã được thu hồi từ trước.');
    assert.equal(revokeUsedResultMessage({ code: 'A', already_revoked: true, audit_recorded: false }).kind, 'error');
  });

  test('the page keeps /new a 404, reloads canonically and offers the danger zone only for a used code', () => {
    assert.match(DETAIL_PAGE, /if \(codeId === 'new'\) notFound\(\);/);
    assert.match(DETAIL_PAGE, /soft 404/);
    assert.match(DETAIL, /window\.api\.post\(`\/admin\/access-codes\/\$\{encodeURIComponent\(detail\.id\)\}\/revoke-used`/);
    assert.match(DETAIL, /reason: reason\.trim\(\),\s+\}\);\s+setConfirmCode\(''\);\s+setReason\(''\);\s+await load\(\);/);
    assert.match(DETAIL, /state\?\.state !== 'used' \?/);
    assert.match(DETAIL, /Vùng nguy hiểm/);
    assert.match(CODES, /href=\{`\/admin\/activation-codes\/\$\{encodeURIComponent\(code\.id\)\}`\}/);
  });
});

describe('ADMINIA-0074 code ledger keeps the admin shell', () => {
  // A route-group move (ADMINGROUP-0077) can leave these pages in a group
  // whose layout was deleted: the page then renders without the admin shell.
  // Under `(authed-admin)` the parent layout owns AuthedShell and the child
  // group layout adds the page sheet, so read every layout from the page up
  // to the shell layout.
  function layoutsUpToShell(pageDir) {
    const sources = [];
    let dir = pageDir;
    while (dir !== join(ROOT, 'app') && dir.startsWith(join(ROOT, 'app'))) {
      const layout = join(dir, 'layout.tsx');
      if (existsSync(layout)) {
        const source = readFileSync(layout, 'utf8');
        sources.push(source);
        if (/<AuthedShell[\s\S]*chrome="admin"/.test(source)) return sources.join('\n');
      }
      dir = dirname(dir);
    }
    return null;
  }

  test('every activation-code page sits under an admin AuthedShell layout that loads the ledger CSS', () => {
    const pages = [
      join(ROOT, 'app', '(authed-admin)', '(users)', 'admin', 'activation-codes'),
      join(ROOT, 'app', '(authed-admin)', '(users)', 'admin', 'activation-codes', '[codeId]'),
    ];
    for (const pageDir of pages) {
      assert.ok(existsSync(join(pageDir, 'page.tsx')), `${pageDir}/page.tsx missing`);
      const layouts = layoutsUpToShell(pageDir);
      assert.ok(layouts, `no admin AuthedShell layout above ${pageDir}`);
      assert.match(layouts, /["']\/css\/admin-users-next\.css["']/);
    }
  });
});
