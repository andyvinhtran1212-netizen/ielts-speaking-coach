'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { grammarMode, grammarModeHref } from '@/lib/grammar-navigation-context.mjs';
import { articleUrl } from './grammar-cards';

type DashboardArticle = { slug: string; title: string; category: string };
// Wire shape of `GET /api/grammar/dashboard-data` → `weak_areas[]`
// (backend/routers/grammar.py): keyed by `tag`/`label_vi`, not `slug`/`title`.
type WeakAreaWire = {
  tag?: string | null;
  label_vi?: string | null;
  category?: string | null;
  occurrence_count?: number;
  last_seen_at?: string | null;
  slug?: string | null;
  title?: string | null;
};
type Dashboard = {
  weak_areas?: WeakAreaWire[];
  recently_viewed?: DashboardArticle[];
  saved_articles?: DashboardArticle[];
};
type Roadmap = { mode?: string; weak_count?: number; nodes?: Array<DashboardArticle & { status?: string; is_weak?: boolean }> };

/** Normalize `weak_areas[]` to linkable articles; drop rows that cannot form a real article URL. */
export function normalizeWeakAreas(items: unknown): DashboardArticle[] {
  if (!Array.isArray(items)) return [];
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return items.flatMap((item: WeakAreaWire) => {
    const slug = text(item?.slug) || text(item?.tag);
    const category = text(item?.category);
    if (!slug || !category) return [];
    return [{ slug, category, title: text(item?.title) || text(item?.label_vi) || slug }];
  });
}

export const GROUPS_SECTION_ID = 'groups-section';
const GROUPS_SECTION_HASH = `#${GROUPS_SECTION_ID}`;

export function GrammarModeSwitcher({ reference, learning }: { reference: ReactNode; learning: ReactNode }) {
  const params = useSearchParams();
  const mode = grammarMode(params || undefined);
  const pendingGroupsScroll = useRef(false);
  const setMode = (next: 'reference' | 'learning', hash = '') => {
    window.history.replaceState(null, '', `${grammarModeHref({ mode: next })}${hash}`);
  };

  // The hero CTAs link to #groups-section, which lives in the reference panel.
  // In learning mode that panel is hidden, so switch to reference first and
  // scroll once it has rendered. The plain href stays as the no-JS fallback.
  useEffect(() => {
    if (mode !== 'learning') return;
    const revealGroups = () => {
      pendingGroupsScroll.current = true;
      setMode('reference', GROUPS_SECTION_HASH);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`a[href="${GROUPS_SECTION_HASH}"]`)) return;
      event.preventDefault();
      revealGroups();
    };
    const onHashChange = () => {
      if (window.location.hash === GROUPS_SECTION_HASH) revealGroups();
    };
    onHashChange();
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'reference' || !pendingGroupsScroll.current) return;
    const frame = window.requestAnimationFrame(() => {
      pendingGroupsScroll.current = false;
      document.getElementById(GROUPS_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);
  const selectMode = (next: 'reference' | 'learning') => {
    setMode(next);
    document.getElementById(`grammar-mode-${next}`)?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectMode(event.key === 'ArrowLeft' || event.key === 'Home' ? 'reference' : 'learning');
  };
  return (
    <div>
      <div className="gw-mode-switch" role="tablist" aria-label="Chế độ Grammar Wiki">
        <button id="grammar-mode-reference" type="button" role="tab" aria-controls="grammar-panel-reference" aria-selected={mode === 'reference'} tabIndex={mode === 'reference' ? 0 : -1} onKeyDown={handleKeyDown} onClick={() => setMode('reference')}>
          <span aria-hidden="true">⌕</span><strong>Tra cứu</strong><small>Tìm câu trả lời ngay</small>
        </button>
        <button id="grammar-mode-learning" type="button" role="tab" aria-controls="grammar-panel-learning" aria-selected={mode === 'learning'} tabIndex={mode === 'learning' ? 0 : -1} onKeyDown={handleKeyDown} onClick={() => setMode('learning')}>
          <span aria-hidden="true">↗</span><strong>Học &amp; luyện</strong><small>Đi theo lộ trình của bạn</small>
        </button>
      </div>
      <div id="grammar-panel-reference" role="tabpanel" aria-labelledby="grammar-mode-reference" className="gw-mode-panel" hidden={mode !== 'reference'}>{reference}</div>
      <div id="grammar-panel-learning" role="tabpanel" aria-labelledby="grammar-mode-learning" className="gw-mode-panel" hidden={mode !== 'learning'}>{learning}</div>
    </div>
  );
}

function ArticleList({ title, items, empty }: { title: string; items?: DashboardArticle[]; empty: string }) {
  return (
    <section className="gw-learning-card">
      <h3>{title}</h3>
      {items?.length ? <ul>{items.slice(0, 4).map((item) => (
        <li key={item.slug}><Link href={articleUrl(item.category, item.slug, 'learning')}>{item.title}<span>→</span></Link></li>
      ))}</ul> : <p>{empty}</p>}
    </section>
  );
}

export function GrammarLearningDashboard() {
  const [state, setState] = useState<'loading' | 'guest' | 'ready' | 'error'>('loading');
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [roadmap, setRoadmap] = useState<Roadmap>({});

  useEffect(() => {
    let disposed = false;
    (async () => {
      const ready = await whenGlobalReady(() => !!(window as any).getSupabase && !!window.api?.getWith, 'Grammar learning dashboard');
      if (!ready) throw new Error('API unavailable');
      const sb = (window as any).getSupabase?.();
      const session = await sb?.auth.getSession();
      if (!session?.data?.session) { if (!disposed) setState('guest'); return; }
      const [dashboardData, roadmapData] = await Promise.all([
        window.api.getWith<Dashboard>('/api/grammar/dashboard-data'),
        window.api.getWith<Roadmap>('/api/me/roadmap'),
      ]);
      if (!disposed) { setDashboard(dashboardData || {}); setRoadmap(roadmapData || {}); setState('ready'); }
    })().catch(() => { if (!disposed) setState('error'); });
    return () => { disposed = true; };
  }, []);

  if (state === 'loading') return <div className="skeleton h-56 rounded-2xl" aria-label="Đang tải lộ trình" />;
  if (state === 'guest') return (
    <div className="gw-personal-empty">
      <span className="gw-personal-orbit" aria-hidden="true">◎</span>
      <div><h3>Mở lộ trình cá nhân</h3><p>Đăng nhập để tiếp tục bài vừa đọc, xem bài đã lưu và ưu tiên đúng điểm ngữ pháp còn yếu.</p></div>
      <Link href="/login">Đăng nhập →</Link>
    </div>
  );
  if (state === 'error') return <p className="gw-state-card">Không tải được dữ liệu cá nhân. Nội dung Grammar Wiki vẫn có thể tra cứu bình thường.</p>;

  const nextNodes = roadmap.mode === 'personal' ? roadmap.nodes || [] : [];
  return (
    <div className="gw-learning-dashboard">
      <section className="gw-next-step">
        <div><span className="gw-lab-eyebrow">Bước tiếp theo</span><h3>{nextNodes[0]?.title || 'Làm một bài kiểm tra để dựng lộ trình'}</h3>
          <p>{nextNodes[0] ? (nextNodes[0].is_weak ? 'Điểm yếu được phát hiện từ kết quả luyện tập.' : 'Nền tảng cần củng cố trước điểm yếu tiếp theo.') : 'Hệ thống chỉ cá nhân hóa khi có evidence thật từ bài luyện.'}</p></div>
        <Link href={nextNodes[0] ? articleUrl(nextNodes[0].category, nextNodes[0].slug, 'learning') : '/grammar/exercises'}>{nextNodes[0] ? 'Học tiếp →' : 'Chọn bài luyện →'}</Link>
      </section>
      <div className="gw-learning-grid">
        <ArticleList title="Vừa xem" items={dashboard.recently_viewed} empty="Chưa có lịch sử đọc." />
        <ArticleList title="Đã lưu" items={dashboard.saved_articles} empty="Lưu bài để quay lại nhanh." />
        <ArticleList title="Điểm cần củng cố" items={normalizeWeakAreas(dashboard.weak_areas)} empty="Chưa có lỗi lặp lại đủ để kết luận." />
      </div>
    </div>
  );
}
