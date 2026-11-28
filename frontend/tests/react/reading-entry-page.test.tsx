import { isValidElement, type ReactElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

// LEARNERCORE-0063 FR-111, CR #2578: `/reading` keeps the server redirect to
// /reading/vocab for everyone; only `/reading?hub=1` renders the hub entry.
const redirect = vi.fn((href: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { href }); });
vi.mock('next/navigation', () => ({ redirect: (href: string) => redirect(href) }));
vi.mock('@/components/learner/skill-hub/reading-hub-entry', () => ({ ReadingHubEntry: () => null }));

import ReadingEntryPage from '@/app/(authed-reading)/reading/page';
import { ReadingHubEntry } from '@/components/learner/skill-hub/reading-hub-entry';
import {
  SKILL_HUB_HREFS,
  hrefPath,
  readingFallbackHref,
  wantsClassicView,
} from '@/lib/skill-hub-model.mjs';

beforeEach(() => { redirect.mockClear(); });

async function open(params: Record<string, string | string[] | undefined>) {
  return ReadingEntryPage({ searchParams: Promise.resolve(params) });
}

function hasHubEntry(node: unknown): boolean {
  if (!isValidElement(node)) return false;
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === ReadingHubEntry) return true;
  const children = el.props.children;
  return (Array.isArray(children) ? children : [children]).some(hasHubEntry);
}

it.each([
  [{}],
  [{ ref: 'nav', x: '1' }],
  [{ hub: '0' }],
  [{ hub: ['1', '1'] }],
  [{ view: 'all' }],
])('/reading with %j redirects on the server to /reading/vocab, as today', async (params) => {
  await expect(open(params)).rejects.toThrow('NEXT_REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/reading/vocab');
});

it('/reading?hub=1 renders the hub entry and does not redirect', async () => {
  const page = await open({ hub: '1', ref: 'tab' });
  expect(redirect).not.toHaveBeenCalled();
  expect(hasHubEntry(page)).toBe(true);
});

it('the Reading tab points at ?hub=1 and its path is the live /reading route', () => {
  expect(SKILL_HUB_HREFS.reading).toBe('/reading?hub=1');
  expect(hrefPath(SKILL_HUB_HREFS.reading)).toBe('/reading');
  expect(hrefPath('/writing/dashboard#x')).toBe('/writing/dashboard');
});

it('the client fallback keeps the query without hub', () => {
  expect(readingFallbackHref('?hub=1')).toBe('/reading/vocab');
  expect(readingFallbackHref('?hub=1&ref=nav&x=1')).toBe('/reading/vocab?ref=nav&x=1');
  expect(readingFallbackHref('')).toBe('/reading/vocab');
});

it.each([
  ['?view=all', true],
  ['?assignment_id=a-7', true],
  ['?essay_id=e-1', true],
  ['?session_id=s-1', true],
  ['?assignment_id=', false],
  ['?hub=1', false],
  ['', false],
])('deep link %s keeps the existing page: %s', (search, classic) => {
  expect(wantsClassicView(search)).toBe(classic);
});
