// Destinations of the public shell (UIBASE-0056 FR-011, plan 5.5).
//
// CẦN ANH ANDY QUYẾT (spec 0056 mục 10, câu 5): "Khoá học" and "Xem các khoá"
// belong on /courses, which G05 builds. Until then both point to the home page.
// "Thư viện" belongs on /library (G07, PR #2443); until that route is live it
// points to the Grammar Wiki, the public part of the library that exists today.
//
// Every href here is rendered as a plain <a>: the public shell is on the v2
// tree and most destinations are still legacy pages, so a click must be a full
// page load (FR-015), never a next/link soft navigation.
export const PUBLIC_HREF = Object.freeze({
  home: '/',
  library: '/grammar',
  courses: '/',
  login: '/login',
  about: '/about',
  terms: '/terms',
  privacy: '/privacy',
  contact: '/contact',
});

/** Footer order is fixed on every page (KhungTrang2 §9, plan 5.5). */
export const PUBLIC_FOOTER_LINKS = Object.freeze([
  { href: PUBLIC_HREF.about, label: 'Giới thiệu' },
  { href: PUBLIC_HREF.courses, label: 'Khoá học' },
  { href: PUBLIC_HREF.library, label: 'Thư viện' },
  { href: PUBLIC_HREF.terms, label: 'Điều khoản' },
  { href: PUBLIC_HREF.privacy, label: 'Quyền riêng tư' },
  { href: PUBLIC_HREF.contact, label: 'Liên hệ' },
] as const);
