/**
 * Class detail — ma trận tiến độ 4 kỹ năng (GĐ 4).
 *
 * What can be wrong here is what a cell MEANS. "—" for a skill whose query
 * failed and "—" for a student who genuinely has not started look identical on
 * screen, and only one of them is true.
 *
 * LEGACYJS-0075 W3b: admin-classes.js is deleted. The progress tab is the
 * `acx-panel-progress` section of
 * app/(authed-admin)/(classes)/admin/classes/[cohortId]/admin-class-detail.tsx;
 * `normalizeProgressPayload` / `latestSkillActivity`
 * (lib/admin-class-detail-model.mjs) are EXECUTED here and `SkillCell` is
 * pinned. The per-student work dialog that replaced the legacy drawer is pinned
 * in admin-class-student-work-next-behavior.test.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { latestSkillActivity, normalizeProgressPayload } from '../lib/admin-class-detail-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'admin-class-detail-next.css'), 'utf8');
const CELL = SRC.slice(SRC.indexOf('function SkillCell'), SRC.indexOf('function EmptyState'));
const PANEL = SRC.slice(SRC.indexOf('<section id="acx-panel-progress"'), SRC.indexOf("{tab === 'lessons' && ("));
const student = (over = {}) => normalizeProgressPayload({ students: [{ student_id: 's1', name: 'An', ...over }] }).students[0];

describe('a skill cell keeps "unknown" apart from "nothing yet"', () => {
  test('a failed (null or missing) skill stays null — it must never read as zero', () => {
    const row = student({ skills: { speaking: null, writing: { attempts: 0 } } });
    assert.equal(row.skills.speaking, null);
    assert.equal(row.skills.reading, null, 'an absent skill is unknown, not empty');
    assert.equal(row.skills.writing.attempts, 0);
    assert.match(CELL, /if \(value == null\) return <span className="acd-unknown">Không đọc được<\/span>;/);
  });
  test('genuinely nothing yet is its own state', () => {
    assert.match(CELL, /if \(!value\.attempts\) return <span className="acd-muted">Chưa có lượt<\/span>;/);
  });
  test('attempts show with the last real band, or the count alone', () => {
    assert.match(CELL, /<strong>\{value\.attempts\.toLocaleString\('vi-VN'\)\} lượt<\/strong>\{value\.last_band != null && <span>Band \{value\.last_band\}<\/span>\}/);
  });
  test('the server field names are read as sent (`recent_bands`, `target_band`)', () => {
    const row = student({ target_band: 6.5, skills: { speaking: { attempts: 3, last_band: 6, recent_bands: [5, null, 7] } } });
    assert.equal(row.target_band, 6.5);
    assert.deepEqual(row.skills.speaking.recent_bands, [5, 7], 'a missing band is dropped, not read as weak');
  });
});

describe('last activity is the newest across all four skills', () => {
  test('picks the latest stamp; a failed skill or bad stamp does not break the scan', () => {
    assert.equal(latestSkillActivity({
      speaking: { last_activity: '2026-08-01T00:00:00Z' }, writing: null,
      reading: { last_activity: 'not-a-date' }, listening: { last_activity: '2026-08-03T00:00:00Z' },
    }), '2026-08-03T00:00:00Z');
  });
  test('nothing anywhere yields nothing', () => {
    assert.equal(latestSkillActivity({ speaking: null }), null);
  });
});

describe('the tab reports failure instead of an empty class', () => {
  test('a failed load shows an error with a wired retry; a stale table is labelled', () => {
    assert.match(PANEL, /<strong>Không đọc được tiến độ mới nhất<\/strong>/);
    assert.match(PANEL, /progress \? ' Bảng dưới đây là ảnh chụp lần tải trước\.' : ''/);
    assert.match(PANEL, /onClick=\{\(\) => void loadProgress\(\)\}[^>]*>Thử lại<\/button>/);
  });
  test('loads lazily on first open of the tab', () => {
    assert.match(SRC, /if \(tab === 'progress' && progress == null && !progressLoading && !progressError\) void loadProgress\(\);/);
  });
  test('Tiến độ is a first-level tab beside Sổ điểm danh, Buổi học and Bài tập', () => {
    assert.match(SRC, /\['progress', 'Tiến độ 4 kỹ năng', 'Nhịp học và nộp đúng hạn'\]/);
    assert.match(SRC, /role="tab" aria-controls=\{tab === value \? `acx-panel-\$\{value\}` : undefined\}/);
  });
  test('every row opens the student work dialog through a real button', () => {
    assert.match(PANEL, /openStudentWork\(\{ student_id: row\.student_id,[^}]*\}\); \}\} disabled=\{busy\}>Xem bài<\/button>/);
  });
});

describe('a roster change invalidates the cached progress (Codex review)', () => {
  test('invalidation bumps the request id, clears stale rows and reloads an open tab', () => {
    const fn = SRC.slice(SRC.indexOf('const invalidateProgress = () => {'), SRC.indexOf('};', SRC.indexOf('const invalidateProgress = () => {')));
    assert.match(fn, /progressSequence\.current \+= 1;\s*setProgress\(null\);/);
    assert.match(fn, /if \(tab === 'progress'\) void loadProgress\(\);/);
  });
  test('adding, removing and homework mutations all invalidate', () => {
    assert.match(SRC, /setMemberPicker\(false\); setSelectedStudent\(''\); invalidateProgress\(\);/);
    assert.match(SRC, /const canonical = await loadOverview\(true\);\s*invalidateProgress\(\);/);
    assert.match(SRC, /onMutation=\{\(\) => \{ setHomeworkRefreshKey\(\(value\) => value \+ 1\); invalidateProgress\(\); \}\}/);
  });
  test('a late response from before the change cannot overwrite', () => {
    assert.match(SRC, /const requestId = \+\+progressSequence\.current;/);
    assert.match(SRC, /if \(requestId !== progressSequence\.current\) return false;/);
  });
});

describe('% nộp đúng hạn keeps "unknown" apart from "always late"', () => {
  test('a failed ledger read stays null; nothing handed in is not 0%', () => {
    assert.equal(student({ homework: null }).homework, null);
    assert.equal(student({ homework: { assigned: 2, on_time_pct: null } }).homework.on_time_pct, null);
    assert.match(PANEL, /row\.homework == null \? <span className="acd-unknown">Không đọc được<\/span> : row\.homework\.on_time_pct == null \? <span className="acd-muted">Chưa có bài nộp<\/span>/);
  });
  test('a rate shows, with overdue work flagged beside it', () => {
    assert.match(PANEL, /<strong>\{row\.homework\.on_time_pct\}%<\/strong>\{row\.homework\.missing > 0 && <span>\{row\.homework\.missing\} chưa nộp<\/span>\}/);
    assert.match(PANEL, /<th>Nộp đúng hạn<\/th>/);
  });
});

describe('progress banner', () => {
  test('a stale homework column says stale, never the raw flag or a skill name', () => {
    const m = /progress\.degraded\.includes\('homework_stale'\) && '([^']+)'/.exec(PANEL);
    assert.ok(m, 'stale sentence missing');
    assert.match(m[1], /chưa cập nhật/);
    for (const word of [/homework_stale/, /Reading/, /Listening/, /Speaking/, /theo buổi/]) assert.doesNotMatch(m[1], word);
  });
  test('failed skills are named, separately from the stale sentence', () => {
    assert.match(PANEL, /progress\.degraded\.filter\(\(item\) => item !== 'homework_stale'\)\.length > 0 && `Không đọc được: /);
  });
});

describe('dải ô band', () => {
  test('keeps the LAST 8 bands, highlights only those below the learner\'s OWN target', () => {
    assert.match(CELL, /const recentBands = value\.recent_bands\.slice\(-8\);/);
    assert.match(CELL, /const belowTarget = target == null \? 0 : recentBands\.filter\(\(band\) => band < target\)\.length;/);
    assert.match(CELL, /className=\{target != null && band < target \? 'is-below' : ''\}/);
  });
  test('the strip is one labelled image for screen readers, and says when no target is set', () => {
    assert.match(CELL, /<span className="acx-band-strip" role="img" aria-label=\{`Các band gần đây: \$\{recentBands\.join\(', '\)\}\.\$\{target == null \? ' Chưa đặt band mục tiêu\.' : /);
  });
  test('below-target is not colour alone: a text count sits beside it', () => {
    assert.match(CELL, /\{target != null && belowTarget > 0 && <small className="acx-below-target">\{belowTarget\} dưới mục tiêu \{target\}<\/small>\}/);
  });
  test('strip colours come from design tokens', () => {
    assert.match(CSS, /\.acx-band-strip i \{[^}]*background: var\(--av-success\)/);
    assert.match(CSS, /\.acx-band-strip i\.is-below \{ background: var\(--av-warning\); \}/);
  });
});
