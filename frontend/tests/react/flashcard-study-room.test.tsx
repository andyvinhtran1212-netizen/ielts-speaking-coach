// EXAMDRILL-0073 T001 (G08-T20): flashcards in the practice room behind the
// 'drill' flag. Real FlashcardStudyPlayer and model; transport, auth and
// navigation are synthetic.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlashcardStudyPlayer } from '@/app/(flashcard-study)/flashcard-study/flashcard-study-player';
import { drillSourceLabel } from '@/app/(flashcard-study)/flashcard-study/flashcard-study-room';

const scope = vi.hoisted(() => ({ user: { id: 'learner-a' } as { id: string } | null, status: 'signed-in' }));
vi.mock('@/styles/av2/fonts', () => ({ av2FontClass: 'av2-font-test' }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: scope.status, user: scope.user }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const personal = {
  stack_id: 'auto:due',
  cards: [
    { id: CARD_A, headword: 'resilient', definition_vi: 'kiên cường', example_sentence: 'She is resilient.', source_type: 'needs_review', review: null },
    { id: CARD_B, headword: 'mitigate', definition_vi: 'giảm nhẹ', source_type: 'grammar_lab_internal', review: null },
  ],
};
const wiki = {
  category: 'environment',
  cards: [
    { slug: 'emission', headword: 'emission', definition_vi: 'khí thải', collocations: ['carbon emission'], synonyms: ['discharge'], antonyms: [], memory_hook: 'e-mission', common_error: 'emition' },
    { slug: 'habitat', headword: 'habitat', definition_vi: 'môi trường sống', collocations: [], synonyms: [], antonyms: [] },
  ],
};
const receipt = (id: string) => ({ vocab_id: id, status: 'success', replayed: false, interval_days: 1, ease_factor: 2.5, review_count: 1, next_review_at: '2026-11-24T00:00:00Z' });

let reviewResponse: (id: string) => Response;
let reviews: { id: string; body: any }[];
let location: { href: string; assign: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn>; pathname: string; search: string };

function setFlag(on: boolean) {
  (window as any).__AVER_RUNTIME_CONFIG__ = { environment: 'staging', examRoomSurfaces: on ? ['drill'] : [] };
}
function openStack(stack: string) {
  location = { href: `https://app.invalid/flashcard-study?stack=${stack}`, assign: vi.fn(), replace: vi.fn(), pathname: '/flashcard-study', search: `?stack=${encodeURIComponent(stack)}` };
  vi.stubGlobal('location', location);
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  scope.user = { id: 'learner-a' }; scope.status = 'signed-in';
  setFlag(true);
  openStack('auto:due');
  reviews = [];
  reviewResponse = (id) => new Response(JSON.stringify(receipt(id)), { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const review = /\/api\/flashcards\/([^/]+)\/review$/.exec(url);
    if (review) { reviews.push({ id: review[1], body: JSON.parse(String(init?.body)) }); return reviewResponse(review[1]); }
    if (url.includes('/api/flashcards/stacks/')) return new Response(JSON.stringify(personal));
    if (url.includes('/api/vocabulary/categories/')) return new Response(JSON.stringify(wiki));
    return new Response('{}', { status: 404 });
  }));
  Object.assign(window, {
    getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: scope.user ? { access_token: 'tok-1', user: { id: scope.user.id } } : null } }) } }),
    api: { base: 'https://synthetic.invalid' },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).__AVER_RUNTIME_CONFIG__; });

const rate = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }) as HTMLButtonElement;

describe('flag on: personal stack', () => {
  it('rates only after the card was turned, by button or number key', async () => {
    const view = render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    expect(view.container.querySelector('[data-exam-room]')?.getAttribute('data-surface')).toBe('drill');
    // CR #2597: the room sits in the av2 root with the font variables (LegacyRoomRoot).
    expect(view.container.querySelector('[data-exam-room]')?.closest('.av2-root.av2-font-test[data-legacy-room-root]')).not.toBeNull();
    expect(screen.getByText('Lật thẻ để chấm mức nhớ.')).toBeTruthy();
    for (const name of ['Quên', 'Khó', 'Tốt', 'Dễ']) expect(rate(name).disabled).toBe(true);
    fireEvent.click(rate('Tốt'));
    fireEvent.keyDown(document.body, { key: '3' });
    await act(async () => {});
    expect(reviews).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    expect(screen.queryByText('Lật thẻ để chấm mức nhớ.')).toBeNull();
    // FR-015: the turn is announced politely.
    expect(screen.getByText('Mặt sau của thẻ resilient').getAttribute('aria-live')).toBe('polite');
    // Turning back to the front does not lock rating again.
    fireEvent.click(screen.getByRole('button', { name: 'Xem mặt từ' }));
    expect(rate('Tốt').disabled).toBe(false);
    fireEvent.click(rate('Tốt'));
    await screen.findByText(/Thẻ 2 trên 2/);
    expect(reviews).toEqual([{ id: CARD_A, body: { rating: 'good', client_review_id: expect.any(String) } }]);
    // The next card starts on its front, rating locked.
    expect(screen.getByRole('button', { name: 'Lật thẻ' })).toBeTruthy();
    expect(rate('Dễ').disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: '4' });
    await screen.findByText(/Xong bộ thẻ: 2 thẻ/);
    expect(reviews.map((r) => r.body.rating)).toEqual(['good', 'easy']);
    expect(screen.getByText('Tốt').closest('div')?.textContent).toContain('1 thẻ');
  });

  it('shows a source name or "Từ vựng cá nhân", never the internal code; the back scrolls inside', async () => {
    render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    const back = screen.getByRole('region', { name: /Mặt sau của thẻ resilient/ });
    expect(back.getAttribute('tabindex')).toBe('0');
    expect(back.textContent).toContain('Cần ôn · Chưa học');
    expect(drillSourceLabel('grammar_lab_internal')).toBe('Từ vựng cá nhân');
    expect(drillSourceLabel('toString')).toBe('Từ vựng cá nhân');
  });

  it('a failed save says what to do in words and retries with the same client_review_id', async () => {
    reviewResponse = () => new Response(JSON.stringify({ detail: 'database timeout' }), { status: 500 });
    render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    fireEvent.click(rate('Khó'));
    await screen.findByText('Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại.');
    expect(document.body.textContent).not.toMatch(/HTTP 5\d\d|database timeout/);
    reviewResponse = (id) => new Response(JSON.stringify(receipt(id)), { status: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lưu lại' }));
    await screen.findByText(/Thẻ 2 trên 2/);
    expect(reviews).toHaveLength(2);
    expect(reviews[1].body).toEqual(reviews[0].body);
  });

  it('Thoát with an unsaved rating asks with the count; with nothing unsaved it leaves at once', async () => {
    reviewResponse = () => new Response('{}', { status: 503 });
    render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/flashcards'));
    location.assign.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    fireEvent.click(rate('Quên'));
    await screen.findByText('Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại.');
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    expect(await screen.findByText(/Còn 1 câu chưa lưu/)).toBeTruthy();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('a 401 after the stack loaded opens the sign-in box and keeps the pending rating', async () => {
    reviewResponse = () => new Response('{}', { status: 401 });
    render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    fireEvent.click(rate('Tốt'));
    const box = (await screen.findByText('Phiên đăng nhập đã hết hạn')).closest('dialog')!;
    expect(location.replace).not.toHaveBeenCalled();
    expect(within(box).queryByRole('link', { name: 'Đăng nhập lại' })).toBeNull();
    const sent = reviews.length;
    reviewResponse = (id) => new Response(JSON.stringify(receipt(id)), { status: 200 });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await screen.findByText(/Thẻ 2 trên 2/);
    expect(reviews[sent].body).toEqual(reviews[0].body);
  });

  it('signed out before the stack loads still goes to /login?next=', async () => {
    scope.status = 'signed-out'; scope.user = null;
    render(<FlashcardStudyPlayer />);
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/flashcard-study?stack=auto%3Adue')}`));
  });
});

describe('flag on: public stack', () => {
  it('locks both marks until the card is turned; the long back keeps the marks in view', async () => {
    openStack('wiki:environment');
    scope.status = 'signed-out'; scope.user = null;
    render(<FlashcardStudyPlayer />);
    await screen.findByText(/Thẻ 1 trên 2/);
    expect(rate('Cần ôn').disabled).toBe(true);
    expect(rate('Tự đánh giá nhớ').disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getByText(/Thẻ 1 trên 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /emission. Lật thẻ/ }));
    const back = screen.getByRole('region', { name: /Mặt sau của thẻ emission/ });
    expect(back.textContent).toContain('carbon emission');
    expect(back.textContent).toContain('e-mission');
    fireEvent.click(rate('Cần ôn'));
    await screen.findByText(/Thẻ 2 trên 2/);
    expect(screen.queryByText('Phiên đăng nhập đã hết hạn')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lật thẻ' }));
    fireEvent.click(rate('Tự đánh giá nhớ'));
    // FR-007: counts by mark in words, the device note as today.
    await screen.findByText(/Xong bộ thẻ: 2 thẻ/);
    expect(screen.getByText('Đánh dấu đã được lưu trên thiết bị này.')).toBeTruthy();
    expect(screen.getByText('Cần ôn').closest('div')?.textContent).toBe('Cần ôn1 thẻ');
    expect(screen.getByText('Tự đánh giá nhớ').closest('div')?.textContent).toBe('Tự đánh giá nhớ1 thẻ');
    expect(screen.getByRole('button', { name: 'Học lại' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chọn bộ khác' }).getAttribute('href')).toBeTruthy();
  });
});

describe('flag off: the page as today', () => {
  it('renders the old player; rating is not gated by the flip', async () => {
    setFlag(false);
    const view = render(<FlashcardStudyPlayer />);
    await screen.findByText('1 / 2');
    expect(view.container.querySelector('[data-exam-room]')).toBeNull();
    expect(view.container.querySelector('.fcs-actions')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    await screen.findByText('2 / 2');
    expect(reviews).toHaveLength(1);
  });
});

it('the room hides the page header and site bar while shown and gives them back', async () => {
  const chrome = document.createElement('aver-chrome');
  const header = document.createElement('header');
  header.className = 'fcs-header';
  document.body.prepend(chrome, header);
  const view = render(<FlashcardStudyPlayer />);
  await screen.findByText(/Thẻ 1 trên 2/);
  expect(chrome.hidden).toBe(true);
  expect(header.hidden).toBe(true);
  view.unmount();
  expect(chrome.hidden).toBe(false);
  expect(header.hidden).toBe(false);
  chrome.remove(); header.remove();
});
