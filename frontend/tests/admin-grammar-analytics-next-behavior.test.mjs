import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatGrammarAnalyticsMetric,
  grammarAnalyticsArticleHref,
  normalizeGrammarAnalyticsDays,
  normalizeGrammarAnalyticsPayload,
} from '../lib/admin-grammar-analytics-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-grammar-analytics)', 'admin', 'grammar', 'analytics', 'page.tsx');
const CLIENT = read('app', '(authed-admin-grammar-analytics)', 'admin', 'grammar', 'analytics', 'admin-grammar-analytics.tsx');
const LAYOUT = read('app', '(authed-admin-grammar-analytics)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-grammar-analytics-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-grammar)', 'admin', 'grammar', 'page.tsx');
const LEGACY_HUB = read('public', 'pages', 'admin', 'grammar', 'index.html');
const LEGACY_CLIENT = read('public', 'js', 'admin-grammar-analytics.js');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const complete = {
  days: 14, articles_total: 3, views_total: 12, active_view_records_recent: 2,
  saves_total: 4, zero_view_total: 1,
  top_viewed: [{ slug: 'past-perfect', title: 'Past Perfect', category: 'tenses', count: 12 }],
  top_saved: [{ slug: 'past-perfect', title: 'Past Perfect', category: 'tenses', count: 4 }],
  zero_view_slugs: [{ slug: 'modals', title: 'Modals', category: 'verbs', count: 0 }],
  analytics_status: { views: 'complete', recent_activity: 'complete', saves: 'complete' },
  recent_activity_basis: 'user_article_records_with_last_viewed_at_in_window',
};

describe('/admin/grammar/analytics native ownership', () => {
  test('uses the canonical admin gate and preserves rollback', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="analytics"/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'grammar', 'analytics.html')));
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/grammar\/analytics['"]/);
  });

  test('normal navigation targets the clean native route', () => {
    assert.match(CHROME, /slug: 'analytics'[^\n]+href: '\/admin\/grammar\/analytics'/);
    assert.ok(HUB.includes("href: '/admin/grammar/analytics'"));
    assert.match(LEGACY_HUB, /href="\/admin\/grammar\/analytics"/);
  });

  test('pins truthful read-only and stale-response behavior', () => {
    assert.doesNotMatch(CLIENT, /window\.api\.(post|patch|delete|upload)/);
    assert.match(CLIENT, /requestId === sequence\.current/);
    assert.match(CLIENT, /không phải số lượt xem phát sinh theo ngày/);
    assert.match(CLIENT, /Dấu — không có nghĩa là 0/);
    assert.match(LEGACY_CLIENT, /requestId !== loadSequence/);
    assert.match(LEGACY_CLIENT, /không đồng nghĩa với 0/);
    assert.match(LEGACY_CLIENT, /'top-empty'\)\.textContent = EMPTY_COPY\.top/);
    assert.match(LEGACY_CLIENT, /'saved-empty'\)\.textContent = EMPTY_COPY\.saved/);
    assert.match(LEGACY_CLIENT, /'zero-empty'\)\.textContent = EMPTY_COPY\.zero/);
  });

  test('records route ownership and responsive CI coverage', () => {
    assert.match(LEDGER, /`\/admin\/grammar\/analytics`[^\n]+authed-admin-grammar-analytics[^\n]+recent activity/);
    assert.match(CSS, /@media\(max-width:680px\)/);
    assert.match(CSS, /@media\(max-width:430px\)/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-grammar-analytics/);
    assert.match(WORKFLOW, /verify-admin-grammar-analytics-flow\.mjs/);
  });
});

describe('grammar analytics contract', () => {
  test('normalizes complete values and clean article URLs', () => {
    const result = normalizeGrammarAnalyticsPayload(complete);
    assert.equal(result.viewsTotal, 12);
    assert.equal(result.activeRecordsRecent, 2);
    assert.equal(grammarAnalyticsArticleHref(result.topViewed[0]), '/grammar/tenses/past-perfect');
    assert.equal(formatGrammarAnalyticsMetric(1205), '1.205');
  });

  test('preserves unknown sources and rejects contradictions', () => {
    const unavailable = normalizeGrammarAnalyticsPayload({ ...complete, views_total: null, zero_view_total: null, top_viewed: null, zero_view_slugs: null, analytics_status: { ...complete.analytics_status, views: 'unavailable' } });
    assert.equal(unavailable.viewsTotal, null);
    assert.equal(formatGrammarAnalyticsMetric(unavailable.viewsTotal), '—');
    assert.equal(normalizeGrammarAnalyticsPayload({ ...complete, views_total: 0, top_viewed: null, zero_view_slugs: null, zero_view_total: null, analytics_status: { ...complete.analytics_status, views: 'unavailable' } }), null);
    assert.equal(normalizeGrammarAnalyticsPayload({ ...complete, recent_activity_basis: 'event_views' }), null);
  });

  test('normalizes URL windows to supported values', () => {
    assert.equal(normalizeGrammarAnalyticsDays('30'), 30);
    assert.equal(normalizeGrammarAnalyticsDays('31'), 7);
    assert.equal(normalizeGrammarAnalyticsDays('garbage'), 7);
  });
});
