import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminGrammarArticles } from '@/app/(authed-admin-grammar-articles)/admin/grammar/articles/admin-grammar-articles';
import { AdminListeningAudit } from '@/app/(authed-admin-listening)/admin/listening/audit/admin-listening-audit';
import { AdminVocabEditorial } from '@/app/(authed-admin-vocab)/admin/vocab/curated/admin-vocab-editorial';
import { AdminVocabPilotMetrics } from '@/app/(authed-admin-vocab)/admin/vocab/pilot-metrics/admin-vocab-pilot-metrics';

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => navigation.params, useRouter: () => navigation }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const article = (slug = 'past-perfect') => ({
  slug, title: slug === 'past-perfect' ? 'Past Perfect' : 'Past Simple', category: 'tenses', summary: 'Published article',
  band: 7, view_count: 12, save_count: null, source_path: `backend/content/tenses/${slug}.md`,
});
const articles = { total: 2, available_total: 2, categories: ['tenses'], analytics_status: { views: 'complete', saves: 'unavailable' }, items: [article(), article('past-simple')] };
const inventoryRow = (id: string) => ({
  id, test_id: `LIS-${id}`, title: `Listening ${id}`, status: 'published', test_type: 'full', exam_only: false,
  section_count: 4, audio_ready_count: 4, accent_profile: [], band_target: 7,
  created_at: '2026-08-14T00:00:00Z', updated_at: '2026-08-14T01:00:00Z',
});
const audit = (id: string) => ({
  uuid: id, test_id: `LIS-${id}`, title: `Listening ${id}`, status: 'published', test_type: 'full', question_count: 40, section_count: 4,
  live: { issues: [{ q_num: 1, dimension: 'audio', severity: 'warning', code: 'audio_bounds', message: 'Check bounds', resolved: false }], health: { error_count: 0, warning_count: 1, status: 'passed' } }, saved: null,
});
const unavailable = () => Object.assign(new Error('Service unavailable'), { status: 503, detail: { error_code: 'feature_unavailable', feature: 'vocab_curated', message: 'Chưa xác minh được schema Curated.' } });
const delayed = { eligible_unit_starts: 0, assessed_unit_starts: 0, attempts: 0, transfer_attempts: 0, followup_rate_percent: null, accuracy_percent: null, transfer_success_percent: null };
const metrics = {
  period_days: 90, computed_at: '2026-08-27T00:00:00+00:00', cohort: { enabled_users: 12, learners_started: 4, unit_starts: 7 },
  runtime_flags: { vocab_units_read: true, vocab_unit_attempts_write: true, vocab_unit_recommendations: false, vocab_ai_scoring: false },
  immediate: { eligible_unit_starts: 6, completed_unit_starts: 5, attempts: 24, completion_rate_percent: 83.3, accuracy_percent: 75 }, day7: delayed, day28: delayed,
  recommendations: { created: 3, opened: 1, completed: 0, dismissed: 0, open_rate_percent: 33.3, completion_rate_percent: 0 }, units: [],
};

function installApi(get: ReturnType<typeof vi.fn>) {
  const api = { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  Object.defineProperty(window, 'api', { configurable: true, value: api });
  return api;
}
function summaryValues() { return Array.from(screen.getByRole('region', { name: 'Tổng quan audit' }).querySelectorAll('strong'), (node) => node.textContent); }

describe('Grammar preview identity, content and retry', () => {
  it('distinguishes a body-less summary from wrong identity and replaces a failed cache on retry', async () => {
    const get = vi.fn().mockResolvedValueOnce(articles).mockResolvedValueOnce(article()).mockResolvedValueOnce({ slug: 'past-perfect', html: '<h1>Past Perfect</h1>' });
    installApi(get); render(<AdminGrammarArticles />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem trước' }))[0]);
    expect(await screen.findByText(/thiếu nội dung HTML/)).toBeTruthy();
    expect(screen.queryByTitle('Preview Past Perfect')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại xem trước' }));
    const frame = await screen.findByTitle<HTMLIFrameElement>('Preview Past Perfect');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Past Perfect</h1>');
    expect(get.mock.calls.filter(([url]) => url.includes('/preview'))).toHaveLength(2);
  });

  it('retains the identity guard and retries after closing/reopening a failed preview', async () => {
    const get = vi.fn().mockResolvedValueOnce(articles).mockResolvedValueOnce({ slug: 'past-simple', html: '<h1>Wrong</h1>' }).mockResolvedValueOnce({ slug: 'past-perfect', html: '<h1>Correct</h1>' });
    installApi(get); render(<AdminGrammarArticles />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem trước' }))[0]);
    expect(await screen.findByText(/Preview không đúng bài đang chọn/)).toBeTruthy();
    expect(screen.queryByTitle('Preview Past Perfect')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Xem trước' })[0]);
    expect((await screen.findByTitle('Preview Past Perfect')).getAttribute('srcdoc')).toContain('Correct');
  });

  it('ignores a preview response from the previous refreshed list', async () => {
    let resolveOld!: (value: unknown) => void;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const get = vi.fn().mockResolvedValueOnce(articles).mockReturnValueOnce(old).mockResolvedValueOnce(articles).mockResolvedValueOnce({ slug: 'past-perfect', html: '<h1>Current</h1>' });
    installApi(get); render(<AdminGrammarArticles />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem trước' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem trước' }))[0]);
    expect((await screen.findByTitle('Preview Past Perfect')).getAttribute('srcdoc')).toContain('Current');
    await act(async () => { resolveOld({ slug: 'past-perfect', html: '<h1>Obsolete</h1>' }); });
    await waitFor(() => expect(screen.getByTitle('Preview Past Perfect').getAttribute('srcdoc')).toContain('Current'));
  });
});

describe('Listening complete inventory truth', () => {
  it.each([
    { scenario: 'concurrent insertion increases total', nextTotal: 202, duplicate: false },
    { scenario: 'total decreases during paging', nextTotal: 200, duplicate: false },
    { scenario: 'concurrent insertion shifts offset while total stays fixed', nextTotal: 201, duplicate: true },
  ])('G-U09 rejects $scenario without presenting a partial inventory as complete', async ({ nextTotal, duplicate }) => {
    const rows = Array.from({ length: 201 }, (_, index) => inventoryRow(`owned-${String(index).padStart(3, '0')}`));
    const original = JSON.stringify(rows);
    // Equal timestamps cross the 100/101 boundary. A new first-row insertion
    // shifts the old page boundary; a simultaneous old-row deletion can keep
    // total unchanged, so UUID overlap must also prevent publishing a snapshot.
    const first = rows.slice(0, 100);
    const second = rows.slice(duplicate ? 99 : 100, duplicate ? 199 : 200);
    const get = vi.fn().mockResolvedValueOnce({ items: first, total: 201, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ items: second, total: nextTotal, limit: 100, offset: 100 });
    const api = installApi(get); render(<AdminListeningAudit />);
    await screen.findByText(duplicate ? /lặp giữa các page/ : /Tổng test thay đổi trong lúc phân trang/);
    expect(screen.getByText('Không hoàn tất')).toBeTruthy();
    expect(screen.getByText('Inventory chưa khép kín')).toBeTruthy();
    expect(screen.getByText('Chưa có snapshot inventory hoàn tất')).toBeTruthy();
    expect(summaryValues()).toEqual(['—', '—', '—', '—']);
    expect(screen.queryByText('Đã đọc đủ inventory')).toBeNull();
    expect(screen.queryByText('Kho test đang trống')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Bảng quality audit Listening' })).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(new URL(get.mock.calls[1][0], 'https://fixture.test').searchParams.get('offset')).toBe('100');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).toBe(original);
  });
  it('rejects duplicate UUIDs at page boundaries without scanning or reporting zero health', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => inventoryRow(String(index)));
    const get = vi.fn().mockResolvedValueOnce({ items: rows, total: 101, limit: 100, offset: 0 }).mockResolvedValueOnce({ items: [rows[0]], total: 101, limit: 100, offset: 100 });
    const api = installApi(get); render(<AdminListeningAudit />);
    expect(await screen.findByText(/lặp giữa các page/)).toBeTruthy();
    expect(summaryValues()).toEqual(['—', '—', '—', '—']);
    expect(screen.getByText('Không hoàn tất')).toBeTruthy();
    expect(screen.queryByText('Kho test đang trống')).toBeNull();
    expect(screen.queryByText('Đang đọc từ backend…')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps a completed snapshot and marks it stale when inventory refresh fails', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [inventoryRow('1')], total: 1, limit: 100, offset: 0 }).mockResolvedValueOnce(audit('1')).mockRejectedValueOnce(new Error('Network failure'));
    installApi(get); render(<AdminListeningAudit />);
    expect(await screen.findByText('1 cảnh báo')).toBeTruthy();
    expect(summaryValues()).toEqual(['1', '0', '1', '0']);
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới toàn bộ' }));
    expect(await screen.findByText(/Không thể làm mới — đang giữ snapshot trước/)).toBeTruthy();
    expect(summaryValues()).toEqual(['1', '0', '1', '0']);
    expect(screen.getByText(/Snapshot trước · chưa làm mới được/)).toBeTruthy();
    expect(screen.getAllByText('Theo snapshot trước')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'LIS-1' })).toBeTruthy();
  });

  it('reports an empty inventory only after canonical total zero, including stale empty snapshots', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [], total: 0, limit: 100, offset: 0 }).mockRejectedValueOnce(new Error('Network failure'));
    installApi(get); render(<AdminListeningAudit />);
    expect(await screen.findByText('Kho test đang trống')).toBeTruthy();
    expect(summaryValues()).toEqual(['0', '0', '0', '0']);
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới toàn bộ' }));
    expect(await screen.findByText(/Không thể làm mới — đang giữ snapshot trước/)).toBeTruthy();
    expect(screen.getByText(/Snapshot trước · chưa làm mới được/)).toBeTruthy();
    expect(summaryValues()).toEqual(['0', '0', '0', '0']);
  });
});

describe('Curated and pilot unavailable/error/empty states', () => {
  it('G-U08 recovers a generic network error into populated unit/version/diff without content writes', async () => {
    // Same canonical schema and diff fields as admin-vocab-editorial-model.
    const gate = { states: { language: 'approved', pedagogy: 'pending', assessment: 'changes_requested' }, pending_review_types: ['pedagogy', 'assessment'], has_distinct_reviewers: false, reviews_ready: false };
    const baseTask = { id: 'task-1', version_id: 'version-1', sequence: 1, task_type: 'meaning_recall', dimension: 'meaning_recall', prompt: 'Cũ', options: [], answer_key: { accepted: ['a'] }, explanation_vi: 'A', status: 'active' };
    const base = { id: 'version-1', version_number: 1, status: 'published', content: { title_vi: 'Cũ', usage_vi: 'Giữ nguyên' }, sources: [{ title: 'A', url: 'https://example.com/a' }], tasks: [baseTask], reviews: [], review_gate: gate };
    const target = { ...base, id: 'version-2', version_number: 2, status: 'in_review', content: { title_vi: 'Mới', usage_vi: 'Giữ nguyên' }, sources: [{ title: 'B', url: 'https://example.com/b' }], tasks: [{ ...baseTask, id: 'task-2', version_id: 'version-2', answer_key: { accepted: ['b'] } }] };
    const unit = { id: 'unit-1', unit_slug: 'have-an-impact-on', display_headword: 'have an impact on', unit_type: 'learning_unit', target_level: 'B1', status: 'draft', current_published_version_id: 'version-1', versions: [target, base].map(version => ({ id: version.id, unit_id: 'unit-1', version_number: version.version_number, status: version.status, task_count: 1, dimensions: ['meaning_recall'], review_count: 0, review_gate: gate })) };
    const catalog = { items: [unit], total: 1, offset: 0, limit: 100 };
    const detail = { unit, versions: [target, base], events: [], events_total: 0, events_has_more: false };
    const original = JSON.stringify({ catalog, detail });
    const get = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(catalog).mockResolvedValueOnce(detail);
    const api = installApi(get); render(<AdminVocabEditorial />);
    expect(await screen.findByText('Không đọc được catalog')).toBeTruthy();
    expect(screen.getByText(/Failed to fetch/)).toBeTruthy();
    expect(screen.queryByText('Curated Editorial chưa khả dụng')).toBeNull();
    expect(screen.queryByText('Không có unit phù hợp.')).toBeNull();
    expect(screen.queryByText('0 unit toàn catalog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại catalog' }));
    await screen.findByRole('heading', { name: 'Mới', exact: true });
    expect(screen.getByText('1 unit toàn catalog')).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Version' }).value).toBe('version-2');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish version', exact: true }).disabled).toBe(true);
    expect(screen.getAllByText('Đánh giá · Cần sửa')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Diff (3)', exact: true }));
    expect(screen.getByRole('heading', { name: 'v1 → v2' })).toBeTruthy();
    for (const field of ['content.title_vi', 'sources', 'tasks']) expect(screen.getByRole('heading', { name: field, exact: true })).toBeTruthy();
    expect(screen.getByText('"Cũ"', { exact: true })).toBeTruthy();
    expect(screen.getByText('"Mới"', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'content.usage_vi', exact: true })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: 'version-1' } });
    expect(screen.getByRole('heading', { name: 'Version đầu tiên · v1' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'v1 → v2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
    expect(screen.getByRole('heading', { name: 'Cũ', exact: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'A', exact: true }).getAttribute('href')).toBe('https://example.com/a');
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenLastCalledWith('/admin/vocabulary/editorial/units/unit-1');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
    expect(JSON.stringify({ catalog, detail })).toBe(original);
  });
  it('reports schema unavailability without zero catalog claims and retries into a genuinely empty catalog', async () => {
    const get = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 100 });
    installApi(get); render(<AdminVocabEditorial />);
    expect(await screen.findByText('Curated Editorial chưa khả dụng')).toBeTruthy();
    expect(screen.queryByText('Không có unit phù hợp.')).toBeNull();
    expect(screen.queryByText('0 unit toàn catalog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại catalog' }));
    expect(await screen.findByText('Không có unit phù hợp.')).toBeTruthy();
    expect(screen.getByText('0 unit toàn catalog')).toBeTruthy();
  });

  it('keeps transport failure distinct from capability unavailable and from successful catalog/detail failure', async () => {
    const gate = { states: { language: 'pending', pedagogy: 'pending', assessment: 'pending' }, pending_review_types: ['language', 'pedagogy', 'assessment'], has_distinct_reviewers: false, reviews_ready: false };
    const unit = { id: 'unit-1', unit_slug: 'impact', display_headword: 'impact', unit_type: 'learning_unit', target_level: 'B1', status: 'draft', current_published_version_id: null, versions: [{ id: 'version-1', unit_id: 'unit-1', version_number: 1, status: 'in_review', task_count: 4, dimensions: ['meaning_recall'], review_count: 0, review_gate: gate }] };
    const get = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Gateway failure'), { status: 503 })).mockResolvedValueOnce({ items: [unit], total: 1, offset: 0, limit: 100 }).mockRejectedValueOnce(new Error('Detail failure'));
    installApi(get); render(<AdminVocabEditorial />);
    expect(await screen.findByText('Không đọc được catalog')).toBeTruthy();
    expect(screen.queryByText('Curated Editorial chưa khả dụng')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại catalog' }));
    expect(await screen.findByText('Không đọc được nội dung unit đã chọn. Chọn lại unit để thử lại.')).toBeTruthy();
    expect(screen.getByText('1 unit toàn catalog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /impact/ })).toBeTruthy();
    expect(screen.queryByText('Không có unit phù hợp.')).toBeNull();
  });

  it('blocks pilot cohort actions until a successful metrics read and preserves null delayed outcomes', async () => {
    const get = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(metrics);
    const api = installApi(get); render(<AdminVocabPilotMetrics />);
    expect(await screen.findByText('Pilot Metrics chưa khả dụng trên môi trường này')).toBeTruthy();
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Thêm vào pilot' });
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'Rút khỏi pilot' });
    expect(add.disabled).toBe(true); expect(remove.disabled).toBe(true);
    fireEvent.click(add); expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Rollout gates' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại số liệu' }));
    const gates = await screen.findByRole('region', { name: 'Rollout gates' });
    expect(within(gates).getByText('12')).toBeTruthy();
    expect(add.disabled).toBe(false); expect(remove.disabled).toBe(false);
    expect(screen.getAllByText('Chưa đủ dữ liệu').length).toBeGreaterThan(0);
    expect(api.post).not.toHaveBeenCalled();
  });
});
