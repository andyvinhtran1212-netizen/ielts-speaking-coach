import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GrammarLearningDashboard,
  GrammarModeSwitcher,
  normalizeWeakAreas,
} from '@/app/(public-content)/grammar/grammar-home-mode';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe('G02 normalizeWeakAreas (backend weak_areas wire shape)', () => {
  it('maps tag/label_vi from /api/grammar/dashboard-data to slug/title', () => {
    expect(normalizeWeakAreas([
      { tag: 'parts-of-speech', label_vi: 'Parts of Speech', category: 'foundations', occurrence_count: 3, last_seen_at: '2026-11-01T00:00:00Z' },
    ])).toEqual([{ slug: 'parts-of-speech', title: 'Parts of Speech', category: 'foundations' }]);
  });

  it('drops rows without a slug/tag or with an empty category; falls back to slug as title', () => {
    expect(normalizeWeakAreas([
      { label_vi: 'No tag', category: 'foundations' },
      { tag: 'orphan', label_vi: 'Orphan', category: '' },
      { tag: 'articles', category: 'foundations' },
      { slug: 'tenses', title: 'Tenses', category: 'verbs' },
    ])).toEqual([
      { slug: 'articles', title: 'articles', category: 'foundations' },
      { slug: 'tenses', title: 'Tenses', category: 'verbs' },
    ]);
    expect(normalizeWeakAreas(undefined)).toEqual([]);
    expect(normalizeWeakAreas(null)).toEqual([]);
  });
});

describe('G02 "Điểm cần củng cố" card', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/grammar?mode=learning');
  });
  afterEach(() => {
    cleanup();
    delete (window as any).getSupabase;
    delete (window as any).api;
  });

  const mountDashboard = (weakAreas: unknown[]) => {
    (window as any).getSupabase = () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } });
    (window as any).api = {
      getWith: async (path: string) => (path === '/api/grammar/dashboard-data'
        ? { weak_areas: weakAreas, recently_viewed: [], saved_articles: [] }
        : { mode: 'starter', nodes: [] }),
    };
    return render(<GrammarLearningDashboard />);
  };

  it('renders a labelled link to the real article, never /undefined', async () => {
    const { container } = mountDashboard([
      { tag: 'parts-of-speech', label_vi: 'Parts of Speech', category: 'foundations', occurrence_count: 2 },
      { label_vi: 'Missing tag', category: 'foundations', occurrence_count: 2 },
    ]);
    const link = await screen.findByRole('link', { name: /Parts of Speech/ });
    expect(link.getAttribute('href')).toBe('/grammar/foundations/parts-of-speech?from=learning');
    expect(screen.queryByText('Missing tag')).toBeNull();
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') || '').not.toContain('undefined');
    }
  });

  it('shows the empty state when no weak area is linkable', async () => {
    mountDashboard([{ label_vi: 'Missing tag', category: 'foundations' }]);
    expect(await screen.findByText('Chưa có lỗi lặp lại đủ để kết luận.')).toBeTruthy();
  });
});

describe('G01 #groups-section CTA in learning mode', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollIntoView = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    cleanup();
    delete (Element.prototype as any).scrollIntoView;
    window.history.replaceState(null, '', '/grammar');
  });

  const view = () => (
    <>
      <a href="#groups-section">Khám phá hệ thống</a>
      <GrammarModeSwitcher
        reference={<section id="groups-section">Nhóm chủ đề</section>}
        learning={<p>Lộ trình content</p>}
      />
    </>
  );

  it('switches to reference mode, keeps the href and scrolls to the groups section', async () => {
    window.history.replaceState(null, '', '/grammar?mode=learning');
    const { rerender } = render(view());
    const cta = screen.getByRole('link', { name: 'Khám phá hệ thống' });
    expect(cta.getAttribute('href')).toBe('#groups-section');
    expect(document.getElementById('grammar-panel-reference')?.hidden).toBe(true);

    fireEvent.click(cta);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#groups-section');
    // Next re-renders from its useSearchParams subscription; this mock reads on render.
    rerender(view());
    expect(document.getElementById('grammar-panel-reference')?.hidden).toBe(false);
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('groups-section'));
  });

  it('honors an initial #groups-section hash in learning mode', async () => {
    window.history.replaceState(null, '', '/grammar?mode=learning#groups-section');
    const { rerender } = render(view());
    expect(window.location.search).toBe('');
    rerender(view());
    expect(screen.getByRole('tab', { name: /Tra cứu/ }).getAttribute('aria-selected')).toBe('true');
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('leaves native anchor behaviour alone in reference mode', () => {
    window.history.replaceState(null, '', '/grammar');
    render(view());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole('link', { name: 'Khám phá hệ thống' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
