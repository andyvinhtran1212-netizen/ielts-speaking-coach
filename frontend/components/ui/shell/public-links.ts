// Destinations of the public shell (UIBASE-0056 FR-011, plan 5.5).
//
// "Khoá học" and "Xem các khoá" point to /courses (PUBLICSITE-0059 T04) once
// the build flag AVER_PUBLIC_COMMERCE is on; while it is off the page is a 404,
// so they keep pointing to the home page (FR-029, coursesHref).
// "Thư viện" points to the public Library hub /library (LIBRARY-0061 T008).
//
// Every href here is rendered as a plain <a>: the public shell is on the v2
// tree and most destinations are still legacy pages, so a click must be a full
// page load (FR-015), never a next/link soft navigation.
import { coursesHref } from '@/lib/public-commerce.mjs';

export const PUBLIC_HREF = Object.freeze({
  home: '/',
  library: '/library',
  courses: coursesHref(undefined, { fallback: '/' }) ?? '/',
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
