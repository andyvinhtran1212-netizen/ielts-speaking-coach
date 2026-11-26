// LIBRARY-0061 T014 (b) (G06-T14b): Grammar Wiki home index — groups, A–Z, accent-free search.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrammarIndex } from '@/app/(public-content)/grammar/grammar-index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const art = (slug: string, title: string, category = 'cat', status = 'complete') => ({ slug, category, title, status });

const GROUPS = [
  {
    slug: 'foundations',
    title: 'Nền tảng',
    description: 'Từ loại, thành phần câu.',
    articles: [art('articles', 'Articles — a, an, the', 'foundations'), art('word-order', 'Word Order — Trật tự từ', 'foundations')],
  },
  {
    slug: 'sentence-structures',
    title: 'Cấu trúc câu',
    description: 'Câu ghép, bị động.',
    articles: [art('passive-voice', 'Passive Voice — Câu bị động', 'sentence-structures'), art('later', 'Later', 'x', 'planned')],
  },
];

describe('Grammar Wiki home index', () => {
  it('"Theo nhóm": group list with counts, first group open, articles link to clean URLs', () => {
    render(<GrammarIndex groups={GROUPS} />);
    expect(screen.getByText('2 nhóm · 3 bài')).toBeTruthy();
    const tree = screen.getByTestId('grammar-tree');
    const current = tree.querySelector('a[aria-current="true"]')!;
    expect(current.textContent).toContain('Nền tảng');
    expect(current.getAttribute('href')).toBe('/grammar?nhom=foundations#groups-section');
    expect(within(tree).getByRole('heading', { level: 3, name: 'Nền tảng' })).toBeTruthy();
    expect(within(tree).getByRole('link', { name: 'Articles' }).getAttribute('href')).toBe('/grammar/foundations/articles');
    // A planned article is never linked.
    expect(screen.queryByText('Later')).toBeNull();
  });

  it('choosing a group swaps the panel and replaces the URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<GrammarIndex groups={GROUPS} />);
    const tree = screen.getByTestId('grammar-tree');
    fireEvent.click(within(tree).getByRole('link', { name: /Cấu trúc câu/ }));
    expect(within(tree).getByRole('heading', { level: 3, name: 'Cấu trúc câu' })).toBeTruthy();
    expect(within(tree).getByRole('link', { name: 'Passive Voice' })).toBeTruthy();
    expect(replace).toHaveBeenLastCalledWith(null, '', '/grammar?nhom=sentence-structures');
  });

  it('back from A–Z keeps the open group in the URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<GrammarIndex groups={GROUPS} />);
    fireEvent.click(within(screen.getByTestId('grammar-tree')).getByRole('link', { name: /Cấu trúc câu/ }));
    fireEvent.click(screen.getByRole('link', { name: 'A–Z' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/grammar?xem=az');
    fireEvent.click(screen.getByRole('link', { name: 'Theo nhóm' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/grammar?nhom=sentence-structures');
    expect(within(screen.getByTestId('grammar-tree')).getByRole('heading', { level: 3, name: 'Cấu trúc câu' })).toBeTruthy();
  });

  it('opening a group on the phone selects it and writes it to the URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<GrammarIndex groups={GROUPS} />);
    const second = screen.getByTestId('grammar-accordion').querySelectorAll('details')[1] as HTMLDetailsElement;
    second.open = true;
    fireEvent(second, new Event('toggle'));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/grammar?nhom=sentence-structures');
    expect(within(screen.getByTestId('grammar-tree')).getByRole('heading', { level: 3, name: 'Cấu trúc câu' })).toBeTruthy();
  });

  it('"Lỗi hay gặp" lists the error-clinic group and links to it; absent without that group', () => {
    const clinic = {
      slug: 'error-clinic',
      title: 'Error Clinic',
      description: 'Lỗi người Việt hay mắc.',
      articles: [art('article-errors', 'Article Errors — Lỗi dùng mạo từ', 'error-clinic')],
    };
    const replace = vi.spyOn(window.history, 'replaceState');
    const view = render(<GrammarIndex groups={[...GROUPS, clinic]} />);
    const block = screen.getByTestId('grammar-common-errors');
    expect(within(block).getByRole('heading', { level: 2, name: 'Lỗi hay gặp' })).toBeTruthy();
    expect(within(block).getByRole('link', { name: 'Article Errors' }).getAttribute('href')).toBe('/grammar/error-clinic/article-errors');
    const all = within(block).getByRole('link', { name: 'Xem cả nhóm Error Clinic (1 bài)' });
    expect(all.getAttribute('href')).toBe('/grammar?nhom=error-clinic#groups-section');
    fireEvent.click(all);
    expect(replace).toHaveBeenLastCalledWith(null, '', '/grammar?nhom=error-clinic');
    view.unmount();
    render(<GrammarIndex groups={GROUPS} />);
    expect(screen.queryByTestId('grammar-common-errors')).toBeNull();
  });

  it('the URL group opens first, and the phone accordion opens the same one', () => {
    render(<GrammarIndex groups={GROUPS} initialGroup="sentence-structures" />);
    const open = screen.getByTestId('grammar-accordion').querySelectorAll('details[open]');
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain('Cấu trúc câu');
    expect(screen.getByTestId('grammar-accordion').querySelectorAll('details[name="grammar-groups"]')).toHaveLength(2);
  });

  it('"A–Z" lists every article once by Vietnamese name; empty letters are dimmed, not links', () => {
    render(<GrammarIndex groups={GROUPS} initialView="az" />);
    const az = screen.getByTestId('grammar-az');
    expect([...az.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['A', 'C', 'T']);
    expect(within(az).getByRole('link', { name: 'Câu bị động' }).getAttribute('href')).toBe('/grammar/sentence-structures/passive-voice');
    const bar = within(az).getByRole('navigation', { name: 'Chữ cái' });
    expect(within(bar).getAllByRole('link').map((a) => a.textContent)).toEqual(['A', 'C', 'T']);
    expect(within(bar).getByText('B').getAttribute('aria-disabled')).toBe('true');
    expect(within(bar).getByText('B').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'A–Z' }).getAttribute('aria-current')).toBe('true');
  });

  it('search matches without accents, replaces the index, and links to the full results page', () => {
    render(
      <GrammarIndex groups={GROUPS}>
        <p>Bài nổi bật ở đây</p>
      </GrammarIndex>,
    );
    fireEvent.change(screen.getByLabelText('Tìm trong Grammar Wiki'), { target: { value: 'bi dong' } });
    const results = screen.getByTestId('grammar-results');
    expect(within(results).getByRole('link', { name: 'Passive Voice' })).toBeTruthy();
    expect(results.textContent).toContain('Nhóm 2 · Cấu trúc câu');
    expect(results.textContent).toContain('1 bài khớp “bi dong”');
    expect(screen.queryByTestId('grammar-tree')).toBeNull();
    expect(screen.queryByText('Bài nổi bật ở đây')).toBeNull();
    expect(within(results).getByRole('link', { name: /Xem trang kết quả đầy đủ/ }).getAttribute('href')).toBe(
      '/grammar/search?q=bi%20dong',
    );
  });

  it('no match names the query; "Xoá" brings the index back', () => {
    render(<GrammarIndex groups={GROUPS} />);
    fireEvent.change(screen.getByLabelText('Tìm trong Grammar Wiki'), { target: { value: 'xyz' } });
    expect(screen.getByTestId('grammar-no-results').textContent).toContain('Không có bài nào khớp “xyz”.');
    expect(screen.queryByText(/0 bài/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(screen.getByTestId('grammar-tree')).toBeTruthy();
  });

  it('works without JS: the form submits to /grammar/search with q', () => {
    render(<GrammarIndex groups={GROUPS} />);
    const form = screen.getByRole('search');
    expect(form.getAttribute('action')).toBe('/grammar/search');
    expect(form.getAttribute('method')).toBe('get');
    expect(screen.getByLabelText('Tìm trong Grammar Wiki').getAttribute('name')).toBe('q');
  });

  it('no groups: says the index did not load and shows no count', () => {
    render(<GrammarIndex groups={[]} />);
    expect(screen.getByTestId('grammar-index-empty').textContent).toContain('Chưa tải được mục lục');
    expect(screen.queryByText(/nhóm ·/)).toBeNull();
  });
});
