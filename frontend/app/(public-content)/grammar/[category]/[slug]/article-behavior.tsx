'use client';

import { useEffect, useRef } from 'react';

import { whenGlobalReady } from '../../../../../lib/when-global-ready.mjs';

interface ArticleBehaviorProps {
  slug: string;
  category: string;
  articleTitle: string;
  hasTOC?: boolean;
  hasCompareWith?: boolean;
  hasNextArticles?: boolean;
}

/**
 * ArticleBehavior — Client Component that replicates the legacy grammar.js
 * interactive behaviors: reading progress, TOC highlight, hash scroll, view
 * tracking, save button, guest CTA, exercise CTA.
 */
export function ArticleBehavior({
  slug,
  category,
  articleTitle,
  hasTOC = false,
  hasCompareWith = false,
  hasNextArticles = false,
}: ArticleBehaviorProps) {
  const hasInitedRef = useRef(false);

  useEffect(() => {
    if (hasInitedRef.current) return;
    hasInitedRef.current = true;

    // ── Reading progress bar ──────────────────────────────────────────
    const progressBar = document.getElementById('reading-progress');
    if (progressBar) {
      const handleScroll = () => {
        const doc = document.documentElement;
        const scrolled = doc.scrollTop;
        const total = doc.scrollHeight - doc.clientHeight;
        progressBar.style.width = total > 0 ? (scrolled / total) * 100 + '%' : '0%';
      };
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // ── TOC active highlight ──────────────────────────────────────────
  useEffect(() => {
    if (!hasTOC) return;

    const links = document.querySelectorAll(
      '#toc-container .toc-link, #mobile-toc-container .toc-link'
    );
    if (links.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            links.forEach((l) => {
              l.classList.remove('text-teal-light', '!text-white/90');
            });
            document
              .querySelectorAll(
                `#toc-container a[href="#${entry.target.id}"], ` +
                  `#mobile-toc-container a[href="#${entry.target.id}"]`
              )
              .forEach((active) => active.classList.add('text-teal-light'));
          }
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    document.querySelectorAll('.article-body h2, .article-body h3').forEach((h) => {
      observer.observe(h);
    });

    return () => observer.disconnect();
  }, [hasTOC]);

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

  // ── Save button ────────────────────────────────────────────────────
  useEffect(() => {
    _initSaveButton(slug);
  }, [slug]);

  // ── Guest CTA ──────────────────────────────────────────────────────
  useEffect(() => {
    _initGuestCTA(articleTitle);
  }, [articleTitle]);

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

  // ── Show/hide compare section ──────────────────────────────────────
  useEffect(() => {
    const section = document.getElementById('compare-section');
    if (section) {
      section.classList.toggle('hidden', !hasCompareWith);
    }
  }, [hasCompareWith]);

  // ── Show/hide next articles section ────────────────────────────────
  useEffect(() => {
    const section = document.getElementById('next-articles-section');
    if (section) {
      section.classList.toggle('hidden', !hasNextArticles);
    }
  }, [hasNextArticles]);

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
 * Initialize save button with optimistic update.
 */
async function _initSaveButton(slug: string) {
  if (typeof window === 'undefined') return;
  if (!await whenGlobalReady(
    () => !!(window as any).api?.post && !!(window as any).api?.delete,
    'window.api (nút Lưu bài)')) return;

  const metaEl = document.getElementById('article-meta');
  // Chờ xong mới dựng nút; nếu effect chạy lại trong lúc chờ thì không nhân đôi.
  if (document.getElementById('save-article-btn')) return;
  if (!metaEl) return;

  // Create button
  const btn = document.createElement('button');
  btn.id = 'save-article-btn';
  btn.className = 'gw-save-btn';
  btn.innerHTML = '🔖 Lưu bài';
  metaEl.appendChild(btn);

  function _setSaved(saved: boolean) {
    btn.dataset.saved = saved ? '1' : '0';
    btn.innerHTML = saved ? '🔖 Đã lưu' : '🔖 Lưu bài';
    btn.classList.toggle('gw-save-btn--saved', !!saved);
  }

  btn.addEventListener('click', async () => {
    const isSaved = btn.dataset.saved === '1';
    _setSaved(!isSaved); // optimistic toggle

    try {
      if (isSaved) {
        await (window as any).api!.delete(`/api/grammar/articles/${encodeURIComponent(slug)}/save`);
      } else {
        await (window as any).api!.post(`/api/grammar/articles/${encodeURIComponent(slug)}/save`, {});
      }
    } catch (_) {
      _setSaved(isSaved); // revert on error
    }
  });
}

let _guestCTAInited = false;
let _guestModalTimer: NodeJS.Timeout | null = null;

/**
 * Guest CTA: sticky bar + modal after 2nd article.
 */
async function _initGuestCTA(articleTitle: string) {
  if (typeof window === 'undefined') return;
  if (_guestCTAInited) return;
  _guestCTAInited = true;

  // Cờ trên đặt trước khi chờ để hai effect không chạy chồng nhau, nhưng nếu
  // chờ THẤT BẠI thì phải nhả ra — bản cũ đặt cờ rồi mới kiểm global, nên một
  // lần thua cuộc đua là khối CTA tắt vĩnh viễn cho cả vòng đời trang.
  if (!await whenGlobalReady(() => !!(window as any).getSupabase, 'window.getSupabase (CTA khách)')) {
    _guestCTAInited = false;
    return;
  }

  try {
    const sb = (window as any).getSupabase?.();
    if (!sb) return;

    const sessionResult = await sb.auth.getSession();
    if (sessionResult.data?.session) return; // logged in — no CTA
  } catch (_) {
    return;
  }

  // Show sticky bar
  const bar = document.getElementById('guest-cta-bar');
  if (bar) bar.classList.remove('hidden');

  // Track read count in localStorage — show modal on 2nd article
  const key = '_aver_grammar_reads';
  const count = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(count));

  if (count >= 2) {
    const overlay = document.getElementById('guest-modal-overlay');
    const titleEl = document.getElementById('guest-modal-title');
    const dismiss = document.getElementById('guest-modal-dismiss');

    if (!overlay) return;

    if (titleEl) {
      titleEl.textContent = `Bạn đang đọc bài ngữ pháp về "${articleTitle}"`;
    }

    if (_guestModalTimer !== null) clearTimeout(_guestModalTimer);

    _guestModalTimer = setTimeout(() => {
      overlay.classList.remove('hidden');
    }, 8000);

    const _dismissModal = () => {
      overlay.classList.add('hidden');
      localStorage.setItem(key, '0');
    };

    if (dismiss) dismiss.addEventListener('click', _dismissModal, { once: true });
    overlay.addEventListener(
      'click',
      (e) => {
        if (e.target === overlay) _dismissModal();
      },
      { once: true }
    );
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

    link.setAttribute('href', `/pages/quiz.html?bank=${encodeURIComponent(info.bank_id)}`);
    if (sub && info.questions) {
      sub.textContent = `Làm ${info.questions} điểm ngữ pháp để kiểm tra kiến thức bài này.`;
    }

    const section = document.getElementById('exercise-cta');
    if (section) section.classList.remove('hidden');
  } catch (_) {
    // no bank or offline — keep hidden
  }
}

// Declare window augmentation for TypeScript
