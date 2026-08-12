'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  dateInputToIso,
  defaultTrafficDates,
  formatTrafficCount,
  formatTrafficDate,
  normalizeFootTrafficPayload,
} from '@/lib/admin-foot-traffic-model.mjs';

import type { FootTrafficPayload, TrafficDay } from './admin-foot-traffic-types';

function DailyChart({ rows, partial }: { rows: TrafficDay[]; partial: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.views));
  if (!rows.length) return <div className="aft-empty"><strong>Chưa có lượt xem trong khoảng này</strong><span>Thử mở rộng khoảng ngày hoặc bỏ lọc đường dẫn.</span></div>;
  return <div className="aft-chart" role="region" aria-label={`Biểu đồ lượt xem theo ngày UTC${partial ? ', số liệu chưa đầy đủ' : ''}`} tabIndex={0}>
    {rows.map((row) => <div className="aft-bar" key={row.date} aria-hidden="true">
      <span className="aft-bar-value" title={formatTrafficCount(row.views, partial)}>{formatTrafficCount(row.views, partial)}</span>
      <div className="aft-bar-track"><span style={{ height: `${Math.max(3, Math.round((row.views / max) * 100))}%` }} /></div>
      <time dateTime={row.date}>{row.date.slice(5)}</time>
    </div>)}<table className="aft-sr-table"><caption>Lượt xem theo ngày UTC</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Lượt xem</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}</td><td>{formatTrafficCount(row.views, partial)}</td></tr>)}</tbody></table>
  </div>;
}

export function AdminFootTraffic() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const defaults = useMemo(() => defaultTrafficDates(), []);
  const urlFrom = searchParams?.get('from') || defaults.from;
  const urlTo = searchParams?.get('to') || defaults.to;
  const urlRoute = searchParams?.get('route') || '';
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  const [routeFilter, setRouteFilter] = useState(urlRoute);
  const [snapshot, setSnapshot] = useState<{ key: string; value: FootTrafficPayload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const makeKey = (nextFrom: string, nextTo: string, nextRoute: string) => `${profile.id}:${nextFrom}:${nextTo}:${nextRoute.trim()}`;
  const currentKey = makeKey(urlFrom, urlTo, urlRoute);
  const payload = snapshot?.key === currentKey ? snapshot.value : null;

  const load = useCallback(async (nextFrom = urlFrom, nextTo = urlTo, nextRoute = urlRoute) => {
    const requestId = ++sequence.current;
    const fromIso = dateInputToIso(nextFrom);
    const toIso = dateInputToIso(nextTo, true);
    if (!fromIso || !toIso || fromIso > toIso) {
      setError('Khoảng ngày không hợp lệ. Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date_from: fromIso, date_to: toIso });
      if (nextRoute.trim()) params.set('route', nextRoute.trim());
      const normalized = normalizeFootTrafficPayload(await window.api.get<unknown>(`/admin/analytics/foot-traffic?${params}`));
      if (!normalized) throw new Error('invalid payload');
      if ((normalized.route || '') !== nextRoute.trim()
          || !normalized.dateFrom || Date.parse(normalized.dateFrom) !== Date.parse(fromIso)
          || !normalized.dateTo || Date.parse(normalized.dateTo) !== Date.parse(toIso)) {
        throw new Error('response scope mismatch');
      }
      if (requestId === sequence.current) setSnapshot({ key: makeKey(nextFrom, nextTo, nextRoute), value: normalized as FootTrafficPayload });
    } catch {
      if (requestId === sequence.current) setError('Không thể đọc dữ liệu lưu lượng từ máy chủ. Vui lòng thử lại.');
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [profile.id, urlFrom, urlRoute, urlTo]);

  useEffect(() => {
    setFrom(urlFrom); setTo(urlTo); setRouteFilter(urlRoute);
    void load(urlFrom, urlTo, urlRoute);
    return () => { sequence.current += 1; };
  }, [load, urlFrom, urlTo, urlRoute]);

  const apply = () => {
    const fromIso = dateInputToIso(from);
    const toIso = dateInputToIso(to, true);
    if (!fromIso || !toIso || fromIso > toIso) {
      setError('Khoảng ngày không hợp lệ. Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      return;
    }
    const url = new URL(window.location.href);
    if (from === defaults.from) url.searchParams.delete('from'); else url.searchParams.set('from', from);
    if (to === defaults.to) url.searchParams.delete('to'); else url.searchParams.set('to', to);
    if (routeFilter.trim()) url.searchParams.set('route', routeFilter.trim()); else url.searchParams.delete('route');
    const target = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetKey = makeKey(from, to, routeFilter);
    if (target !== current) window.history.replaceState(null, '', target);
    if (targetKey === currentKey) void load(from, to, routeFilter);
    else setLoading(true);
  };

  const partial = payload?.status === 'partial';
  return <main className="aft-shell">
    <header className="aft-header"><div><p className="aft-eyebrow">Vận hành · Phân tích</p><h1>Lưu lượng truy cập</h1><p className="aft-subtitle">Theo dõi lượt xem trang, khách đăng nhập và lưu lượng ẩn danh. Đây là event traffic, không phải số phiên học.</p></div><button className="btn-secondary" type="button" onClick={() => void load(urlFrom, urlTo, urlRoute)} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></header>

    <section className="aft-filters" aria-label="Bộ lọc lưu lượng">
      <label>Từ ngày<input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Đến ngày<input aria-label="Đến ngày" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="aft-route-filter">Đường dẫn<input aria-label="Đường dẫn" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)} placeholder="Ví dụ /home" /></label>
      <button className="btn-primary" type="button" onClick={apply} disabled={loading}>Áp dụng</button>
    </section>

    {error && <div className="aft-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ số liệu trước đó.' : 'Không tải được lưu lượng.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" onClick={apply} disabled={loading}>Thử lại</button></div>}
    {loading && !payload && <div className="aft-state" role="status">Đang tổng hợp lượt xem…</div>}
    {payload?.status === 'unavailable' && <div className="aft-state is-error" role="alert"><strong>Số liệu hiện không khả dụng</strong><span>Nguồn analytics không đọc được; dấu — không có nghĩa là 0 lượt xem.</span></div>}

    {payload && payload.status !== 'unavailable' && <>
      {partial && <div className="aft-banner is-warning" role="status"><div><strong>Số liệu chưa đầy đủ.</strong><span>Khoảng này chạm giới hạn đọc hoặc gián đoạn giữa chừng. Các tổng được hiển thị với dấu ≥; hãy thu hẹp khoảng ngày.</span></div></div>}
      {payload.malformedCount > 0 && <div className="aft-banner is-warning" role="status"><div><strong>Một phần dữ liệu không hợp lệ đã bị loại.</strong><span>{payload.malformedCount} điểm dữ liệu sai định dạng không được đưa vào biểu đồ hoặc bảng.</span></div></div>}
      <section className="aft-summary" aria-label="Tổng quan lưu lượng">
        <div><span>Tổng lượt xem</span><strong>{formatTrafficCount(payload.totalViews, partial)}</strong></div>
        <div><span>Khách đăng nhập duy nhất</span><strong>{formatTrafficCount(payload.uniqueVisitors, partial)}</strong></div>
        <div><span>Lượt ẩn danh</span><strong>{formatTrafficCount(payload.anonymousHits, partial)}</strong></div>
      </section>
      <p className="aft-context">{payload.route ? <>Đang lọc chính xác <code>{payload.route}</code> · </> : 'Toàn bộ đường dẫn · '}Dữ liệu UTC đến {formatTrafficDate(payload.effectiveTo)}</p>
      <section className="aft-panel"><div className="aft-panel-head"><div><p>Xu hướng</p><h2>Lượt xem theo ngày (UTC)</h2></div><span>{payload.daily.length} ngày có dữ liệu</span></div><DailyChart rows={payload.daily} partial={partial} /></section>
      <section className="aft-panel"><div className="aft-panel-head"><div><p>Xếp hạng</p><h2>Trang xem nhiều nhất</h2></div><span>Tối đa 10 đường dẫn</span></div>
        {payload.topPages.length ? <div className="aft-table-wrap" role="region" aria-label="Bảng trang xem nhiều nhất" tabIndex={0}><table className="aft-table"><thead><tr><th scope="col">Đường dẫn</th><th scope="col">Lượt xem</th><th scope="col">Tỷ trọng</th></tr></thead><tbody>{payload.topPages.map((row) => <tr key={row.path}><td data-label="Đường dẫn"><code>{row.path}</code></td><td data-label="Lượt xem" className="is-number">{formatTrafficCount(row.views, partial)}</td><td data-label="Tỷ trọng"><div className="aft-share"><span style={{ width: `${payload.totalViews ? Math.min(100, row.views / payload.totalViews * 100) : 0}%` }} /></div></td></tr>)}</tbody></table></div> : <div className="aft-empty"><strong>Chưa có đường dẫn nào</strong><span>Không có page-view phù hợp với bộ lọc hiện tại.</span></div>}
      </section>
    </>}
  </main>;
}
