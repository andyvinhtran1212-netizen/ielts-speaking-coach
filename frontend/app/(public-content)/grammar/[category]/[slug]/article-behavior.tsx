'use client';

import { useEffect } from 'react';

import { whenGlobalReady } from '../../../../../lib/when-global-ready.mjs';

interface ArticleBehaviorProps {
  slug: string;
  category: string;
}

/**
 * ArticleBehavior — browser-only parts of the Grammar article (LIBRARY-0061
 * T014 PR (a)): hash scroll with pulse, view tracking, the quick-check link and
 * Grammar Lab checks. The "đang đọc" contents highlight belongs to
 * ReadingLayout and "Lưu bài" to SaveControl. The old reading-progress bar,
 * sticky guest bar and guest modal are gone: the page has exactly one way to
 * the courses, at the end, never a pop-up (FR-003).
 */
export function ArticleBehavior({
  slug,
  category,
}: ArticleBehaviorProps) {
  // ── Hash-based scroll to anchor with pulse ────────────────────────
  useEffect(() => {
    const scrollToHashAnchor = () => {
      const hash = window.location.hash;
      if (!hash || hash === '#') return;

      let anchorId: string;
      try {
        anchorId = decodeURIComponent(hash.substring(1));
      } catch (_) {
        anchorId = hash.substring(1);
      }
      if (!anchorId) return;

      requestAnimationFrame(() => {
        const el = document.getElementById(anchorId);
        if (!el) {
          console.warn('Grammar deep-link: anchor not found', anchorId);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        _pulseAnchorHeading(el);
      });
    };

    const handleHashChange = () => scrollToHashAnchor();

    // Scroll on mount if hash exists
    scrollToHashAnchor();

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // ── View tracking ─────────────────────────────────────────────────
  useEffect(() => {
    _trackArticleView(slug);
  }, [slug]);

  // ── Exercise CTA ───────────────────────────────────────────────────
  useEffect(() => {
    _initExerciseCTA(category, slug);
  }, [category, slug]);

  // ── Grammar Lab checks ───────────────────────────────────────────
  useEffect(() => {
    const checks = Array.from(document.querySelectorAll<HTMLElement>('.gw-check'));
    const cleanups = checks.map((check) => {
      const options = Array.from(check.querySelectorAll<HTMLButtonElement>('.gw-check-option'));
      const feedback = check.querySelector<HTMLElement>('.gw-check-feedback');
      const handleClick = (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement;
        if (check.dataset.answered === '1') return;
        const selected = Number(button.dataset.optionIndex);
        const correct = Number(check.dataset.correctIndex);
        const isCorrect = selected === correct;
        check.dataset.answered = '1';
        options.forEach((option, index) => {
          option.disabled = true;
          option.classList.toggle('is-correct', index === correct);
          option.classList.toggle('is-incorrect', index === selected && !isCorrect);
        });
        if (feedback) {
          const explanation = button.dataset.feedback || '';
          feedback.textContent = `${isCorrect ? 'Chính xác.' : 'Chưa đúng.'}${explanation ? ` ${explanation}` : ''}`;
          feedback.classList.add(isCorrect ? 'is-correct' : 'is-incorrect');
        }
        _recordMicrocheck(check, isCorrect);
      };
      options.forEach((option) => option.addEventListener('click', handleClick));
      return () => options.forEach((option) => option.removeEventListener('click', handleClick));
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [slug]);

  return null;
}

async function _recordMicrocheck(check: HTMLElement, correct: boolean) {
  const anchor = check.dataset.kpAnchor;
  const articleSlug = check.dataset.articleSlug;
  if (!anchor || !articleSlug || typeof window === 'undefined') return;
  try {
    if (!await whenGlobalReady(
      () => !!(window as any).getSupabase && !!(window as any).api?.post,
      'window.api (Grammar Lab micro-check)',
    )) return;
    const sb = (window as any).getSupabase?.();
    const session = await sb?.auth.getSession();
    if (!session?.data?.session) return;
    await (window as any).api.post('/api/kp/microcheck-answers', {
      answers: [{
        kp: { type: 'grammar', slug: articleSlug, anchor },
        correct,
        context: { surface: 'grammar-wiki', block_id: check.closest('[data-learning-block]')?.getAttribute('data-learning-block') },
      }],
    });
  } catch (_) {
    // Interaction remains useful offline; evidence recording is best-effort.
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helper functions (from legacy grammar.js)
// ──────────────────────────────────────────────────────────────────────

/**
 * Pulse highlight on the heading immediately after the anchor.
 * The anchor itself is empty (no visual); its next sibling is the heading.
 */
function _pulseAnchorHeading(anchorEl: HTMLElement) {
  const heading = anchorEl.nextElementSibling;
  if (!heading) return;
  const tag = heading.tagName;
  if (!tag || !/^H[1-6]$/.test(tag)) return;

  heading.classList.remove('grammar-anchor-pulse');
  // Force reflow to restart animation
  void (heading as HTMLElement).offsetWidth;
  heading.classList.add('grammar-anchor-pulse');
  setTimeout(() => {
    heading.classList.remove('grammar-anchor-pulse');
  }, 3100); // 3000ms animation + 100ms buffer
}

/**
 * Track article view (fire-and-forget, auth optional).
 * Only tracks for authenticated users.
 */
async function _trackArticleView(slug: string) {
  if (typeof window === 'undefined') return;
  if (!await whenGlobalReady(() => !!(window as any).getSupabase, 'window.getSupabase (đếm lượt xem)')) return;

  try {
    const sb = (window as any).getSupabase?.();
    if (!sb) return;

    const sessionResult = await sb.auth.getSession();
    if (!sessionResult.data?.session) return; // anonymous — skip

    // Call API if available
    if ((window as any).api?.post) {
      await (window as any).api.post(
        `/api/grammar/articles/${encodeURIComponent(slug)}/view`,
        { viewed_from: 'direct' }
      );
    }
  } catch (_) {
    // Network error — ignore
  }
}

/**
 * Initialize exercise CTA (show when a published grammar quiz bank exists).
 */
async function _initExerciseCTA(category: string, slug: string) {
  if (typeof window === 'undefined') return;

  try {
    if (!await whenGlobalReady(() => !!window.api?.getWith, 'window.api (Grammar exercise CTA)')) return;
    const info = await window.api.getWith<{ available?: boolean; bank_id?: string; questions?: number }>(
      `/api/grammar/article/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/exercise`,
    );
    if (!info?.available || !info?.bank_id) return;

    const link = document.getElementById('exercise-cta-link');
    const sub = document.getElementById('exercise-cta-sub');

    if (!link) return;

    link.setAttribute('href', `/quiz?bank=${encodeURIComponent(info.bank_id)}`);
    if (sub && info.questions) {
      sub.textContent = ` · ${info.questions} chủ điểm ngữ pháp`;
    }

    const line = document.getElementById('exercise-cta');
    if (line) line.hidden = false;
  } catch (_) {
    // no bank or offline — keep hidden
  }
}

