'use client';

// PUBLICSITE-0059 §5.3 (G05-T02) — browser reads that carry the session token,
// so the answer includes the caller's own `viewer` block. Never cached.
// noRedirect: a stale session on a public page shows the guest view, it does
// not bounce to /login.
//
// OpenAPI declares the GET paths but their responses are unknown. Validate
// the wire payload before letting the pages render personal viewer fields.

import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAtWith } from './browser-api';
import type { CourseCatalog, CourseDetail, CourseItem } from './commerce-types';
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

function isCourseDetail(course: unknown): course is CourseDetail {
  if (!isRecord(course) || !isCourseItem(course)) return false;
  const { course_code, faq, chapters } = course;
  return isNullableString(course_code)
    && (faq === null || (Array.isArray(faq) && faq.every((entry: unknown) =>
      isRecord(entry) && isNullableString(entry.q) && isNullableString(entry.a))))
    && (chapters === null || (Array.isArray(chapters) && chapters.every((chapter: unknown) =>
      isRecord(chapter) && typeof chapter.title === 'string' && Array.isArray(chapter.lessons)
      && chapter.lessons.every((lesson: unknown) =>
        isRecord(lesson) && typeof lesson.title === 'string' && typeof lesson.kind === 'string'
        && isNullableNumber(lesson.duration_min) && typeof lesson.is_preview === 'boolean'
        && isNullableString(lesson.preview_href)))));
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
  const response = await getBrowserJsonAt(
    '/api/courses/{slug}', `/api/courses/${encodeURIComponent(slug)}`, undefined, { noRedirect: true },
  );
  if (!isCourseDetail(response) || response.slug !== slug) throw new Error('Malformed course detail');
  return response;
}

/** The caller's own content visibility deadline (FR-024). */
export async function fetchContentVisibleUntil(): Promise<string | null> {
  await transportReady();
  const response = await getBrowserJson('/api/me/courses', undefined, undefined, { noRedirect: true });
  return isRecord(response) && typeof response.content_visible_until === 'string'
    ? response.content_visible_until
    : null;
}

/** `POST /api/enrollment-orders` (G04 #2526): 201 a new order, 200 the open one (FR-036). */
export async function createEnrollmentOrder(productSlug: string, requestKey: string, signal?: AbortSignal) {
  await transportReady();
  signal?.throwIfAborted();
  const endpoint = '/api/enrollment-orders';
  const response = await postBrowserJsonAtWith(
    endpoint, endpoint, { product_slug: productSlug, request_key: requestKey }, { noRedirect: true, signal },
  );
  if (!isRecord(response) || !isRecord(response.order) || typeof response.order.order_code !== 'string') {
    throw new Error('Malformed enrollment order');
  }
  return { order: response.order };
}
