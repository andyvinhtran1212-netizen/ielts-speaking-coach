'use client';

import { useEffect, useState } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { normalizePersonalRoadmap } from '@/lib/personal-roadmap-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type RoadmapState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; data: any }
  | { key: string; status: 'error' };

const STATUS = {
  weak: { label: 'Điểm yếu', color: 'var(--av-error)', soft: 'var(--av-error-soft)' },
  learning: { label: 'Đang học', color: 'var(--av-warning)', soft: 'var(--av-warning-soft)' },
  unseen: { label: 'Chưa học', color: 'var(--av-text-muted)', soft: 'var(--av-surface-sunken)' },
  strong: { label: 'Đã vững', color: 'var(--av-success)', soft: 'var(--av-success-soft)' },
} as const;

function Breadcrumb() {
  return (
    <nav className="gw-subnav sticky top-0 z-20 border-b border-white/5" aria-label="Grammar Wiki"
      style={{ background: 'var(--av-surface-sunken)', backdropFilter: 'blur(12px)' }}>
      <div className="av-w-page h-12 flex items-center">
        <div id="breadcrumb" className="flex items-center text-sm text-white/40 flex-wrap gap-0">
          <a href="/grammar" className="hover:text-teal-light transition-colors">Grammar Wiki</a>
          <span className="mx-2 text-white/20">›</span>
          <span className="text-white/80">Lộ trình</span>
        </div>
      </div>
    </nav>
  );
}

function EmptyRoadmap() {
  return (
    <div style={{ padding: 'var(--av-space-8)', textAlign: 'center', border: '1px dashed var(--av-border-default)', borderRadius: 'var(--av-radius-lg)', background: 'var(--av-surface-card)' }}>
      <p style={{ color: 'var(--av-text-primary)', fontWeight: 600, marginBottom: 'var(--av-space-2)' }}>Chưa có lộ trình cá nhân</p>
      <p style={{ color: 'var(--av-text-muted)', fontSize: 'var(--av-fs-sm)', marginBottom: 'var(--av-space-6)' }}>
        Làm bài luyện tập để hệ thống phát hiện điểm ngữ pháp cần củng cố — lộ trình sẽ tự dựng theo điểm yếu của bạn.
      </p>
      <a href="/speaking" className="btn-primary">Bắt đầu luyện tập</a>
    </div>
  );
}

function ErrorRoadmap() {
  return (
    <div role="alert" style={{ padding: 'var(--av-space-8)', textAlign: 'center', border: '1px solid var(--av-border-default)', borderRadius: 'var(--av-radius-lg)', background: 'var(--av-surface-card)' }}>
      <p style={{ color: 'var(--av-error)', fontWeight: 600, marginBottom: 'var(--av-space-2)' }}>Không tải được lộ trình</p>
      <p style={{ color: 'var(--av-text-muted)', fontSize: 'var(--av-fs-sm)', marginBottom: 'var(--av-space-6)' }}>
        Đã có lỗi khi tải lộ trình của bạn. Vui lòng thử lại sau ít phút.
      </p>
      <button type="button" onClick={() => window.location.reload()} className="btn-primary">Thử lại</button>
    </div>
  );
}

function PersonalRoadmapBody() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [state, setState] = useState<RoadmapState | null>(null);
  const current = state?.key === requestKey ? state : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setState(null);
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let disposed = false;
    setState({ key: requestKey, status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (personal roadmap)');
      if (!ready || disposed) {
        if (!disposed) setState({ key: requestKey, status: 'error' });
        return;
      }
      try {
        const payload = await window.api.getWith('/api/me/roadmap', undefined, { signal: controller.signal });
        if (payload == null || disposed) return;
        const data = normalizePersonalRoadmap(payload);
        if (!disposed) setState({ key: requestKey, status: 'ready', data });
      } catch (caught) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setState({ key: requestKey, status: 'error' });
        }
      }
    })();

    return () => { disposed = true; controller.abort(); };
  }, [requestKey]);

  const data = current?.status === 'ready' ? current.data : null;
  return (
    <>
      <Breadcrumb />
      <main id="roadmap-container" className="av-w-page py-8 ds-fadein">
        <div className="mb-8">
          <p className="eyebrow">Grammar Wiki</p>
          <h1 id="roadmap-title" className="text-2xl font-extrabold text-white mb-1">Lộ trình của bạn</h1>
          <p id="roadmap-subtitle" className="text-sm text-white/40">
            {data?.nodes?.length ? `${data.weakCount} điểm cần luyện — củng cố nền tảng trước, rồi tới điểm yếu.` : ''}
          </p>
        </div>
        <div id="roadmap-steps" className="mb-10">
          {!current || current.status === 'loading' ? <p className="text-white/40 text-sm py-8 text-center">Đang tải lộ trình…</p> : null}
          {current?.status === 'error' ? <ErrorRoadmap /> : null}
          {data && !data.nodes.length ? <EmptyRoadmap /> : null}
          {data?.nodes?.map((node: any) => {
            const style = STATUS[node.status as keyof typeof STATUS];
            const content = (
              <>
                <span aria-hidden="true" style={{ flex: 'none', width: 10, height: 10, borderRadius: 999, background: style.color }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--av-text-primary)' }}>{node.title}</span>
                  <span style={{ display: 'block', fontSize: 'var(--av-fs-xs)', color: 'var(--av-text-muted)', marginTop: 2 }}>
                    {node.isWeak ? 'Điểm yếu cần luyện' : 'Nền tảng cần củng cố trước'}
                  </span>
                </span>
                <span style={{ flex: 'none', fontSize: 'var(--av-fs-xs)', fontWeight: 600, padding: '2px 10px', borderRadius: 999, color: style.color, background: style.soft }}>{style.label}</span>
              </>
            );
            const shared = { display: 'flex', alignItems: 'center', gap: 'var(--av-space-4)', padding: 'var(--av-space-4)', marginBottom: 'var(--av-space-3)', border: '1px solid var(--av-border-default)', borderLeft: `3px solid ${style.color}`, borderRadius: 'var(--av-radius-lg)', background: 'var(--av-surface-card)', textDecoration: 'none' } as const;
            return node.category ? (
              <a className="kp-node" style={shared} href={`/grammar/${encodeURIComponent(node.category)}/${encodeURIComponent(node.slug)}`} key={node.slug}>{content}</a>
            ) : (
              <div className="kp-node" style={shared} key={node.slug}>{content}</div>
            );
          })}
        </div>
        <div className="border-t border-white/6 pt-6">
          <a id="roadmap-cat-link" href="/grammar" className="text-sm text-teal-light hover:underline">Xem toàn bộ Grammar Wiki →</a>
        </div>
      </main>
    </>
  );
}

export function PersonalRoadmap() {
  return <AuthProvider><PersonalRoadmapBody /></AuthProvider>;
}
