import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/backend', () => ({ ABORT_MS: 5000, API_BASE: 'https://staging.example.test' }));

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
  expect(request).toHaveBeenLastCalledWith(
    'https://staging.example.test/api/public/site-info',
    expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
  );
});
