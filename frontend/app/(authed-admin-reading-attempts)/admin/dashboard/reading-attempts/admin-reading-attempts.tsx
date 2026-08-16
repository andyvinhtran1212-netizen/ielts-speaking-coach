'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { formatReadingCount, formatReadingDate, normalizeReadingAttemptsPayload } from '@/lib/admin-reading-attempts-model.mjs';

type WindowDays = 7 | 30 | 90;
type Payload = NonNullable<ReturnType<typeof normalizeReadingAttemptsPayload>>;

const SKILL_LABEL: Record<string, string> = {
  skimming: 'Đọc lướt', scanning: 'Định vị thông tin', detail: 'Chi tiết', main_idea: 'Ý chính',
  inference: 'Suy luận', vocabulary_in_context: 'Từ vựng theo ngữ cảnh', reference_cohesion: 'Liên kết tham chiếu',
  writer_view_TFNG: 'Quan điểm T/F/NG',
};

const LOOKUP_FAILURE_LABEL: Record<string, string> = {
  all_time_count: 'tổng lượt toàn thời gian',
  window_count: 'phép đếm độc lập trong cửa sổ',
  test_titles: 'tên đề Reading',
  recent_identities: 'danh tính lượt nộp gần đây',
};

function parseDays(value: string | null): WindowDays {
  return value === '7' || value === '90' ? Number(value) as WindowDays : 30;
}

function Distribution({ rows, partial }: { rows: Payload['bands']; partial: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (!rows.length) return <div className="ara-empty"><strong>Chưa có phân bố band</strong><span>Không có lượt nộp hợp lệ trong cửa sổ này.</span></div>;
  return <div className="ara-bars" role="region" aria-label={`Phân bố band${partial ? ', dữ liệu chưa đầy đủ' : ''}`} tabIndex={0}>
    {rows.map((row) => <div className="ara-bar" key={row.band}>
      <span>Band {row.band}</span><div aria-hidden="true"><i style={{ width: `${Math.max(3, Math.round(row.count / max * 100))}%` }} /></div><strong>{formatReadingCount(row.count, partial)}</strong>
    </div>)}
    <table className="ara-sr-table"><caption>Phân bố band</caption><thead><tr><th>Band</th><th>Lượt</th></tr></thead><tbody>{rows.map((row) => <tr key={row.band}><td>{row.band}</td><td>{formatReadingCount(row.count, partial)}</td></tr>)}</tbody></table>
  </div>;
}

export function AdminReadingAttempts() {
  const profile = useAdminProfile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const days = parseDays(searchParams?.get('days') || null);
  const [snapshot, setSnapshot] = useState<{ key: string; value: Payload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const currentKey = `${profile.id}:${days}`;
  const payload = snapshot?.key === currentKey ? snapshot.value : null;

  const load = useCallback(async (nextDays: WindowDays) => {
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const normalized = normalizeReadingAttemptsPayload(await window.api.get<unknown>(`/admin/dashboard/reading-attempts?days=${nextDays}`));
      if (!normalized || normalized.windowDays !== nextDays) throw new Error('Phản hồi máy chủ không đúng phạm vi');
      if (requestId === sequence.current) setSnapshot({ key: `${profile.id}:${nextDays}`, value: normalized });
    } catch {
      if (requestId === sequence.current) setError('Không thể đọc dữ liệu lượt làm bài từ máy chủ. Vui lòng thử lại.');
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    void load(days);
    return () => { sequence.current += 1; };
  }, [days, load]);

  const chooseWindow = (nextDays: WindowDays) => {
    const url = new URL(window.location.href);
    if (nextDays === 30) url.searchParams.delete('days'); else url.searchParams.set('days', String(nextDays));
    const target = `${url.pathname}${url.search}${url.hash}`;
    const targetKey = `${profile.id}:${nextDays}`;
    if (target !== `${window.location.pathname}${window.location.search}${window.location.hash}`) router.replace(target, { scroll: false });
    if (targetKey === currentKey) void load(nextDays); else setLoading(true);
  };

  const coveragePartial = Boolean(payload && (
    payload.totals.truncated
    || payload.malformedCount > 0
    || payload.lookupFailures.includes('window_count')
  ));
  const windowTotalLowerBound = Boolean(payload?.lookupFailures.includes('window_count'));
  const lowerBound = coveragePartial;
  return <main className="ara-shell">
    <header className="ara-header"><div><p className="ara-eyebrow">Tổng quan · Reading</p><h1>Lượt làm bài Reading</h1><p>Theo dõi lượt nộp, nguồn truy cập, phân bố band và các kỹ năng cần hỗ trợ — trên cùng một snapshot UTC.</p></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load(days)}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></header>

    <section className="ara-toolbar" aria-label="Cửa sổ số liệu"><div role="group" aria-label="Số ngày">{([7, 30, 90] as WindowDays[]).map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => chooseWindow(value)}>{value} ngày</button>)}</div><p>{payload ? `Snapshot ${formatReadingDate(payload.snapshotTo)}` : 'Đang chờ snapshot dữ liệu'}</p></section>

    {error && <div className="ara-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ snapshot trước đó.' : 'Không tải được lượt làm bài.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load(days)}>Thử lại</button></div>}
    {loading && !payload && <div className="ara-state" role="status">Đang tổng hợp lượt làm bài…</div>}
    {payload?.status === 'unavailable' && <div className="ara-state is-error" role="alert"><strong>Dữ liệu lượt làm bài hiện không khả dụng</strong><span>Nguồn lượt nộp không đọc được; dấu — không có nghĩa là 0.</span></div>}
    {coveragePartial && <div className="ara-banner is-warning" role="status"><div><strong>Snapshot chưa đầy đủ.</strong><span>Các thống kê suy ra từ phần dữ liệu đã đọc là cận dưới (≥); tỷ lệ và trung bình được ẩn để tránh kết luận từ mẫu thiếu.</span></div></div>}
    {!!payload?.malformedCount && <div className="ara-banner is-warning" role="status"><div><strong>Có dữ liệu sai định dạng.</strong><span>{payload.malformedCount} dòng hoặc nhóm kỹ năng không an toàn đã bị loại.</span></div></div>}
    {!!payload?.lookupFailures.length && <div className="ara-banner is-warning" role="status"><div><strong>Một số nguồn phụ không đọc được.</strong><span>{payload.lookupFailures.map((source: string) => LOOKUP_FAILURE_LABEL[source] || source).join(', ')} — trường bị ảnh hưởng được giữ ở trạng thái chưa biết hoặc cận dưới.</span></div></div>}

    {payload && payload.status !== 'unavailable' && <>
      <section className="ara-summary" aria-label="Tổng quan lượt làm bài">
        <article><span>Lượt nộp trong {days} ngày</span><strong>{formatReadingCount(payload.totals.submittedWindow, windowTotalLowerBound)}</strong><small>{formatReadingCount(payload.totals.authAttempts, lowerBound)} đăng nhập · {formatReadingCount(payload.totals.anonAttempts, lowerBound)} ẩn danh</small></article>
        <article><span>Người học đăng nhập</span><strong>{formatReadingCount(payload.totals.authDistinctUsers, lowerBound)}</strong><small>{coveragePartial ? 'Cận dưới trong phần đã đọc' : 'Người dùng riêng biệt, chính xác'}</small></article>
        <article><span>Nguồn ẩn danh</span><strong>{formatReadingCount(payload.totals.anonDistinctSources, lowerBound, true)}</strong><small>Ước lượng từ IP đã băm; không phải danh tính</small></article>
        <article><span>Thời gian làm bài</span><strong>{coveragePartial || payload.timeStats.avgMinutes == null ? '—' : `${payload.timeStats.avgMinutes} phút`}</strong><small>{coveragePartial || payload.timeStats.medianMinutes == null ? 'Không kết luận từ dữ liệu thiếu' : `Trung vị ${payload.timeStats.medianMinutes} phút · ${payload.timeStats.count} lượt có giờ`}</small></article>
      </section>
      <p className="ara-context">Khoảng UTC: {formatReadingDate(payload.windowStart)} → {formatReadingDate(payload.snapshotTo)} · Toàn thời gian: {formatReadingCount(payload.totals.submittedAllTime, payload.lookupFailures.includes('all_time_count'))}</p>

      <div className="ara-grid">
        <section className="ara-panel"><div className="ara-panel-head"><div><p>Kết quả</p><h2>Phân bố band</h2></div><span>{coveragePartial ? 'Cận dưới' : `${payload.bands.reduce((sum, row) => sum + row.count, 0)} lượt có band`}</span></div><Distribution rows={payload.bands} partial={coveragePartial} /></section>
        <section className="ara-panel"><div className="ara-panel-head"><div><p>Chẩn đoán</p><h2>Kỹ năng cần hỗ trợ</h2></div><span>{coveragePartial ? 'Ẩn tỷ lệ do mẫu thiếu' : 'Yếu nhất trước'}</span></div>{coveragePartial ? <div className="ara-empty"><strong>Chưa thể xếp hạng kỹ năng</strong><span>Thu hẹp cửa sổ để nhận một snapshot đầy đủ.</span></div> : !payload.skills.length ? <div className="ara-empty"><strong>Chưa có dữ liệu kỹ năng</strong><span>Cần ít nhất một lượt được chấm theo kỹ năng.</span></div> : <ol className="ara-skills">{payload.skills.map((row, index) => <li key={row.skillTag} className={index < 2 ? 'is-weak' : ''}><div><strong>{SKILL_LABEL[row.skillTag] || row.skillTag}</strong><span>{row.correct}/{row.total} câu đúng</span></div><b>{row.accuracy == null ? '—' : `${Math.round(row.accuracy * 100)}%`}</b></li>)}</ol>}</section>
      </div>

      <section className="ara-panel"><div className="ara-panel-head"><div><p>Nội dung</p><h2>Lượt theo đề</h2></div><span>{formatReadingCount(payload.perTest.length, lowerBound)} đề</span></div>{!payload.perTest.length ? <div className="ara-empty"><strong>Chưa có lượt nộp trong cửa sổ này</strong><span>Chọn cửa sổ dài hơn để kiểm tra.</span></div> : <div className="ara-table-wrap" role="region" aria-label="Bảng lượt làm theo đề" tabIndex={0}><table className="ara-table"><thead><tr><th>Đề</th><th>Lượt</th><th>Đăng nhập</th><th>Ẩn danh</th><th>Band TB</th></tr></thead><tbody>{payload.perTest.map((row) => <tr key={row.testId}><td data-label="Đề"><strong>{row.title}</strong><small>{row.testId}</small></td><td data-label="Lượt">{formatReadingCount(row.attempts, lowerBound)}</td><td data-label="Đăng nhập">{formatReadingCount(row.auth, lowerBound)}</td><td data-label="Ẩn danh">{formatReadingCount(row.anon, lowerBound)}</td><td data-label="Band TB">{coveragePartial || row.avgBand == null ? '—' : row.avgBand}</td></tr>)}</tbody></table></div>}</section>

      <section className="ara-panel"><div className="ara-panel-head"><div><p>Hoạt động</p><h2>Lượt nộp gần đây</h2></div><span>Tối đa 20 lượt trong snapshot</span></div>{!payload.recent.length ? <div className="ara-empty"><strong>Chưa có lượt nộp gần đây</strong><span>Danh sách sẽ xuất hiện khi có bài được nộp.</span></div> : <div className="ara-table-wrap" role="region" aria-label="Bảng lượt nộp gần đây" tabIndex={0}><table className="ara-table is-recent"><thead><tr><th>Thời điểm</th><th>Đề</th><th>Người làm</th><th>Band</th><th>Thời gian</th></tr></thead><tbody>{payload.recent.map((row, index) => <tr key={`${row.submittedAt}:${index}`}><td data-label="Thời điểm"><time dateTime={row.submittedAt}>{formatReadingDate(row.submittedAt)}</time></td><td data-label="Đề">{row.testTitle}</td><td data-label="Người làm"><span className={`ara-pill ${row.isAnonymous ? 'is-anon' : 'is-auth'}`}>{row.isAnonymous ? 'Ẩn danh' : row.who}</span></td><td data-label="Band">{row.band ?? '—'}</td><td data-label="Thời gian">{row.timeMinutes == null ? '—' : `${row.timeMinutes} phút`}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </main>;
}
