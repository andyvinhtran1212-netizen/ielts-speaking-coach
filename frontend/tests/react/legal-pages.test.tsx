import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AboutPage, { metadata as aboutMeta } from '@/app/(marketing)/about/page';
import ContactPage, { metadata as contactMeta } from '@/app/(marketing)/contact/page';
import PrivacyPage, { metadata as privacyMeta } from '@/app/(marketing)/privacy/page';
import TermsPage, { metadata as termsMeta } from '@/app/(marketing)/terms/page';

// G02-T13 (FR-02-011): four public pages, each marked as a draft awaiting
// legal review, cross-linked from the shared footer, and kept out of search
// indexes until legal sign-off.
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
    const footer = within(screen.getByRole('navigation', { name: 'Thông tin' }));
    expect(footer.getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['/about', '/terms', '/privacy', '/contact']);
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
  const sections = [...container.querySelectorAll('section.lg-article')];
  expect(sections.map((s) => s.id)).toEqual(Array.from({ length: count }, (_, i) => `dieu-${i + 1}`));
  const desktopToc = container.querySelector('.lg-toc__desktop')!;
  expect([...desktopToc.querySelectorAll('a')].map((a) => a.getAttribute('href')))
    .toEqual(sections.map((s) => `#${s.id}`));
});
