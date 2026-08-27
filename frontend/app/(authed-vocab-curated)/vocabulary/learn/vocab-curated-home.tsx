'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface UnitSummary {
  id: string;
  unit_slug: string;
  display_headword: string;
  unit_type: 'learning_unit' | 'clinic';
  target_level: string;
  title_vi: string;
  learning_goal_vi: string;
  estimated_minutes?: number | null;
  problem_tags: string[];
}

interface TodayPayload {
  recommendations?: Array<{ id: string; reason_vi: string; unit: UnitSummary }>;
  due?: Array<{ dimension: string; state: string; unit: UnitSummary }>;
  discover?: UnitSummary[];
}

interface Pathway {
  id: string;
  pathway_slug: string;
  title_vi: string;
  description_vi: string;
  target_level: string;
  units: Array<{ sequence: number; rationale_vi?: string | null; unit: UnitSummary }>;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'locked' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; today: TodayPayload; pathways: Pathway[] };

function UnitCard({ unit, reason, badge }: { unit: UnitSummary; reason?: string; badge?: string }) {
  return (
    <a className="vc-unit-card" href={`/vocabulary/learn/${encodeURIComponent(unit.unit_slug)}`}>
      <div className="vc-unit-meta">
        <span>{badge || unit.target_level}</span>
        <span>{unit.estimated_minutes ? `${unit.estimated_minutes} phút` : 'Learning unit'}</span>
      </div>
      <h3>{unit.title_vi || unit.display_headword}</h3>
      <p>{reason || unit.learning_goal_vi}</p>
      <strong>Học để dùng <span aria-hidden="true">→</span></strong>
    </a>
  );
}

export function VocabCuratedHome() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' ? user?.id : null;
  const [state, setState] = useState<ViewState>({ kind: 'loading' });

  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (!accountKey) return;
    const controller = new AbortController();
    let disposed = false;
    setState({ kind: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocab curated)');
      if (!ready || disposed) return;
      try {
        const me = await window.api.getWith<{ vocab_curated_enabled?: unknown }>(
          '/auth/me', undefined, { signal: controller.signal },
        );
        if (disposed) return;
        if (me?.vocab_curated_enabled !== true) {
          setState({ kind: 'locked' });
          return;
        }
        const [today, pathways] = await Promise.all([
          window.api.getWith<TodayPayload>('/api/me/vocabulary/today', undefined, { signal: controller.signal }),
          window.api.getWith<{ pathways?: Pathway[] }>('/api/vocabulary/pathways', undefined, { signal: controller.signal }),
        ]);
        if (!disposed) setState({
          kind: 'ready', today: today || {},
          pathways: Array.isArray(pathways?.pathways) ? pathways.pathways : [],
        });
      } catch (error: unknown) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ kind: 'error', message: 'Chưa tải được lộ trình học từ. Vui lòng thử lại.' });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, status]);

  if (state.kind === 'loading') return <section className="vc-state" aria-live="polite">Đang chuẩn bị nội dung phù hợp với bạn…</section>;
  if (state.kind === 'locked') return (
    <section className="vc-state">
      <h2>Chưa mở cho tài khoản này</h2>
      <p>Vocab Curated đang được thử nghiệm theo nhóm nhỏ để bảo đảm chất lượng nội dung và đo hiệu quả học thật.</p>
      <a className="av-button av-button-primary" href="/vocabulary/hub">Quay lại Vocabulary</a>
    </section>
  );
  if (state.kind === 'error') return <section className="vc-state is-error" role="alert">{state.message}</section>;

  const recommendations = state.today.recommendations || [];
  const due = state.today.due || [];
  const discover = state.today.discover || [];
  return (
    <div className="vc-home-sections">
      {recommendations.length ? (
        <section className="vc-section" aria-labelledby="vc-for-you">
          <div className="vc-section-head"><div><p>For You</p><h2 id="vc-for-you">Từ lỗi thật trong bài nói của bạn</h2></div><span>{recommendations.length} đề xuất</span></div>
          <div className="vc-grid">{recommendations.map((item) => <UnitCard key={item.id} unit={item.unit} reason={item.reason_vi} badge="Được đề xuất" />)}</div>
        </section>
      ) : null}

      {due.length ? (
        <section className="vc-section" aria-labelledby="vc-review">
          <div className="vc-section-head"><div><p>Review</p><h2 id="vc-review">Đến lúc gọi lại và dùng lại</h2></div><span>{due.length} mục</span></div>
          <div className="vc-grid">{due.map((item, index) => <UnitCard key={`${item.unit.id}:${item.dimension}:${index}`} unit={item.unit} badge="Cần ôn" reason={`Ôn lại ${item.dimension.replaceAll('_', ' ')} để tránh quên.`} />)}</div>
        </section>
      ) : null}

      <section className="vc-section" aria-labelledby="vc-discover">
        <div className="vc-section-head"><div><p>Start small</p><h2 id="vc-discover">Một learning unit đáng học hôm nay</h2></div></div>
        {discover.length ? <div className="vc-grid">{discover.map((unit) => <UnitCard key={unit.id} unit={unit} />)}</div> : <p className="vc-empty">Bạn đã xử lý hết nội dung đang mở. Hãy quay lại đúng lịch ôn tiếp theo.</p>}
      </section>

      {state.pathways.length ? (
        <section className="vc-section" aria-labelledby="vc-paths">
          <div className="vc-section-head"><div><p>Paths</p><h2 id="vc-paths">Lộ trình theo vấn đề, không phải danh sách từ ngẫu nhiên</h2></div></div>
          <div className="vc-paths">{state.pathways.map((path) => (
            <article className="vc-path" key={path.id}>
              <span>{path.target_level} · {path.units.length} units</span>
              <h3>{path.title_vi}</h3><p>{path.description_vi}</p>
              <ol>{path.units.slice(0, 4).map((item) => <li key={item.unit.id}><a href={`/vocabulary/learn/${encodeURIComponent(item.unit.unit_slug)}`}>{item.unit.display_headword}</a></li>)}</ol>
            </article>
          ))}</div>
        </section>
      ) : null}
    </div>
  );
}
