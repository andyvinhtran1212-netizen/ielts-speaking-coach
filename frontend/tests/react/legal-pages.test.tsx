import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AboutPage, { metadata as aboutMeta } from '@/app/(public-v2)/about/page';
import ContactPage, { metadata as contactMeta } from '@/app/(public-v2)/contact/page';
import PrivacyPage, { metadata as privacyMeta } from '@/app/(public-v2)/privacy/page';
import TermsPage, { metadata as termsMeta } from '@/app/(public-v2)/terms/page';

// G02-T13 (FR-02-011): four public pages, each marked as a draft awaiting
// legal review, cross-linked from the shared footer, and kept out of search
// indexes until legal sign-off. G03-T13 moved them onto the "Bản in" tree:
// PublicShell footer, plain <a> links, a table of contents built from articles.
afterEach(cleanup);

const PAGES = [
  { name: 'terms', Page: TermsPage, meta: termsMeta, h1: 'Điều khoản sử dụng' },
  { name: 'privacy', Page: PrivacyPage, meta: privacyMeta, h1: 'Chính sách quyền riêng tư' },
  { name: 'contact', Page: ContactPage, meta: contactMeta, h1: 'Liên hệ' },
  { name: 'about', Page: AboutPage, meta: aboutMeta, h1: 'Giới thiệu' },
];

describe.each(PAGES)('/$name', ({ Page, meta, h1 }) => {
  it('shows its title, the draft notice and footer links to all four pages', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(h1);
    expect(screen.getByRole('note').textContent).toContain('Bản tạm');
    expect(screen.getByRole('note').textContent).toContain('đang chờ duyệt pháp lý');
    const footer = within(screen.getByRole('navigation', { name: 'Chân trang' }));
    const hrefs = footer.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const href of ['/about', '/terms', '/privacy', '/contact']) expect(hrefs).toContain(href);
    expect(screen.getByRole('navigation', { name: 'Vị trí trang' }).textContent).toContain('Trang chủ');
    expect(screen.getByRole('main').querySelector('h1')?.textContent).toBe(h1);
  });

  it('is excluded from search indexes until legal review', () => {
    expect(meta.robots).toMatchObject({ index: false });
    expect(String(meta.title)).toMatch(/ — Aver Learning$/);
  });
});

it.each([
  ['terms', TermsPage, 7],
  ['privacy', PrivacyPage, 6],
])('/%s table of contents links to every numbered article', (_name, Page, count) => {
  const { container } = render(<Page />);
  const sections = [...container.querySelectorAll('section[id^="dieu-"]')];
  expect(sections.map((s) => s.id)).toEqual(Array.from({ length: count }, (_, i) => `dieu-${i + 1}`));
  const toc = screen.getByRole('navigation', { name: 'Mục lục' });
  expect(within(toc).getAllByRole('link').map((a) => a.getAttribute('href')))
    .toEqual(sections.map((s) => `#${s.id}`));
});

it('the phone table of contents opens and closes, and picking an entry closes it', () => {
  render(<TermsPage />);
  const toggle = screen.getByRole('button', { name: 'Mục lục' });
  const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(list.dataset.open).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(list.dataset.open).toBe('true');
  fireEvent.click(within(list).getAllByRole('link')[2]);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('no page links with next/link: every v2 → v1 click must be a full load (FR-015)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const path = await import('node:path');
  const dir = path.resolve(__dirname, '../../app/(public-v2)');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
  const shell = path.resolve(__dirname, '../../components/ui/shell');
  const shellFiles = readdirSync(shell).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(shell, f));
  const offenders = [...files.map((f) => path.join(dir, f)), ...shellFiles]
    .filter((f) => /from ['"]next\/link['"]/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
