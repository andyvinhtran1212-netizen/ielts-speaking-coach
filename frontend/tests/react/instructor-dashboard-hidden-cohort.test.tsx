import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InstructorDashboard } from '@/app/(authed-instructor)/instructor/instructor-dashboard';

// PC-J215: with staging test-data hiding on, /instructor/cohorts drops QA
// classes while students and codes keep their cohort_id, flagged
// cohort_hidden. Those rows say "Lớp đã ẩn"; a class id the backend does not
// know at all still says "Lớp không xác định".
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'inst-1' } }) }));
vi.mock('@/lib/auth-api', () => ({ getAuthorizationIdentity: async () => ({ id: 'inst-1', role: 'instructor', email: 'teacher@example.com' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const dashboardData: Record<string, unknown> = {
  '/instructor/cohorts': [{ id: 'k-real', name: 'Lớp 10A', created_at: null }],
  '/instructor/students': [
    { id: 's-qa', full_name: 'Học viên lớp ẩn', student_code: 'HV01', cohort_id: 'k-qa', cohort_hidden: true, user_id: 'u1' },
    { id: 's-real', full_name: 'Học viên lớp thật', student_code: 'HV02', cohort_id: 'k-real', cohort_hidden: false, user_id: 'u2' },
    { id: 's-gone', full_name: 'Học viên lớp mất', student_code: 'HV03', cohort_id: 'k-gone', cohort_hidden: false, user_id: null },
    { id: 's-none', full_name: 'Học viên chưa xếp lớp', student_code: 'HV04', cohort_id: null, cohort_hidden: false, user_id: null },
  ],
  '/instructor/prompts': [],
  '/instructor/codes': [
    { id: 'c-qa', code: 'CODEQA', is_used: false, cohort_id: 'k-qa', cohort_hidden: true },
    { id: 'c-gone', code: 'CODEGONE', is_used: true, cohort_id: 'k-gone', cohort_hidden: false },
  ],
  '/instructor/assignments': [],
  '/instructor/reviews/queue': [],
};

beforeEach(() => {
  const get = vi.fn(async (path: string) => dashboardData[path]);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn(), patch: vi.fn() } });
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: { SECTION_KEYS: {}, SECTION_RENDERERS: {} } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const classCell = (rowText: string) => {
  const row = screen.getByText(rowText).closest('tr')!;
  return within(row).getAllByRole('cell')[2].textContent;
};

it('the Học viên tab labels a hidden class "Lớp đã ẩn" and a missing one "Lớp không xác định"', async () => {
  render(<InstructorDashboard />);
  expect(await screen.findByText('Học viên lớp ẩn')).toBeTruthy();
  expect(classCell('Học viên lớp ẩn')).toBe('Lớp đã ẩn');
  expect(classCell('Học viên lớp thật')).toBe('Lớp 10A');
  expect(classCell('Học viên lớp mất')).toBe('Lớp không xác định');
  expect(classCell('Học viên chưa xếp lớp')).toBe('—');
});

it('the Lớp & Mã tab labels codes the same way', async () => {
  render(<InstructorDashboard />);
  expect(await screen.findByText('Học viên lớp ẩn')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Lớp & Mã/ }));
  expect(classCell('CODEQA')).toBe('Lớp đã ẩn');
  expect(classCell('CODEGONE')).toBe('Lớp không xác định');
});
