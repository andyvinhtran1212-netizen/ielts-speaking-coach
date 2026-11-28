// PUBLICSITE-0059 T05 — `/courses/[slug]`, one public course (FR-007, 008,
// 009, 022, 024, 025, 028; tờ TrangKhoaHoc).
//
// Behind the build flag AVER_PUBLIC_COMMERCE (FR-029): off → 404.
// FR-009: an unknown slug, or a course that is not public (Course 1–5), is a
// real HTTP 404: proxy.ts asks the course API first and rewrites a miss to the
// root 404. The page still calls notFound() (a course that disappears between
// the two reads, a gateway 404); this route has no loading.tsx on purpose.
//
// The server renders the guest view (cached read, no token); the visitor's own
// `viewer` block is read in the browser by CoursePage.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCourse } from '@/lib/commerce-api';
import { publicCommerceEnabled } from '@/lib/public-commerce.mjs';

import { CoursePage } from './course-page';

// The course is read before the page renders, with no Suspense placeholder
// in between: a blocking render, so the panel and the course text arrive
// together. The guest read itself is cached (getPublicJson). The HTTP status
// of a miss is decided earlier, in proxy.ts (the layout prerenders a shell,
// so notFound() here alone would answer 200 + noindex).
export const instant = false;

type Params = { params: Promise<{ slug: string }> };

async function courseOr404(params: Params['params']) {
  if (!publicCommerceEnabled()) notFound();
  const { slug } = await params;
  const course = await getCourse(slug);
  if (!course) notFound();
  return course;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const course = await courseOr404(params);
  const path = `/courses/${encodeURIComponent(course.slug)}`;
  return {
    title: `${course.title} — Aver Learning`,
    ...(course.summary ? { description: course.summary } : {}),
    alternates: { canonical: path },
  };
}

export default async function CourseSlugPage({ params }: Params) {
  const course = await courseOr404(params);
  return <CoursePage course={course} />;
}
