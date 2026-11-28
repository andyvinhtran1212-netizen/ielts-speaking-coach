// ENROLL-0060 FR-035/036, G05-T12 màn 1 — `/courses/[slug]/enroll` (tờ ThanhToan màn 1).
//
// Behind the build flag AVER_PUBLIC_COMMERCE (PUBLICSITE-0059 FR-029): off →
// 404. An unknown or non-public course is a real HTTP 404: proxy.ts runs the
// same course check as for `/courses/<slug>` (the layout prerenders a shell,
// so notFound() here alone would answer 200 + noindex). The page still calls
// notFound() for a course that disappears between the two reads.
//
// The server renders the course summary from the cached guest read; the form,
// the session and the order are the browser's (EnrollPage). Not indexed.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCourse } from '@/lib/commerce-api';
import { publicCommerceEnabled } from '@/lib/public-commerce.mjs';

import { EnrollPage } from './enroll-page';

// Same as /courses/[slug]: the course is read before the page renders.
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
  return {
    title: `Đăng ký ${course.title} — Aver Learning`,
    robots: { index: false, follow: false },
  };
}

export default async function CourseEnrollPage({ params }: Params) {
  const course = await courseOr404(params);
  return <EnrollPage course={course} />;
}
