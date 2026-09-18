import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageMessage, formatCount, formatUsd, normalizeAiUsagePayload, serviceRows } from '../lib/admin-ai-usage-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-system)', 'admin', 'system', 'ai-usage', 'admin-ai-usage.tsx');
const PAGE = read('app', '(authed-admin-system)', 'admin', 'system', 'ai-usage', 'page.tsx');
const HUB = read('app', '(authed-admin-system)', 'admin', 'system', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-system)', 'layout.tsx');

describe('/admin/system/ai-usage native contract', () => {
  test('owns the route, admin gate and canonical read without mutations', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(CLIENT, /window\.api\.get<unknown>\(path\)/);
    assert.match(CLIENT, /\/admin\/ai-usage/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|put|patch|delete)/);
    assert.match(HUB, /href="\/admin\/system\/ai-usage"/);
    assert.match(LAYOUT, /admin-ai-usage-next\.css/);
  });
});

describe('AI usage payload truth', () => {
  const payload = normalizeAiUsagePayload({
    overall: { calls: 3, priced_calls: 2, unpriced_calls: 1, failed_calls: 0, legacy_repriced_calls: 2, cost_usd: 0.125, by_service: { claude: { calls: 2, priced_calls: 2, unpriced_calls: 0, cost_usd: 0.1 }, custom: { calls: 1, priced_calls: 0, unpriced_calls: 1, cost_usd: 0.025 } } },
    per_user: [{ user_id: 'u1', email: 'a@example.com', display_name: 'An', calls: 3, cost_usd: 0.125, by_service: { claude: { calls: 2, cost_usd: 0.1 }, custom: { calls: 1, cost_usd: 0.025 } } }],
    meta: { query_limit: 10000, returned_rows: 10000, total_matching_rows: 12000, truncated: true, ledger_returned_rows: 9996, ledger_total_matching_rows: 11996, ledger_truncated: true, ledger_schema_legacy: false, supplemental_writing_rows: 4, writing_source_returned_rows: 4, writing_source_total_rows: 4, writing_source_truncated: false, writing_lookup_failed: false },
  });

  test('keeps unknown services and cap metadata', () => {
    assert.ok(payload);
    assert.deepEqual(serviceRows(payload.overall.services).map(([name]) => name), ['claude', 'custom']);
    assert.match(coverageMessage(payload.meta), /ít nhất 10\.000/);
    assert.equal(payload.overall.unpricedCalls, 1);
    assert.equal(payload.overall.legacyRepricedCalls, 2);
    assert.equal(payload.meta.supplementalWritingRows, 4);
    assert.equal(payload.meta.writingLookupFailed, false);
    assert.equal(payload.meta.ledgerReturnedRows, 9996);
    assert.equal(payload.meta.writingSourceTruncated, false);
    assert.match(CLIENT, /Không đọc được log Writing lịch sử/);
    assert.match(CLIENT, /Đã bổ sung/);
    assert.match(CLIENT, /migration 284/);
    assert.match(CLIENT, /Nguồn Writing lịch sử/);
  });

  test('rejects malformed top-level values instead of inventing zero', () => {
    assert.equal(normalizeAiUsagePayload({ overall: {}, per_user: [], meta: {} }), null);
    assert.equal(formatUsd(null), '—');
    assert.equal(formatCount('bad'), '—');
  });

  test('keeps all-time distinct from the seven-day default in the URL contract', () => {
    assert.match(CLIENT, /\['all', 'Tất cả'\]/);
    assert.match(CLIENT, /period === 'all' \? ''/);
    assert.match(CLIENT, /url\.searchParams\.set\('days', next\)/);
    assert.match(CLIENT, /url\.search\}\$\{url\.hash\}/);
  });
});
