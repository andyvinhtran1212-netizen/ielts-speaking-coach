// PUBLICSITE-0059 §5.3 (G05-T02) — server reads of the G04 catalogue.
// Guest reads only (no token, so the shared `getPublicJson` cache is safe):
// a response that carries a personal `viewer` is read in the browser through
// lib/commerce-client.ts and is never cached here.
import 'server-only';

import { cache } from 'react';

import { getPublicJson } from './backend';
import type { CourseCatalog, CourseDetail } from './commerce-types';

/** All public courses, guest view. Throws when the backend fails (error boundary). */
async function fetchCatalog(): Promise<CourseCatalog> {
  const data = await getPublicJson<CourseCatalog>('/api/courses');
  // A 404 here means the G04 routes are not deployed yet: say so, never show an empty shop.
  if (!data) throw new Error('backend 404 for /api/courses');
  return data;
}

/** One course, guest view; null = no such public course (the page calls notFound()). */
async function fetchCourse(slug: string): Promise<CourseDetail | null> {
  return getPublicJson<CourseDetail>(`/api/courses/${encodeURIComponent(slug)}`);
}

// generateMetadata and the page body share one fetch per request (ADR-008).
export const getCatalog = cache(fetchCatalog);
export const getCourse = cache(fetchCourse);
