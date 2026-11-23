// G09-T41 (ADMINIA-0074 FR-164): Báo cáo page model.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityReport, aiCostReport, csvFileName, footTrafficQuery, formatCell, liveAdminHref,
  parseReportsQuery, rangeDays, rangeText, reportCsv, reportsHref, trafficReport,
} from '../lib/admin-reports-model.mjs';
import { ADMIN_NAV_GROUPS, adminNavMatch } from '../lib/admin-nav-registry.mjs';

const NOW = new Date('2026-11-23T03:00:00Z'); // 10:00 in Vietnam

const overview = (extra = {}) => ({
  students: { total: 40, active_7d: 12, active_30d: 25, by_cohort: [
    { cohort_id: 'c1', cohort_name: 'Lớp Tue–Thu 19:30', count: 14 },
    { cohort_id: null, cohort_name: null, count: 6 },
  ] },
  skills: {
    speaking: { sessions_total: 300, sessions_7d: 18, avg_band_7d: 6 },
    writing: { essays_total: 120, essays_7d: 9, feedback_pending: 3 },
    listening: { attempts_total: 80, attempts_7d: 0, content_count: 10, avg_score_7d: null, dictation_total: 5, dictation_7d: 1 },
    reading: { attempts_total: 60, attempts_7d: 4, avg_score_7d: 0.7 },
    vocab: { words_total: 1, due_review_today: 0 },
    grammar: { articles_viewed_7d: 0 },
  },
  errors: { undismissed: 0, last_24h: 0, last_7d: 0 },
  access_codes: { active: 1, by_type: { mass: 1, direct: 0, staff: 0 } },
  recent_activity: [],
  generated_at: '2026-11-23T03:00:00Z',
  partial_failures: [],
  ...extra,
});

describe('report URL state', () => {
  it('defaults to Hoạt động and 30 days, and drops unknown values', () => {
    assert.deepEqual(parseReportsQuery(''), { tab: 'hoat-dong', range: 30 });
    assert.deepEqual(parseReportsQuery('?tab=chi-phi-ai&range=90'), { tab: 'chi-phi-ai', range: 90 });
    assert.deepEqual(parseReportsQuery('tab=doanh-thu&range=365'), { tab: 'hoat-dong', range: 30 });
    assert.equal(reportsHref({ tab: 'luu-luong', range: 7 }), '/admin/reports?tab=luu-luong&range=7');
  });

  it('the four sidebar items open their own tab of /admin/reports', () => {
    const items = ADMIN_NAV_GROUPS.find((g) => g.id === 'reports').items;
    assert.deepEqual(items.map((i) => [i.href, i.available]), [
      ['/admin/reports?tab=hoat-dong', true],
      ['/admin/reports?tab=luu-luong', true],
      ['/admin/reports?tab=chi-phi-ai', true],
      ['/admin/reports?tab=chat-luong', true],
    ]);
    for (const item of items) {
      const [path, query] = item.href.split('?');
      assert.deepEqual(adminNavMatch(path, `?${query}`), { groupId: 'reports', itemId: item.id });
    }
  });

  it('maps the range onto the APIs and names the window in Vietnam time', () => {
    assert.deepEqual(rangeDays(7, NOW), { from: '2026-11-17', to: '2026-11-23' });
    assert.equal(footTrafficQuery(30, NOW).toString(), 'date_from=2026-10-25&date_to=2026-11-23');
    assert.equal(rangeText(7, NOW), '7 ngày gần nhất · 17/11/2026 – 23/11/2026');
    assert.equal(csvFileName('chi-phi-ai', 7, NOW), 'bao-cao-chi-phi-ai-2026-11-17-2026-11-23.csv');
  });

  it('links only to live pages', () => {
    assert.equal(liveAdminHref('/admin/usage'), '/admin/usage');
    assert.equal(liveAdminHref('/admin/learners'), null);
  });
});

describe('Hoạt động học viên', () => {
  it('reads the window that matches the range; 90 days says "chưa có" with the reason', () => {
    const tile = (range) => activityReport(overview(), range).tiles.find((t) => t.id === 'active');
    assert.equal(tile(7).value, 12);
    assert.equal(tile(30).value, 25);
    assert.equal(tile(90).value, null);
    assert.match(tile(90).reason, /7 và 30 ngày/);
  });

  it('a failed source block is "chưa có", never 0', () => {
    const out = activityReport(overview({ partial_failures: ['sessions_recent', 'essays_pending'] }), 7);
    assert.equal(out.tiles.find((t) => t.id === 'active').value, null);
    assert.equal(out.tiles.find((t) => t.id === 'pending').value, null);
    const speaking = out.tables[0].rows.find((r) => r[0].startsWith('Speaking'));
    assert.deepEqual(speaking, ['Speaking · phiên', null, 300]);
    // A real zero from a block that was read stays 0.
    assert.deepEqual(out.tables[0].rows.find((r) => r[0].startsWith('Listening')), ['Listening · lượt', 0, 80]);
  });

  it('lists learners per class, and drops the table when the class list failed', () => {
    const out = activityReport(overview(), 30);
    assert.deepEqual(out.tables[1].rows, [['Lớp Tue–Thu 19:30', 14], ['Chưa vào lớp', 6]]);
    const failed = activityReport(overview({ partial_failures: ['cohorts'] }), 30);
    assert.equal(failed.tables.length, 1);
    assert.match(failed.cohortsReason, /không đọc được/);
    assert.equal(activityReport({ nope: 1 }, 30), null);
  });
});

const traffic = (extra = {}) => ({
  date_from: '2026-11-17T00:00:00+00:00', date_to: '2026-11-23T23:59:59.999999+00:00', route: null,
  snapshot_to: '2026-11-23T02:59:55+00:00', effective_to: '2026-11-23T02:59:55+00:00',
  data_status: 'complete', total_views: 50, unique_visitors: 20, anonymous_hits: 8,
  top_pages: [{ path: '/', views: 30 }, { path: '/grammar', views: 20 }],
  daily: [{ date: '2026-11-18', views: 20 }, { date: '2026-11-20', views: 30 }],
  truncated: false, ...extra,
});

describe('Lưu lượng', () => {
  it('a complete read fills days without views with a real 0', () => {
    const out = trafficReport(traffic(), 7, NOW);
    const daily = out.tables[0].rows;
    assert.equal(daily.length, 7);
    assert.deepEqual(daily[0], ['17/11/2026', 0]);
    assert.deepEqual(daily[1], ['18/11/2026', 20]);
    assert.deepEqual(out.tables[1].rows[0], ['/', 30, 0.6]);
  });

  it('a partial read leaves missing days empty and marks totals as minimums', () => {
    const out = trafficReport(traffic({ data_status: 'partial', truncated: true }), 7, NOW);
    assert.equal(out.partial, true);
    assert.deepEqual(out.tables[0].rows[0], ['17/11/2026', null]);
    assert.equal(out.tiles[0].atLeast, true);
  });

  it('unavailable carries no number at all', () => {
    const out = trafficReport(traffic({ data_status: 'unavailable', total_views: null, unique_visitors: null, anonymous_hits: null, top_pages: [], daily: [] }), 7, NOW);
    assert.deepEqual([out.status, out.tiles, out.tables], ['unavailable', [], []]);
  });
});

const usage = (extra = {}) => ({
  overall: {
    calls: 10, priced_calls: 8, unpriced_calls: 2, failed_calls: 1, legacy_repriced_calls: 0, cost_usd: 1.5,
    by_service: { gemini: { calls: 2, cost_usd: 0.3 }, claude: { calls: 8, cost_usd: 1.2 }, whisper: { calls: 0, cost_usd: 0 } },
  },
  per_user: [],
  meta: { query_limit: 10000, returned_rows: 10, total_matching_rows: 10, truncated: false },
  ...extra,
});

describe('Chi phí AI', () => {
  it('cost, calls, unpriced and failed calls, and a service table without 0/0', () => {
    const out = aiCostReport(usage());
    assert.deepEqual(out.tiles.map((t) => [t.id, t.value]), [['cost', 1.5], ['calls', 10], ['unpriced', 2], ['failed', 1]]);
    assert.match(out.tiles[0].note, /không gồm lượt gọi chưa có chi phí đơn vị/);
    const round = (v) => (v == null ? v : Math.round(v * 1e6) / 1e6);
    assert.deepEqual(out.tables[0].rows.map((r) => r.map((c) => (typeof c === 'number' ? round(c) : c))), [
      ['Claude', 8, 1.2, 0.15, 0.8],
      ['Gemini', 2, 0.3, 0.15, 0.2],
      ['Whisper', 0, 0, null, 0],
    ]);
  });

  it('a capped read marks totals as minimums; a foreign shape is null', () => {
    assert.equal(aiCostReport(usage({ meta: { query_limit: 10, returned_rows: 10, truncated: true } })).truncated, true);
    assert.equal(aiCostReport({ overall: {} }), null);
  });
});

describe('formatting and CSV', () => {
  it('CSV: a text cell that starts like a formula is neutralised, numbers stay numbers', () => {
    const report = activityReport(overview({ students: { ...overview().students, by_cohort: [
      { cohort_id: 'c1', cohort_name: '=HYPERLINK("https://x.test","bấm")', count: 3 },
      { cohort_id: 'c2', cohort_name: '+cmd|calc', count: 4 },
      { cohort_id: 'c3', cohort_name: '-1+2', count: 5 },
      { cohort_id: 'c4', cohort_name: '@SUM(A1)', count: 6 },
      { cohort_id: 'c5', cohort_name: 'Lớp Tue–Thu 19:30', count: 7 },
    ] } }), 30);
    const lines = reportCsv(report.tables.filter((t) => t.id === 'cohorts')).split('\r\n');
    assert.deepEqual(lines.slice(2, 7), [
      `"'=HYPERLINK(""https://x.test"",""bấm"")",3`,
      "'+cmd|calc,4",
      "'-1+2,5",
      "'@SUM(A1),6",
      'Lớp Tue–Thu 19:30,7',
    ]);
    const money = reportCsv([{ title: 'T', columns: [{ label: 'A', kind: 'text' }, { label: 'B', kind: 'usd' }, { label: 'C', kind: 'pct' }, { label: 'D', kind: 'count' }], rows: [['x', 1.5, 0.25, 0]] }]);
    assert.equal(money.split('\r\n')[2], 'x,1.50,25.0,0');
  });

  it('UI: US$ with two digits, "chưa có" for a missing number', () => {
    assert.equal(formatCell(1.5, 'usd'), '1,50 US$');
    assert.equal(formatCell(null, 'count'), 'chưa có');
    assert.equal(formatCell(0.6, 'pct'), '60%');
  });

  it('CSV: one block per table, dot decimals, two-digit US$, empty cell for no data', () => {
    const csv = reportCsv([
      { title: 'Hình 7 · Chi phí AI theo dịch vụ', columns: [{ label: 'Dịch vụ', kind: 'text' }, { label: 'Chi phí US$', kind: 'usd' }], rows: [['Claude', 1.2], ['Gemini, Flash', null]] },
      { title: 'Hình 3', columns: [{ label: 'Ngày', kind: 'text' }, { label: 'Lượt xem', kind: 'count' }], rows: [['17/11/2026', 0]] },
    ]);
    assert.equal(csv, 'Hình 7 · Chi phí AI theo dịch vụ\r\nDịch vụ,Chi phí US$\r\nClaude,1.20\r\n"Gemini, Flash",\r\n\r\nHình 3\r\nNgày,Lượt xem\r\n17/11/2026,0\r\n');
  });
});
