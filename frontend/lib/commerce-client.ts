'use client';

// PUBLICSITE-0059 §5.3 (G05-T02) — browser reads that carry the session token,
// so the answer includes the caller's own `viewer` block. Never cached.
// noRedirect: a stale session on a public page shows the guest view, it does
// not bounce to /login.
//
// /api/courses* comes with G04 #2485 and is not in types/api.d.ts yet, so
// lib/browser-api.ts (bound to generated paths) cannot type it. Until that PR
// regenerates the contract these reads use the same transport with the
// hand-written types of lib/commerce-types.ts; when it lands, switch them to
// getBrowserJson/getBrowserJsonAt (same shape, same noRedirect).

import type { CourseCatalog, CourseDetail } from './commerce-types';
import { whenGlobalReady } from './when-global-ready.mjs';

async function transportReady(): Promise<void> {
  if (!await whenGlobalReady(() => !!window.api?.getWith, 'window.api')) {
    throw new Error('window.api unavailable');
  }
}

export async function fetchCatalogForViewer(): Promise<CourseCatalog> {
  await transportReady();
  return window.api.getWith<CourseCatalog>('/api/courses', undefined, { noRedirect: true });
}

export async function fetchCourseForViewer(slug: string): Promise<CourseDetail> {
  await transportReady();
  return window.api.getWith<CourseDetail>(`/api/courses/${encodeURIComponent(slug)}`, undefined, { noRedirect: true });
}

