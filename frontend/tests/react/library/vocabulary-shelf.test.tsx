// LIBRARY-0061 T015: Vocabulary shelf (FR-051 look-up, FR-052 listen, FR-053 save, FR-054 sections).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListenButton } from '@/components/library/listen-button';
import { PENDING_SAVE_KEY, SaveWordButton, takePendingSave } from '@/components/library/save-word-button';
import type { VocabularyArticle } from '@/lib/vocabulary-types';

vi.mock('@/lib/browser-api', () => ({
  getBrowserJson: vi.fn(async (_path: string, params: URLSearchParams) => {
    const offset = Number(params.get('offset'));
    const all = WORDS.map((headword, index) => ({
      slug: headword.replace(/ /g, '-'), category: 'environment', headword, level: 'B2',
      part_of_speech: 'verb', pronunciation: '', gloss_vi: `nghĩa ${index}`, audio_headword: '',
    }));
    return {
      categories: [{ slug: 'environment', title: 'Environment', article_count: all.length }],
      items: all.slice(offset, offset + 100), total: all.length, offset, limit: 100,
    };
  }),
}));

const WORDS = ['mitigate', 'mitigation', 'misinformation', 'mild', 'mile', 'milk', 'mind', 'mobility'];

type ApiMock = {
  getWith: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

let api: ApiMock;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  api = { getWith: vi.fn(), post: vi.fn(), delete: vi.fn() };
  (window as unknown as { api: ApiMock }).api = api;
  window.sessionStorage.clear();
  assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, pathname: '/vocabulary', search: '' } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VocabularySearch (FR-051)', () => {
  async function setup() {
    const { VocabularySearch } = await import('@/app/(public-content)/vocabulary/vocabulary-search');
    render(<VocabularySearch />);
    const box = screen.getByRole('combobox', { name: 'Tra từ tiếng Anh' });
    fireEvent.focus(box);
    return box;
  }

  it('suggests from the second character, at most 5 rows', async () => {
    const box = await setup();
    fireEvent.change(box, { target: { value: 'm' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.change(box, { target: { value: 'mi' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5));
    expect((box).getAttribute('aria-expanded')).toBe('true');
  });

  it('↑ ↓ choose, Enter opens the chosen entry, Esc closes', async () => {
    const box = await setup();
    fireEvent.change(box, { target: { value: 'miti' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect((screen.getAllByRole('option')[1]).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect((screen.getAllByRole('option')[0]).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledWith('/vocabulary?cat=environment&slug=mitigate');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('an inflected form suggests its base form; Enter with no row chosen submits the form', async () => {
    const box = await setup();
    fireEvent.change(box, { target: { value: 'mitigated' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option').textContent).toContain('mitigate');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect((box.closest('form')).getAttribute('action')).toBe('/vocabulary');
  });
});

describe('ListenButton (FR-052)', () => {
  let play: ReturnType<typeof vi.fn>;
  let instances: Array<{ onerror: null | (() => void); onended: null | (() => void); pause: () => void }>;

  beforeEach(() => {
    instances = [];
    play = vi.fn(() => Promise.resolve());
    class FakeAudio {
      onerror: null | (() => void) = null;
      onended: null | (() => void) = null;
      pause = vi.fn();
      play = play;
      constructor() { instances.push(this); }
    }
    vi.stubGlobal('Audio', FakeAudio);
  });

  it('never plays by itself; pressing shows "Dừng"; a load error disables it with a notice', () => {
    render(<ListenButton url="/audio/a.mp3" label="Nghe mitigate" />);
    expect(play).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Nghe mitigate' });
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
    expect((button).getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Dừng');
    act(() => { instances[0].onerror?.(); });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Chưa tải được âm thanh')).toBeTruthy();
  });

  it('another listen button stops the one playing; no URL renders nothing', () => {
    const { container } = render(<><ListenButton url="/a.mp3" label="Nghe a" /><ListenButton url="/b.mp3" label="Nghe b" /><ListenButton url="" label="Nghe c" /></>);
    expect(container.querySelectorAll('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Nghe a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nghe b' }));
    expect(instances[0].pause).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Nghe a' })).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Dừng b' })).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SaveWordButton (FR-053)', () => {
  const target = { category: 'environment', slug: 'mitigate', headword: 'mitigate', definitionVi: 'làm giảm nhẹ', example: 'It can mitigate harm.' };

  it('a guest gets a prompt right under the button leading to sign-in with next', async () => {
    api.getWith.mockRejectedValueOnce(httpError(401));
    render(<SaveWordButton target={target} />);
    const button = await screen.findByRole('button', { name: 'Lưu vào sổ từ' });
    fireEvent.click(button);
    const link = screen.getByRole('link', { name: 'Đăng nhập để lưu' });
    expect((link).getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/vocabulary?cat=environment&slug=mitigate')}`);
    link.addEventListener('click', (event) => event.preventDefault()); // jsdom has no navigation
    fireEvent.click(link);
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_SAVE_KEY)!)).toEqual({ category: 'environment', slug: 'mitigate' });
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(screen.queryByRole('link', { name: 'Đăng nhập để lưu' })).toBeNull();
  });

  it('no button when the word bank is off for the viewer', async () => {
    api.getWith.mockRejectedValueOnce(httpError(403));
    const { container } = render(<SaveWordButton target={target} />);
    await waitFor(() => expect(api.getWith).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.querySelector('button')).toBeNull();
  });

  it('after sign-in the pending save for this entry runs once, then toggles in place', async () => {
    window.sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ category: 'environment', slug: 'mitigate' }));
    api.getWith.mockImplementation(async (path: string) => (path.endsWith('/stats') ? { total: 0 } : []));
    api.post.mockResolvedValueOnce({ id: 'row-1', headword: 'mitigate' });
    render(<SaveWordButton target={target} />);
    const saved = await screen.findByRole('button', { name: 'Đã lưu vào sổ từ' });
    expect(api.post).toHaveBeenCalledWith('/api/vocabulary/bank/', expect.objectContaining({ headword: 'mitigate', category: 'topic' }));
    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
    api.delete.mockResolvedValueOnce(null);
    fireEvent.click(saved);
    expect((await screen.findByRole('button', { name: 'Lưu vào sổ từ' })).getAttribute('aria-pressed')).toBe('false');
    expect(api.delete).toHaveBeenCalledWith('/api/vocabulary/bank/row-1');
  });

  it('a pending save for another entry is left alone', () => {
    window.sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ category: 'environment', slug: 'other' }));
    expect(takePendingSave(target)).toBe(false);
    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).not.toBeNull();
  });
});

describe('entry sections (FR-054)', () => {
  const base: VocabularyArticle = {
    slug: 'mitigate', category: 'environment', headword: 'mitigate', level: 'C1', partOfSpeech: 'verb',
    pronunciation: '/ˈmɪtɪɡeɪt/', glossVi: 'làm giảm nhẹ', audioHeadword: '', syllables: '', audioExample: '',
    definitionEn: 'to make something less harmful', definitionVi: '', example: 'Trees mitigate pollution.',
    collocations: [], synonyms: ['reduce'], antonyms: [], relatedWords: [], wordFamily: [], commonError: '',
    memoryHook: 'Hook', register: 'neutral', source: '', html: '',
  };

  it('leaves out empty sections and numbers the rest without gaps', async () => {
    const { entrySections } = await import('@/app/(public-content)/vocabulary/vocabulary-entry');
    const labels = entrySections(base).map((section) => section.label);
    expect(labels).toEqual(['Nghĩa và ví dụ', 'Từ đồng nghĩa và liên quan', 'Mẹo nhớ']);
  });

  it('keeps IPA as stored (ɡ U+0261) inside .av2-ipa', async () => {
    const { VocabularyEntry } = await import('@/app/(public-content)/vocabulary/vocabulary-entry');
    api.getWith.mockRejectedValue(httpError(401));
    const html = renderToStaticMarkup(<VocabularyEntry article={base} />);
    expect(html).toContain('<span class="av2-ipa">/ˈmɪtɪɡeɪt/</span>');
    expect(html).toContain('1 · Nghĩa và ví dụ');
    expect(html).toContain('3 · Mẹo nhớ');
    expect(html).not.toContain('Kết hợp từ');
  });
});
