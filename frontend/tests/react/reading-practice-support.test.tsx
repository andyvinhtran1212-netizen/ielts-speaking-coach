import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingDetail } from '@/app/(authed-reading)/reading/reading-detail';
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'practice-owner' } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('from=skill&skill=detail&batches=2&q=colour') }));
const packet = JSON.parse(readFileSync('../backend/content/reading-practice/20261014-repairs.json', 'utf8'));
const commons = packet.passages.find((row: any) => row.slug === 'the-tragedy-of-the-commons');
const contextIllustration = { src: '/reading-illustrations/commons-review.svg', alt: 'A shared pasture', caption: 'Several herders share the pasture.' };
let fixture: any, post: any;
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => DOMPurify.sanitize(marked.parse(text) as string) });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  fixture = { id: commons.passage_id, slug: commons.slug, title: 'Commons', body_markdown: commons.source_body_markdown,
    glossary: commons.changes.glossary, translation_vi: commons.changes.metadata.translation_vi,
    practice_support: { ...commons.changes.metadata.practice_support, illustrations: [contextIllustration] },
    questions: [{ q_num: 1, question_type: 'mcq_multi', prompt: 'Choose TWO.', payload: { options: ['A','B','C','D','E'].map((label) => ({ label, text: `Option ${label}` })) } }] };
  post = vi.fn(async () => ({ results: [{ q_num: 1, correct: true, expected: 'A, C', evidence: { ...commons.changes.metadata.practice_support.question_evidence['1'], source_sha256: commons.source_sha256 } }] }));
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn(async () => fixture), post, postWith: vi.fn(async () => ({ links: [] })) } });
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as Selection);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('shows a shared cover and authored illustration once, retaining its caption and zoom', async () => {
  const figure = fixture.practice_support.illustrations[0];
  fixture.image_url = figure.src;
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  await screen.findByRole('button', { name: 'Dịch câu 2' });
  expect([...view.container.querySelectorAll('#rv-panel-original img')].filter((image) => image.getAttribute('src') === figure.src)).toHaveLength(1);
  expect(screen.getByText(figure.caption)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `Phóng to: ${figure.alt}` }));
  expect(within(screen.getByRole('dialog')).getByRole('img').getAttribute('src')).toBe(figure.src);
});
it('keeps a distinct cover chart alongside authored illustrations and supports keyboard zoom', async () => {
  fixture.image_url = '/reading-illustrations/distinct-chart.svg';
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  await screen.findByRole('button', { name: 'Dịch câu 2' });
  expect(view.container.querySelectorAll('#rv-panel-original img')).toHaveLength(fixture.practice_support.illustrations.length + 1);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Commons', exact: true }), { key: 'Enter' });
  expect(within(screen.getByRole('dialog')).getByRole('img').getAttribute('src')).toBe(fixture.image_url);
});
it.each(['missing', 'stale'])('keeps the cover when practice illustrations are %s', async (revision) => {
  fixture.image_url = fixture.practice_support.illustrations[0].src;
  if (revision === 'missing') fixture.practice_support = null;
  else fixture.body_markdown += '\n\nA changed ending.';
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  await screen.findByRole('button', { name: 'Định nghĩa: deplete' });
  expect(view.container.querySelectorAll('#rv-panel-original img')).toHaveLength(1);
  expect(view.container.querySelector('.rp-figure')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Commons', exact: true }));
  expect(within(screen.getByRole('dialog')).getByRole('img').getAttribute('src')).toBe(fixture.image_url);
});
it('reveals an authored sentence and highlights exact equivalents in both directions', async () => {
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dịch câu 2' }));
  const panel = await screen.findByRole('region', { name: 'Dịch câu 2' });
  fireEvent.click(within(panel).getByRole('button', { name: 'tài nguyên chung tương ứng với commons' }));
  expect(within(panel).getByRole('status').textContent).toContain('commons ↔ tài nguyên chung');
  expect(view.container.querySelector('.rp-source-phrase.is-highlighted')?.textContent).toBe('commons');
  fireEvent.click(within(panel).getByRole('button', { name: 'graze their cattle', exact: true }));
  expect([...view.container.querySelectorAll('.rp-source-phrase.is-highlighted')].map((node) => node.textContent).join('').replace(/\s+/g, ' ')).toBe('graze their cattle');
  expect(within(panel).getByRole('button', { name: 'cho gia súc của mình ăn cỏ tương ứng với graze their cattle' }).getAttribute('aria-pressed')).toBe('true');
  expect(view.container.querySelector('.rv-passage__body strong, .rv-passage__body em')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Skill Practice/ }).getAttribute('href')).toBe('/reading/skill?skill=detail&q=colour&batches=2');
});
it('preserves selection and prioritises inflected glossary lookup', async () => {
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  await screen.findByRole('button', { name: 'Dịch câu 3' });
  vi.mocked(window.getSelection).mockReturnValue({ toString: () => 'depleted' } as Selection);
  fireEvent.click(view.container.querySelector('[data-unit-id="p1-s3"]')!);
  expect(screen.queryByRole('region', { name: 'Dịch câu 3' })).toBeNull();
  vi.mocked(window.getSelection).mockReturnValue({ toString: () => '' } as Selection);
  const lookup = screen.getByRole('button', { name: 'Định nghĩa: deplete' });
  expect(lookup.textContent).toBe('depleted');
  lookup.focus(); fireEvent.click(lookup);
  expect(screen.getByRole('dialog').textContent).toContain('làm cạn kiệt');
  expect(screen.queryByRole('region', { name: 'Dịch câu 3' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(lookup);
});
it('keeps source visible in full translation and rejects stale sentence mappings', async () => {
  fixture.body_markdown += '\n\nA changed ending.';
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  await screen.findByText(/liên kết theo câu đang được biên soạn/);
  expect(screen.queryByRole('button', { name: 'Dịch câu 2' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Bài dịch' }));
  expect(view.container.querySelector('#rv-panel-original')?.hasAttribute('hidden')).toBe(false);
  expect(view.container.querySelector('#rv-panel-translation')?.hasAttribute('hidden')).toBe(false);
  expect(view.container.querySelector('.rv-passage__body')?.textContent).toContain('A changed ending.');
});
it('checks the full selection, retries failure, locates only the checked evidence and returns to the question', async () => {
  post.mockRejectedValueOnce(new Error('offline'));
  const view = render(<ReadingDetail library="skill" slug={commons.slug} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'A. Option A' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'C. Option C' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra', exact: true }));
  await screen.findByRole('alert');
  expect(screen.getByRole('checkbox', { name: 'C. Option C' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem căn cứ trong bài' }));
  await waitFor(() => expect(view.container.querySelector('.rp-evidence')?.textContent?.replace(/\s+/g, ' ')).toContain('Each herder reasons'));
  expect(post.mock.calls[1][1]).toEqual({ answers: [{ q_num: 1, user_answer: 'A, C' }] });
  expect(screen.getByRole('checkbox', { name: 'C. Option C' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Trở lại câu 1' }));
  expect(document.activeElement?.id).toBe('rq-card-1');
});
it('displays matching options and preserves a noncontiguous authored question number', async () => {
  fixture.questions = [{ q_num: 7, question_type: 'matching_sentence_endings', prompt: 'Magellan’s surviving crew …', payload: { options: [{ label: 'i', text: 'a different option' }, { label: 'ii', text: 'completed the first voyage around the globe.' }] } }];
  render(<ReadingDetail library="skill" slug={commons.slug} />);
  const select = await screen.findByRole('combobox', { name: 'Câu 7' });
  fireEvent.change(select, { target: { value: 'ii' } }); expect((select as HTMLSelectElement).value).toBe('ii');
  expect(screen.getByText('7. Magellan’s surviving crew …')).toBeTruthy();
});
