import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminSpeakingPage from '@/app/(authed-admin-speaking)/admin/speaking/page';
import { AdminWritingTips } from '@/app/(authed-admin-writing-tips)/admin/writing/tips/admin-writing-tips';

vi.mock('@/components/admin-access-gate', () => ({
  AdminAccessGate: ({ children }: { children: ReactNode }) => children,
  useAdminProfile: () => ({ id: 'operator' }),
}));
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => params }));
let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  get = vi.fn(); post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch: post, delete: post, upload: post } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('identifies each Speaking operation while retaining destinations and system ownership information', () => {
  const { container } = render(<AdminSpeakingPage />);
  const expected = [
    ['/admin/speaking/sessions', 'KIỂM BÀI'],
    ['/admin/speaking/topics', 'BIÊN TẬP'],
    ['/admin/system', 'THEO DÕI'],
  ];
  for (const [href, label] of expected) expect(container.querySelector(`a[href="${href}"] .adm-status-pill`)?.textContent).toBe(label);
  expect(screen.queryByText('NATIVE', { exact: true })).toBeNull();
  expect(screen.getByText(/Sessions và Topics đều chạy native/)).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('explains invalid Writing tips data while retaining its actual diagnostic count and warning', async () => {
  const valid = { id: 'tip-1', title: 'Valid tip', slug: 'valid-tip', body_markdown: 'Body', task_type: 'task_2', content_type: 'tip', category: 'ideas', published: true, display_order: 0, type_data: {}, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' };
  get.mockResolvedValue({ tips: [valid, { id: 'invalid-data' }] });
  render(<AdminWritingTips />);
  await screen.findByRole('heading', { name: 'Valid tip', exact: true });
  const overview = within(screen.getByRole('region', { name: 'Tổng quan thư viện' }));
  const diagnostic = overview.getByText('Dòng không hợp lệ').parentElement!;
  expect(within(diagnostic).getByText('1', { exact: true })).toBeTruthy();
  expect(within(diagnostic).getByText('dòng bị loại')).toBeTruthy();
  expect(screen.getByText('1 dòng dữ liệu không hợp lệ chưa hiển thị.')).toBeTruthy();
  expect(screen.queryByText('Contract', { exact: true })).toBeNull();
  expect(get).toHaveBeenCalledWith('/admin/writing/tips?limit=500');
  expect(post).not.toHaveBeenCalled();
});
