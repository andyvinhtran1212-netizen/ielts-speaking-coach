import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SessionResultBehavior } from '@/app/(authed-session-result)/result/session-result-behavior';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'u1' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=s1'),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const api = vi.hoisted(() => ({ session: null as any }));
vi.mock('@/lib/session-api', () => ({
  getSessionDetail: async () => api.session,
  getSessionAudioUrls: async () => [],
}));

const ESTIMATE = 'Band ước tính: do AI chấm, không phải điểm thi IELTS chính thức.';
const LOW = 'Âm thanh ghi âm có chất lượng hạn chế — điểm số và nhận xét lần này chỉ mang tính tham khảo. '
  + 'Hãy thử ghi âm lại ở nơi yên tĩnh hơn hoặc nói to và rõ hơn để nhận được đánh giá chính xác hơn.';

const practiceResponse = (id: string, feedback: Record<string, unknown>, extra = {}) => ({
  id: `r-${id}`,
  question_id: id,
  grading_status: 'completed',
  feedback: { grammar_issues: [], vocabulary_issues: [], ...feedback },
  ...extra,
});

const session = (responses: unknown[], extra = {}) => ({
  id: 's1',
  status: 'completed',
  part: 1,
  topic: 'Hometown',
  mode: 'practice',
  overall_band: 6,
  questions: responses.map((_, index) => ({ id: `q${index + 1}`, question_text: `Q${index + 1}` })),
  responses,
  ...extra,
});

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { base: '', getWith: vi.fn(async () => []), get: vi.fn(async () => []), post: vi.fn() },
  });
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({ auth: { getSession: async () => ({ data: { session: { user: auth.user } } }) } }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('renders the ranked fixes as a labelled ordered list after the AI band and its estimate label', async () => {
  api.session = session([
    practiceResponse('q1', {
      grammar_issues: ['Sai thì quá khứ'],
      corrections: [{ original: 'I go', corrected: 'I went', explanation: 'Quá khứ đơn' }],
    }),
    practiceResponse('q2', {
      corrections: [{ original: 'I go', corrected: 'I went', explanation: 'Quá khứ đơn' }],
    }),
  ]);
  render(<SessionResultBehavior />);

  const region = await screen.findByRole('region', { name: '2 việc cần sửa trước' });
  const items = within(within(region).getByRole('list')).getAllByRole('listitem');
  expect(region.querySelector('ol')).not.toBeNull();
  expect(items.map((item) => item.textContent)).toEqual([
    'I go → I went (gặp ở 2 câu)Quá khứ đơn',
    'Sai thì quá khứ',
  ]);

  const estimate = screen.getByText(ESTIMATE);
  const bandLabel = screen.getByText('Overall Band Score');
  expect(screen.getByText('Band tổng quan')).toBeTruthy();
  expect(bandLabel.compareDocumentPosition(estimate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(estimate.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const strengths = screen.getByRole('heading', { name: 'Điểm mạnh' });
  expect(region.compareDocumentPosition(strengths) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  expect(screen.queryByText(LOW)).toBeNull();
});

it('hides the fixes block when there is nothing to fix, and shows the low-confidence banner', async () => {
  api.session = session([
    practiceResponse('q1', { strengths: ['Phát âm rõ'] }, { score_confidence: 'medium' }),
    practiceResponse('q2', { strengths: ['Trôi chảy'] }, { score_confidence: 'low' }),
  ]);
  render(<SessionResultBehavior />);

  const banner = (await screen.findByText(LOW)).closest('[role="status"]');
  expect(banner).not.toBeNull();
  expect(screen.getByText(ESTIMATE)).toBeTruthy();
  expect(screen.queryByText(/việc cần sửa trước/)).toBeNull();
});

it('a sealed (teacher-graded mock) session shows neither the estimate label nor fixes', async () => {
  api.session = session(
    [practiceResponse('q1', { grammar_issues: ['Sai thì'] }, { score_confidence: 'low' })],
    { results_sealed: true },
  );
  render(<SessionResultBehavior />);

  await screen.findByText('Kết quả chưa được công bố');
  expect(screen.queryByText(ESTIMATE)).toBeNull();
  expect(screen.queryByText(/việc cần sửa trước/)).toBeNull();
  expect(screen.queryByText(LOW)).toBeNull();
});

it('the teacher-graded Mock result page never labels its band as an AI estimate', () => {
  const source = readFileSync(resolve(
    process.cwd(),
    'app/(authed-speaking-result)/speaking/result/speaking-result-behavior.tsx',
  ), 'utf8');
  expect(source).not.toMatch(/ước tính/);
});
