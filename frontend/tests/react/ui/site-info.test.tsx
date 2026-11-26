import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { API_BASE, getPublicJson, PUBLIC_CONTENT_LIFE } from '@/lib/backend';
import { cacheLife } from 'next/cache';
import { getSiteInfo } from '@/lib/site-info';

afterEach(vi.unstubAllGlobals);

it('does not reuse a successful flag value across reads when the backend fails', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ login_code_enabled: true, enroll_prelearn_chapter1: true }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', request);

  expect(await getSiteInfo()).toMatchObject({
    login_code_enabled: true,
    enroll_prelearn_chapter1: true,
  });
  expect(await getSiteInfo()).toMatchObject({
    login_code_enabled: false,
    enroll_prelearn_chapter1: false,
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(cacheLife).not.toHaveBeenCalled();
  expect(request).toHaveBeenLastCalledWith(
    `${API_BASE}/api/public/site-info`,
    expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
  );
});

it('keeps the existing cache policy for ordinary public content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [] })));
  await expect(getPublicJson('/api/vocabulary/categories')).resolves.toEqual({ items: [] });
  expect(cacheLife).toHaveBeenCalledWith(PUBLIC_CONTENT_LIFE);
});
