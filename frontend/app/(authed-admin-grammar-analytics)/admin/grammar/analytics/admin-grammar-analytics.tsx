'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  formatGrammarAnalyticsMetric,
  grammarAnalyticsArticleHref,
  normalizeGrammarAnalyticsDays,
  normalizeGrammarAnalyticsPayload,
} from '@/lib/admin-grammar-analytics-model.mjs';

type Status = 'complete' | 'unavailable';
type Row = { slug: string; title: string; category: string; count: number };
type Payload = {
  days: number; articlesTotal: number; viewsTotal: number | null; activeRecordsRecent: number | null;
  savesTotal: number | null; zeroViewTotal: number | null; topViewed: Row[] | null;
  topSaved: Row[] | null; zeroViewArticles: Row[] | null;
  status: { views: Status; recentActivity: Status; saves: Status };
};

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : String(value || 'Không đọc được dữ liệu.');
}

function Metric({ label, value, hint, warning = false }: { label: string; value: number | null; hint: string; warning?: boolean }) {
  return <article className={`gax-metric${warning ? ' is-warning' : ''}`}><span>{label}</span><strong>{formatGrammarAnalyticsMetric(value)}</strong><small>{hint}</small></article>;
}

function Ranking({ id, eyebrow, title, rows, metric, unavailable }: { id: string; eyebrow: string; title: string; rows: Row[] | null; metric: string; unavailable: boolean }) {
  return <section className="gax-panel" aria-labelledby={id}>
    <div className="gax-panel-head"><div><p className="gax-eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div><span>{unavailable ? 'Nguồn không khả dụng' : `${rows?.length || 0} kết quả`}</span></div>
    {unavailable ? <div className="gax-empty is-unavailable"><strong>Chưa thể đọc nguồn dữ liệu này</strong><span>Dấu — không có nghĩa là 0. Thử tải lại hoặc kiểm tra backend logs.</span></div>
      : rows?.length ? <div className="gax-table-wrap" role="region" aria-label={title} tabIndex={0}><table><thead><tr><th scope="col">#</th><th scope="col">Article</th><th scope="col">Category</th><th scope="col">{metric}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.slug}><td data-label="#" className="is-rank">{index + 1}</td><td data-label="Article"><a href={grammarAnalyticsArticleHref(row)} target="_blank" rel="noopener noreferrer"><strong>{row.title}</strong><code>{row.slug}</code></a></td><td data-label="Category"><span className="gax-chip">{row.category || '—'}</span></td><td data-label={metric} className="is-number">{formatGrammarAnalyticsMetric(row.count)}</td></tr>)}</tbody></table></div>
        : <div className="gax-empty"><strong>Chưa có dữ liệu</strong><span>Nguồn đã tải thành công nhưng chưa ghi nhận tương tác.</span></div>}
  </section>;
}

export function AdminGrammarAnalytics() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const days = normalizeGrammarAnalyticsDays(params?.get('days'));
  const [snapshot, setSnapshot] = useState<{ key: string; value: Payload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const key = `${profile.id}:${days}`;
  const payload = snapshot?.key === key ? snapshot.value : null;

  const load = useCallback(async (nextDays = days) => {
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const normalized = normalizeGrammarAnalyticsPayload(await window.api.get<unknown>(`/admin/grammar/analytics?days=${nextDays}`)) as Payload | null;
      if (!normalized || normalized.days !== nextDays) throw new Error('Phản hồi Analytics không đúng contract.');
      if (requestId === sequence.current) setSnapshot({ key: `${profile.id}:${nextDays}`, value: normalized });
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [days, profile.id]);

  useEffect(() => { void load(days); return () => { sequence.current += 1; }; }, [days, load]);

  const chooseDays = (nextDays: number) => {
    const url = new URL(window.location.href); url.searchParams.set('days', String(nextDays));
    setLoading(true); router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };

  const degraded = payload && Object.values(payload.status).some((value) => value === 'unavailable');
  return <main className="gax-shell">
    <header className="gax-header"><div><p className="gax-eyebrow">Grammar · Tín hiệu sử dụng</p><h1>Analytics snapshot</h1><p className="gax-subtitle">Đọc số liệu tương tác canonical mà không biến lỗi truy vấn thành số 0.</p></div><div className="gax-actions"><a className="btn-secondary" href="/admin/grammar">← Grammar workspace</a><button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></div></header>

    <section className="gax-window" aria-label="Cửa sổ hoạt động"><div><span className="adm-status-pill is-readonly">READ-ONLY</span><p><strong>Hoạt động gần đây</strong><small>Đếm record học viên–article có lần xem cuối trong cửa sổ; không phải số lượt xem phát sinh theo ngày.</small></p></div><label>Cửa sổ<select value={days} onChange={(event) => chooseDays(Number(event.target.value))}><option value="7">7 ngày</option><option value="14">14 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option></select></label></section>

    {error && <div className="gax-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ snapshot trước đó.' : 'Không tải được Analytics.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Thử lại</button></div>}
    {loading && !payload && <div className="gax-state" role="status">Đang tổng hợp views, saves và content gaps…</div>}
    {degraded && <div className="gax-banner is-warning" role="status"><div><strong>Một phần analytics không khả dụng.</strong><span>{payload.status.views === 'unavailable' ? 'Views và content gaps đang là —. ' : ''}{payload.status.recentActivity === 'unavailable' ? 'Hoạt động gần đây đang là —. ' : ''}{payload.status.saves === 'unavailable' ? 'Saves đang là —. ' : ''}</span></div></div>}

    {payload && <>
      <section className="gax-metrics" aria-label="Số liệu Grammar chính"><Metric label="Articles đã phát hành" value={payload.articlesTotal} hint="Nguồn Markdown canonical" /><Metric label="Tổng lượt xem" value={payload.viewsTotal} hint="Cộng dồn view_count" /><Metric label={`Record hoạt động · ${payload.days} ngày`} value={payload.activeRecordsRecent} hint="Học viên × article" /><Metric label="Tổng lượt lưu" value={payload.savesTotal} hint="Saved records hiện tại" /><Metric label="Articles chưa có view" value={payload.zeroViewTotal} hint={`Trong ${payload.articlesTotal} articles`} warning={Boolean(payload.zeroViewTotal)} /></section>
      <div className="gax-rankings"><Ranking id="gax-top-views" eyebrow="Mức độ khám phá" title="Top articles theo views" rows={payload.topViewed} metric="Views" unavailable={payload.status.views === 'unavailable'} /><Ranking id="gax-top-saves" eyebrow="Ý định quay lại" title="Top articles được lưu" rows={payload.topSaved} metric="Saves" unavailable={payload.status.saves === 'unavailable'} /></div>
      <Ranking id="gax-zero-views" eyebrow="Content gap signal · tối đa 30" title="Articles chưa ghi nhận view" rows={payload.zeroViewArticles} metric="Views" unavailable={payload.status.views === 'unavailable'} />
    </>}
  </main>;
}
