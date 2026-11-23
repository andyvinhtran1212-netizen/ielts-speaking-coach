// ADMINIA-0074 G09-T23 (FR-080, FR-081, FR-084): model of the Settings page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  SETTINGS_TABS, changeLine, draftsOf, logRow, parseSettingsTab, parseThresholdInput, patchBody,
  retentionWarning, sectionLabel, settingsTabHref, thresholdChanges, thresholdGroups, thresholdMap,
  thresholdSaveError, valueText,
} from '../lib/admin-settings-model.mjs';
import { ADMIN_NAV_GROUPS } from '../lib/admin-nav-registry.mjs';
import { ROUTES } from '../lib/route-registry.mjs';

const row = (key, extra = {}) => ({ key, group: 'Quá hạn xử lý', label: key, anchor: 'mốc', value: 48, unit: 'giờ', min: 1, max: 336, fixed: false, ...extra });

describe('settings tabs (FR-080)', () => {
  it('seven tabs in the sheet order on ?tab=, thresholds the only open one and the fallback', () => {
    assert.deepEqual(SETTINGS_TABS.map((t) => t.id), ['payment', 'email', 'legal', 'features', 'trial', 'notices', 'thresholds']);
    assert.deepEqual(SETTINGS_TABS.filter((t) => !t.pending).map((t) => t.id), ['thresholds']);
    for (const t of SETTINGS_TABS.filter((x) => x.pending)) assert.match(t.pending, /^Chưa mở: /);
    assert.equal(parseSettingsTab(''), 'thresholds');
    assert.equal(parseSettingsTab('tab=bogus'), 'thresholds');
    assert.equal(parseSettingsTab('tab=email'), 'email');
    assert.equal(settingsTabHref('notices'), '/admin/settings?tab=notices');
    assert.equal(sectionLabel('thresholds'), 'Ngưỡng vận hành');
    assert.equal(sectionLabel('other'), 'other');
  });

  it('the sidebar item and the route are live', () => {
    const item = ADMIN_NAV_GROUPS.find((g) => g.id === 'system').items.find((i) => i.id === 'settings');
    assert.equal(item.href, '/admin/settings');
    assert.equal(item.available, true);
    const route = ROUTES.find((r) => r.route === '/admin/settings');
    assert.equal(route.owner, 'app/(authed-admin)/(settings)/admin/settings/page.tsx');
    assert.equal(route.status, 'live');
  });
});

describe('threshold table (FR-081, FR-084)', () => {
  it('groups in API order; null reads "chưa có" on a fixed row and "để trống (tắt)" on an editable one', () => {
    const groups = thresholdGroups([row('a'), row('b', { group: 'Lưu dữ liệu' }), row('c')]);
    assert.deepEqual(groups.map((g) => [g.group, g.rows.map((r) => r.key)]), [['Quá hạn xử lý', ['a', 'c']], ['Lưu dữ liệu', ['b']]]);
    assert.equal(valueText(row('a', { fixed: true, value: null })), 'chưa có');
    assert.equal(valueText(row('a', { value: null })), 'để trống (tắt)');
    assert.equal(valueText(row('a')), '48 giờ');
  });

  it('fields: integers in range, empty sends null for the server to judge', () => {
    assert.deepEqual(parseThresholdInput(row('a'), ' 24 '), { value: 24, error: null });
    assert.deepEqual(parseThresholdInput(row('a'), ''), { value: null, error: null });
    assert.equal(parseThresholdInput(row('a'), '0').error, 'Từ 1 đến 336.');
    assert.equal(parseThresholdInput(row('a'), '4.5').error, 'Chỉ nhập số nguyên, không có chữ hay dấu.');
    assert.equal(parseThresholdInput(row('a'), 'abc').error, 'Chỉ nhập số nguyên, không có chữ hay dấu.');
  });

  it('only changed editable rows are sent, with the reason trimmed', () => {
    const items = [row('a'), row('b'), row('f', { fixed: true, value: 60 })];
    const drafts = { ...draftsOf(items), a: '24', b: 'x' };
    assert.equal('f' in draftsOf(items), false);
    const { changes, errors } = thresholdChanges(items, drafts);
    assert.deepEqual(changes.map((c) => [c.key, c.from, c.to]), [['a', 48, 24]]);
    assert.deepEqual(Object.keys(errors), ['b']);
    assert.equal(changeLine(changes[0]), 'a: 48 giờ → 24 giờ');
    assert.deepEqual(patchBody(changes, '  đợt thi  '), { changes: [{ key: 'a', value: 24 }], reason: 'đợt thi' });
  });

  it('a shorter or emptied retention warns that the deletion cannot be undone; a longer one does not', () => {
    const r = row('keep', { group: 'Lưu dữ liệu', label: 'Giữ báo cáo lỗi nhập liệu', value: 30 });
    assert.match(retentionWarning([{ ...r, from: 30, to: 7, row: r }]), /Giữ báo cáo lỗi nhập liệu.*không lấy lại được/);
    assert.match(retentionWarning([{ ...r, from: 30, to: null, row: r }]), /không lấy lại được/);
    assert.equal(retentionWarning([{ ...r, from: 30, to: 60, row: r }]), null);
    assert.equal(retentionWarning([{ ...row('a'), from: 48, to: 1 }]), null);
  });

  it('a 422 refusal keeps the API sentence and its field; anything else says the outcome is unknown', () => {
    const refused = thresholdSaveError({ code: 'out_of_range', message: 'Phải từ 1 đến 336.', detail: { key: 'a' } });
    assert.deepEqual(refused, { text: 'Chưa lưu: Phải từ 1 đến 336.', key: 'a', refused: true });
    for (const err of [new Error('Network down'), { status: 503, code: 'internal_error', message: 'Lỗi máy chủ.' }, { status: 503, code: 'settings_write_failed', message: 'x' }]) {
      const out = thresholdSaveError(err);
      assert.equal(out.refused, false);
      assert.match(out.text, /^Chưa chắc các ngưỡng đã được lưu/);
      assert.doesNotMatch(out.text, /Không có thay đổi nào được ghi/);
    }
  });

  it('log rows: Vietnam time, unknown actor said, every change old → new', () => {
    const r = logRow({ id: 1, at: '2026-11-23T03:05:00Z', actor_name: null, section: 'thresholds',
      changes: [{ key: 'a', label: 'Yêu cầu chấm lại', old: 72, new: null }], reason: 'x' });
    assert.equal(r.at, '10:05 23/11/2026');
    assert.equal(r.who, 'Không rõ người sửa');
    assert.equal(r.tab, 'Ngưỡng vận hành');
    assert.deepEqual(r.what, ['Yêu cầu chấm lại: 72 → trống']);
    assert.equal(logRow({ at: 'nope', changes: [] }).at, 'không rõ');
  });

  it('thresholdMap gives null for unset values', () => {
    assert.deepEqual(thresholdMap([row('a'), row('b', { value: null })]), { a: 48, b: null });
  });
});

describe('no threshold number in the admin page code (FR-081)', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  it('the Settings page, its model and the provider hold no default value', () => {
    const files = [
      ...walk('frontend/app/(authed-admin)/(settings)'),
      'frontend/lib/admin-settings-model.mjs',
      'frontend/lib/admin-settings-api.ts',
      'frontend/components/admin/thresholds-provider.tsx',
    ];
    for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(24|48|72) ?giờ\b/, f);
  });
});
