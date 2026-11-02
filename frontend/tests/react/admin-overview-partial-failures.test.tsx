import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PC-J216: GET /admin/overview returns 200 with 0 for a block whose read
// failed and names the block in `partial_failures` (PR #1963). The page must
// show which tiles did not load instead of a silent 0.
const api = vi.hoisted(() => ({
  getAdminDashboardOverview: vi.fn(),
  getAdminDashboardTrends: vi.fn(),
  getAdminContentOverview: vi.fn(),
}));

vi.mock('client-only', () => ({}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('pane=content') }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));
vi.mock('@/lib/admin-overview-api', () => api);
vi.mock('@/app/(authed-admin-overview)/admin/admin-ai-panel', () => ({ AdminAiPanel: () => null }));

import { AdminOverview, PARTIAL_FAILURE_COPY } from '@/app/(authed-admin-overview)/admin/admin-overview';

function overview(extra: Record<string, unknown> = {}) {
  return {
    students: { total: 40, active_7d: 12, active_30d: 25, by_cohort: [] },
    skills: {
      speaking: { sessions_total: 0, sessions_7d: 0, avg_band_7d: null },
      writing: { essays_total: 31, essays_7d: 4, feedback_pending: 2 },
      listening: { attempts_total: 9, attempts_7d: 3, content_count: 5, avg_score_7d: 0.5, dictation_total: 1, dictation_7d: 1 },
      reading: { attempts_total: 8, attempts_7d: 2, avg_score_7d: 0.75 },
      vocab: { words_total: 100, due_review_today: 10 },
      grammar: { articles_viewed_7d: 6 },
    },
    errors: { undismissed: 3, last_24h: 1, last_7d: 3 },
    access_codes: { active: 7, by_type: { mass: 5, direct: 1, staff: 1 } },
    recent_activity: [],
    generated_at: '2026-10-30T00:00:00Z',
    ...extra,
  };
}

function skillCard(name: string) {
  const card = document.querySelector(`.admin-hub-card[data-skill="${name}"]`);
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

function statNum(card: HTMLElement, label: string) {
  const labelNode = within(card).getAllByText(label).find((node) => node.classList.contains('stat-label'));
  expect(labelNode).toBeDefined();
  return labelNode!.parentElement!.querySelector('.stat-num') as HTMLElement;
}

function tileValue(label: string) {
  const tile = screen.getByText(label, { selector: '.stat-tile .label' }).closest('.stat-tile') as HTMLElement;
  return { tile, value: tile.querySelector('.value') as HTMLElement };
}

async function renderWith(payload: unknown) {
  api.getAdminContentOverview.mockResolvedValue(payload);
  render(<AdminOverview />);
  await waitFor(() => expect(skillCard('writing').querySelector('.stat-num')?.textContent).toBe('4'));
}

beforeEach(() => {
  api.getAdminDashboardOverview.mockResolvedValue({});
  api.getAdminDashboardTrends.mockResolvedValue({ series: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('admin overview partial_failures', () => {
  it('marks the failed Speaking tiles and lists them in a status banner', async () => {
    await renderWith(overview({ partial_failures: ['sessions_recent', 'sessions_total'] }));

    const banner = screen.getByTestId('partial-failures');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toBe('⚠ Một số số liệu chưa tải được: Speaking 7 ngày, Speaking Band TB, Đang hoạt động (7 ngày), Hoạt động 30 ngày, Hoạt động gần đây, Speaking tổng. Các mục này đang tạm ẩn số; hãy tải lại trang sau ít phút.');
    expect(banner.textContent).toContain('Speaking 7 ngày');
    expect(banner.textContent).toContain('Speaking tổng');
    expect(banner.textContent).toContain('Speaking Band TB');
    expect(banner.textContent).toContain('Hoạt động gần đây');

    const speaking = skillCard('speaking');
    for (const label of ['7 ngày', 'Tổng', 'Band TB']) {
      const cell = statNum(speaking, label);
      expect(cell.textContent).toContain('—');
      expect(cell.textContent).toContain(PARTIAL_FAILURE_COPY.unavailable);
      expect(cell.textContent).not.toMatch(/\b0\b/);
      expect(cell.querySelector('[title="Chưa tải được"]')).not.toBeNull();
    }

    const writing = skillCard('writing');
    expect(statNum(writing, '7 ngày').textContent).toBe('4');
    expect(statNum(writing, 'Tổng').textContent).toBe('31');
    expect(statNum(writing, 'Chưa trả kết quả').textContent).toBe('2');

    // sessions_recent feeds the active-student counts; the roster total does not.
    expect(tileValue('Tổng học viên').value.textContent).toBe('40');
    expect(tileValue('Đang hoạt động (7 ngày)').value.textContent).toContain(PARTIAL_FAILURE_COPY.unavailable);
    expect(screen.getByText(PARTIAL_FAILURE_COPY.activityUnavailable)).toBeTruthy();
    expect(api.getAdminContentOverview).toHaveBeenCalledTimes(1);
  });

  it('renders no banner and plain numbers when partial_failures is empty', async () => {
    await renderWith(overview({ partial_failures: [] }));
    expect(screen.queryByTestId('partial-failures')).toBeNull();
    expect(document.querySelector('[data-unavailable]')).toBeNull();
    expect(statNum(skillCard('speaking'), 'Tổng').textContent).toBe('0');
    expect(screen.getByText('Chưa có hoạt động nào trong 30 ngày qua.')).toBeTruthy();
  });

  it('renders no banner for an older backend without the field', async () => {
    await renderWith(overview());
    expect(screen.queryByTestId('partial-failures')).toBeNull();
    expect(document.querySelector('[data-unavailable]')).toBeNull();
  });

  it('does not flag the errors tile as a warning from a fallback value', async () => {
    await renderWith(overview({
      errors: { undismissed: 5, last_24h: 2, last_7d: 5 },
      partial_failures: ['errors_undismissed'],
    }));
    const { tile, value } = tileValue('Lỗi chưa xử lý');
    expect(value.textContent).toContain('—');
    expect(value.textContent).toContain(PARTIAL_FAILURE_COPY.unavailable);
    expect(value.textContent).not.toContain('5');
    expect(tile.classList.contains('is-warning')).toBe(false);
    expect(tile.querySelector('.delta')?.textContent).toBe('2 trong 24h qua');
  });

  it('lists an unknown block by its raw name', async () => {
    await renderWith(overview({ partial_failures: ['brand_new_block'] }));
    expect(screen.getByTestId('partial-failures').textContent).toBe('⚠ Một số số liệu chưa tải được: brand_new_block. Các mục này đang tạm ẩn số; hãy tải lại trang sau ít phút.');
    expect(document.querySelector('[data-unavailable]')).toBeNull();
  });
});
