'use client';

import { useEffect, useMemo, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { articleUrl, type Article, type Category } from '../grammar-cards';

type PersonalNode = Article & { status?: string; is_weak?: boolean };
type RoadmapPayload = { mode?: string; weak_count?: number; nodes?: PersonalNode[] };

const STATUS_LABEL: Record<string, string> = { weak: 'Điểm yếu', learning: 'Đang học', strong: 'Đã vững', unseen: 'Chưa học' };

export function GrammarRoadmapBehavior({ categories }: { categories: Category[] }) {
  const [selected, setSelected] = useState(categories[0]?.slug || 'foundations');
  const [personal, setPersonal] = useState<RoadmapPayload | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const ready = await whenGlobalReady(() => !!(window as any).getSupabase && !!window.api?.getWith, 'Grammar roadmap');
      if (!ready) return;
      const session = await (window as any).getSupabase?.()?.auth.getSession();
      const active = !!session?.data?.session;
      if (!disposed) { setSignedIn(active); setCheckedAuth(true); }
      if (!active) return;
      const payload = await window.api.getWith<RoadmapPayload>('/api/me/roadmap');
      if (!disposed) {
        setPersonal(payload || {});
        if (payload?.mode === 'personal' && payload.nodes?.length) setSelected('personal');
      }
    })().catch(() => { if (!disposed) setCheckedAuth(true); });
    return () => { disposed = true; };
  }, []);

  const category = useMemo(() => categories.find((item) => item.slug === selected), [categories, selected]);
  const nodes: PersonalNode[] = selected === 'personal' ? personal?.nodes || [] : category?.articles || [];
  const isPersonal = selected === 'personal';

  return (
    <div className="gw-roadmap-workspace">
      <div className="gw-roadmap-controls">
        <label htmlFor="roadmap-track">Lộ trình đang xem</label>
        <select id="roadmap-track" value={selected} onChange={(event) => setSelected(event.target.value)}>
          {signedIn && <option value="personal">Dành cho bạn</option>}
          {categories.map((item) => <option key={item.slug} value={item.slug}>{item.title} · {item.article_count} bài</option>)}
        </select>
      </div>
      {isPersonal && !nodes.length ? <div className="gw-personal-empty"><span className="gw-personal-orbit" aria-hidden="true">◎</span><div><h3>Chưa đủ evidence để cá nhân hóa</h3><p>Làm bài Grammar để hệ thống tìm điểm yếu thật. Chúng mình không tự tạo phần trăm tiến độ khi chưa có dữ liệu.</p></div><a href="/grammar/exercises">Làm bài luyện →</a></div> : (
        <ol className="gw-roadmap-list">
          {nodes.map((node, index) => <li key={node.slug}>
            <span className="gw-roadmap-number">{String(index + 1).padStart(2, '0')}</span>
            <a href={articleUrl(node.category, node.slug)}><small>{isPersonal ? (node.is_weak ? 'Ưu tiên sửa' : 'Học nền trước') : node.level || 'Grammar'}</small><strong>{node.title}</strong><p>{node.summary || (isPersonal ? STATUS_LABEL[node.status || 'unseen'] : '')}</p></a>
            {isPersonal && <span className={`gw-roadmap-status is-${node.status || 'unseen'}`}>{STATUS_LABEL[node.status || 'unseen']}</span>}
          </li>)}
        </ol>
      )}
      {!checkedAuth && <p className="text-sm text-white/35 mt-4">Đang kiểm tra lộ trình cá nhân…</p>}
      {checkedAuth && !signedIn && <p className="gw-roadmap-signin">Đăng nhập để lộ trình tự ưu tiên prerequisite và điểm yếu từ kết quả luyện thật. <a href="/login.html">Đăng nhập →</a></p>}
    </div>
  );
}
