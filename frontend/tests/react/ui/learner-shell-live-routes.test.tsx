// Registry Q53 (CR #2445), carried into LEARNERNAV-0062: a real page that
// renders LearnerShell must never link to a route that is still `planned`
// (/course, /practice, /tests, /progress, /account, /help, ... until G07
// builds them). The shell's own test checks the shell in isolation; this one
// renders each real page frame that mounts it, signed in as an admin (the
// role that sees the most links), opens the account menu, and checks every
// href against the route registry.
//
// Every frame under app/ that mounts LearnerShell must be listed in FRAMES.
// A new G07 page that mounts the shell fails here until it is added, so its
// links are checked from the first commit. The two diagnostic pages (UI
// library, v2 pilot) render the shell as a specimen and are exempt.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/library' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

import { CommerceFrame } from '@/app/(public-commerce)/commerce-frame';
import { LibraryFrame } from '@/app/(public-library)/library-frame';
import { routeFor } from '@/lib/route-registry.mjs';

const APP = join(__dirname, '..', '..', '..', 'app');
const DIAGNOSTIC = ['(ui-library)/', '(authed-v2-pilot)/'];

type Frame = { pathname: string; render: () => ReactElement; roleSwitch: string };

/** Real frames that mount LearnerShell, by path under app/. */
const FRAMES: Record<string, Frame> = {
  '(public-commerce)/commerce-frame.tsx': {
    pathname: '/courses',
    render: () => <CommerceFrame><p>Danh sách khoá</p></CommerceFrame>,
    roleSwitch: 'Quản trị',
  },
  '(public-library)/library-frame.tsx': {
    pathname: '/library',
    render: () => <LibraryFrame><p>kệ sách</p></LibraryFrame>,
    roleSwitch: 'Giáo viên',
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(entry.name) ? [path] : [];
  });
}

/** Files under app/ that import the shell component, diagnostic pages left out. */
function framesInApp(): string[] {
  return sources(APP)
    .filter((path) => /from ['"]@\/components\/ui\/shell\/learner-shell['"]/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(APP, path).split('\\').join('/'))
    .filter((path) => !DIAGNOSTIC.some((prefix) => path.startsWith(prefix)))
    .sort();
}

const me = {
  id: 'A', email: 'bao@example.com', display_name: 'Trần Quốc Bảo', avatar_url: null, role: 'admin',
  is_active: true, onboarding_completed: true, target_band: null, exam_date: null, self_level: null,
  preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false, d3_enabled: false,
  flashcard_enabled: false, vocab_curated_enabled: false,
};

beforeEach(() => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '1');
  Object.assign(window, {
    api: { getWith: vi.fn(async () => me) },
    aver: { reportError: vi.fn() },
    getSupabase: () => ({ auth: {
      getSession: async () => ({ data: { session: { user: { id: 'A', email: 'bao@example.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as any).getSupabase;
  delete (window as any).aver;
  delete (window as any).api;
});

describe('real pages with LearnerShell link only to live routes (registry Q53)', () => {
  it('every frame under app/ that mounts LearnerShell is listed here', () => {
    expect(framesInApp()).toEqual(Object.keys(FRAMES).sort());
  });

  it('the public catalogue keeps the five learner tabs without selecting one', async () => {
    nav.pathname = '/courses';
    render(<CommerceFrame><p>Danh sách khoá</p></CommerceFrame>);
    const learnerNav = await screen.findByRole('navigation', { name: 'Mục chính' });
    const links = within(learnerNav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Hôm nay', 'Lộ trình', 'Luyện tập', 'Thi thử', 'Thư viện']);
    expect(links.every((link) => !link.hasAttribute('aria-current'))).toBe(true);
  });

  it.each(Object.entries(FRAMES))('%s: no href points to a planned or unknown route', async (_file, frame) => {
    nav.pathname = frame.pathname;
    render(frame.render());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Signed in as an admin: check the links each frame exposes.
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.getByRole('link', { name: `Đổi vai trò: sang ${frame.roleSwitch}` })).toBeTruthy();

    const hrefs = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') as string)
      .filter((href) => href.startsWith('/'));
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs.filter((href) => routeFor(href.split(/[?#]/)[0])?.status !== 'live')).toEqual([]);
  });
});
