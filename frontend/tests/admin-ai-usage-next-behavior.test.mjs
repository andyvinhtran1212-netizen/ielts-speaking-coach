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
    overall: { calls: 3, cost_usd: 0.125, by_service: { claude: { calls: 2, cost_usd: 0.1 }, custom: { calls: 1, cost_usd: 0.025 } } },
    per_user: [{ user_id: 'u1', email: 'a@example.com', display_name: 'An', calls: 3, cost_usd: 0.125, by_service: { claude: { calls: 2, cost_usd: 0.1 }, custom: { calls: 1, cost_usd: 0.025 } } }],
    meta: { query_limit: 10000, returned_rows: 10000, total_matching_rows: 12000, truncated: true },
  });

  test('keeps unknown services and cap metadata', () => {
    assert.ok(payload);
    assert.deepEqual(serviceRows(payload.overall.services).map(([name]) => name), ['claude', 'custom']);
    assert.match(coverageMessage(payload.meta), /ít nhất 10\.000/);
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
