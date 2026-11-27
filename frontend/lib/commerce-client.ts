'use client';

// PUBLICSITE-0059 §5.3 (G05-T02) — browser reads that carry the session token,
// so the answer includes the caller's own `viewer` block. Never cached.
// noRedirect: a stale session on a public page shows the guest view, it does
// not bounce to /login.
//
// OpenAPI declares the catalogue path but its response is unknown. Validate
// the wire payload before letting the page render personal viewer fields.

import { getBrowserJson } from './browser-api';
import type { CourseCatalog, CourseDetail, CourseItem, MyCourses } from './commerce-types';
import { whenGlobalReady } from './when-global-ready.mjs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown) {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isCourseItem(item: unknown): item is CourseItem {
  if (!isRecord(item) || !isRecord(item.viewer)) return false;
  const { author, viewer } = item;
  return [item.slug, item.title].every((value) => typeof value === 'string')
    && (item.status === 'open' || item.status === 'coming_soon' || item.status === 'closed')
    && [item.short_title, item.summary, item.credits_expire_note, item.level_from, item.level_to,
      item.expected_open_on].every(isNullableString)
    && [item.tuition_vnd, item.access_days, item.credit_valid_days, item.credit_carry_percent,
      item.credit_carry_valid_days, item.lesson_count].every(isNullableNumber)
    && typeof item.ai_credits === 'number' && Number.isFinite(item.ai_credits)
    && (author === null || (isRecord(author)
      && [author.name, author.bio_line, author.photo_url].every(isNullableString)))
    && Array.isArray(item.features) && item.features.every((feature) => typeof feature === 'string')
    && typeof viewer.state === 'string'
    && ['guest', 'can_enroll', 'open_order', 'enrolled', 'expired'].includes(viewer.state)
    && isNullableNumber(viewer.days_left) && typeof viewer.can_renew === 'boolean'
    && isNullableString(viewer.open_order_code);
}

async function transportReady(): Promise<void> {
  if (!await whenGlobalReady(() => !!window.api?.getWith, 'window.api')) {
    throw new Error('window.api unavailable');
  }
}

export async function fetchCatalogForViewer(): Promise<CourseCatalog> {
  await transportReady();
  const response = await getBrowserJson('/api/courses', undefined, undefined, { noRedirect: true });
  if (!isRecord(response) || !Array.isArray(response.items) || !response.items.every(isCourseItem)) {
    throw new Error('Malformed course catalogue');
  }
  return { items: response.items };
}

export async function fetchCourseForViewer(slug: string): Promise<CourseDetail> {
  await transportReady();
  return window.api.getWith<CourseDetail>(`/api/courses/${encodeURIComponent(slug)}`, undefined, { noRedirect: true });
}

/** The caller's own accesses (FR-024: `content_visible_until` on an expired course). */
export async function fetchMyCourses(): Promise<MyCourses> {
  await transportReady();
  return window.api.getWith<MyCourses>('/api/me/courses', undefined, { noRedirect: true });
}
