'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { normalizePersonalRoadmap } from '@/lib/personal-roadmap-model.mjs';
import { Button, PageState } from '@/components/ui';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { SubpageFrame, SubpageHeader, frameStyles as styles } from '../subpage-frame';

type RoadmapState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; data: any }
  | { key: string; status: 'error' };

/** Status always carries its word; the tone only repeats it (no colour-only meaning). */
const STATUS = {
  weak: { label: 'Điểm yếu', tone: 'danger' },
  learning: { label: 'Đang học', tone: 'mark' },
  unseen: { label: 'Chưa học', tone: 'muted' },
  strong: { label: 'Đã vững', tone: 'ok' },
} as const;

function EmptyRoadmap() {
  return (
    <PageState
      kind="empty"
      title="Chưa có lộ trình cá nhân"
      body="Làm bài luyện tập để hệ thống phát hiện điểm ngữ pháp cần củng cố — lộ trình sẽ tự dựng theo điểm yếu của bạn."
      action={<Button href="/speaking" variant="primary">Bắt đầu luyện tập</Button>}
    />
  );
}

function ErrorRoadmap() {
  return (
    <div role="alert">
      <PageState
        kind="error"
        title="Không tải được lộ trình"
        body="Đã có lỗi khi tải lộ trình của bạn. Vui lòng thử lại sau ít phút."
        action={<Button type="button" variant="secondary" onClick={() => window.location.reload()}>Thử lại</Button>}
      />
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
    <SubpageFrame crumbs={[{ label: 'Lộ trình' }]}>
      <main id="roadmap-container" tabIndex={-1} className={`${styles.main} ${styles.narrow}`}>
        <SubpageHeader
          eyebrow="Grammar Wiki · Lộ trình"
          title="Lộ trình của bạn"
          titleId="roadmap-title"
          intro={data?.nodes?.length ? `${data.weakCount} điểm cần luyện — củng cố nền tảng trước, rồi tới điểm yếu.` : ''}
          introId="roadmap-subtitle"
        />
        <div id="roadmap-steps" aria-busy={!current || current.status === 'loading' || undefined}>
          {!current || current.status === 'loading' ? <p role="status" className={styles.empty}>Đang tải lộ trình…</p> : null}
          {current?.status === 'error' ? <ErrorRoadmap /> : null}
          {data && !data.nodes.length ? <EmptyRoadmap /> : null}
          {data?.nodes?.length ? (
            <ul className={styles.list}>
              {data.nodes.map((node: any) => {
                const status = STATUS[node.status as keyof typeof STATUS] || STATUS.unseen;
                const content = (
                  <>
                    <span>
                      <span className={styles.nodeTitle}>{node.title}</span>
                      <span className={styles.nodeNote}>{node.isWeak ? 'Điểm yếu cần luyện' : 'Nền tảng cần củng cố trước'}</span>
                    </span>
                    <span className={styles.tag} data-tone={status.tone}>{status.label}</span>
                  </>
                );
                return (
                  <li key={node.slug}>
                    {node.category ? (
                      <Link className={`kp-node ${styles.node}`} href={`/grammar/${encodeURIComponent(node.category)}/${encodeURIComponent(node.slug)}`}>{content}</Link>
                    ) : (
                      <div className={`kp-node ${styles.node}`}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <p className={styles.footer}>
          <Link id="roadmap-cat-link" href="/grammar">Xem toàn bộ Grammar Wiki ›</Link>
        </p>
      </main>
    </SubpageFrame>
  );
}

export function PersonalRoadmap() {
  return <AuthProvider><PersonalRoadmapBody /></AuthProvider>;
}
