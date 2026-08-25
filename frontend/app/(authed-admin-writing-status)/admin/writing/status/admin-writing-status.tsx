'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import {
  isWritingStatusTerminal,
  normalizeWritingStatusPayload,
  normalizeWritingStatusQuery,
  writingStatusHref,
  writingStatusPhase,
  writingStatusProgress,
} from '@/lib/admin-writing-status-model.mjs';

import type { WritingStatusName, WritingStatusPayload } from './admin-writing-status-types';

const POLL_MS = 5000;
const STATUS_COPY: Record<WritingStatusName, { label: string; title: string; detail: string }> = {
  pending: { label: 'Đang xếp hàng', title: 'Chờ worker nhận bài', detail: 'Yêu cầu chấm đã được ghi nhận và đang chờ tài nguyên xử lý.' },
  grading: { label: 'Đang chấm', title: 'AI đang xử lý bài viết', detail: 'Bạn có thể chuyển sang tab khác; tiến trình vẫn tiếp tục ở máy chủ.' },
  graded: { label: 'Cần duyệt', title: 'Bản chấm đã sẵn sàng', detail: 'Mở workspace để kiểm tra feedback trước khi trả cho học viên.' },
  reviewed: { label: 'Chờ trả', title: 'Feedback đã được duyệt', detail: 'Bài đang chờ phát hành cho học viên.' },
  delivered: { label: 'Đã trả', title: 'Học viên đã nhận feedback', detail: 'Đây là trạng thái phát hành canonical mới nhất.' },
  failed: { label: 'Chấm lỗi', title: 'Lượt chấm không hoàn tất', detail: 'Đọc lỗi vận hành phía dưới rồi quay lại Queue để xử lý.' },
};
const STEPS: { id: 'queue' | 'grade' | 'review' | 'deliver'; label: string; detail: string }[] = [
  { id: 'queue', label: 'Queued', detail: 'Đã ghi nhận' },
  { id: 'grade', label: 'AI grading', detail: 'Đang phân tích' },
  { id: 'review', label: 'Review', detail: 'Kiểm tra feedback' },
  { id: 'deliver', label: 'Delivered', detail: 'Học viên đã nhận' },
];

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function duration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe} giây`;
  const minutes = Math.floor(safe / 60);
  return `${minutes} phút ${safe % 60} giây`;
}

function stepState(step: string, status: WritingStatusName) {
  const rank: Record<string, number> = { pending: 0, grading: 1, graded: 2, reviewed: 2, delivered: 3 };
  const index: Record<string, number> = { queue: 0, grade: 1, review: 2, deliver: 3 };
  if (status === 'failed') return step === 'grade' ? 'is-failed is-current' : index[step] === 0 ? 'is-complete' : '';
  const current = rank[status];
  return index[step] < current ? 'is-complete' : index[step] === current ? 'is-current' : '';
}

export function AdminWritingStatus() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const query = useMemo(() => normalizeWritingStatusQuery({
    essay_id: params?.get('essay_id') || params?.get('id') || '',
    embed: params?.get('embed') || '', mocklane: params?.get('mocklane') || '',
  }), [params]);
  const key = `${profile.id}\u0000${query.essayId}`;
  const currentKey = useRef(key); currentKey.current = key;
  const sequence = useRef(0);
  const inFlightKeys = useRef(new Set<string>());
  const originalTitle = useRef('');
  const [snapshot, setSnapshot] = useState<{ key: string; data: WritingStatusPayload; readAt: string } | null>(null);
  const [loading, setLoading] = useState(Boolean(query.essayId));
  const [error, setError] = useState<string | null>(null);
  const [observedFrom, setObservedFrom] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [notification, setNotification] = useState<'unsupported' | NotificationPermission>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const notified = useRef(false);
  const data = snapshot?.key === key ? snapshot.data : null;
  const stale = Boolean(data && error);

  const loadStatus = useCallback(async (silent = false): Promise<WritingStatusPayload | null> => {
    const account = profile.id;
    const essayId = query.essayId;
    const requestKey = `${account}\u0000${essayId}`;
    if (inFlightKeys.current.has(requestKey)) return null;
    inFlightKeys.current.add(requestKey);
    const requestId = ++sequence.current;
    if (!essayId) return null;
    if (!silent) setLoading(true);
    try {
      const normalized = normalizeWritingStatusPayload(
        await window.api.get<unknown>(`/admin/writing/essays/${encodeURIComponent(essayId)}/status`), essayId,
      ) as WritingStatusPayload | null;
      if (requestId !== sequence.current || currentKey.current !== requestKey) return null;
      if (!normalized) throw new Error('Phản hồi trạng thái bài viết không đúng định dạng.');
      // Keep the prior read error visible for the whole retry. Clearing it
      // before this canonical response arrives would temporarily present the
      // still-rendered old snapshot as current while a slow refresh is pending.
      setError(null);
      setSnapshot({ key: requestKey, data: normalized, readAt: new Date().toISOString() });
      return normalized;
    } catch (caught) {
      if (requestId === sequence.current && currentKey.current === requestKey) setError(messageOf(caught));
      return null;
    } finally {
      inFlightKeys.current.delete(requestKey);
      if (requestId === sequence.current && currentKey.current === requestKey) setLoading(false);
    }
  }, [profile.id, query.essayId]);

  useEffect(() => {
    sequence.current += 1;
    setSnapshot(null); setError(null); setLoading(Boolean(query.essayId));
    setObservedFrom(Date.now()); setNow(Date.now()); notified.current = false;
  }, [key, query.essayId]);

  useEffect(() => {
    if (!query.essayId || (data && isWritingStatusTerminal(data.status))) return;
    let stopped = false; let timer = 0;
    const schedule = (delay: number) => { if (!stopped && !document.hidden) timer = window.setTimeout(cycle, delay); };
    const cycle = async () => {
      if (stopped || document.hidden) return;
      const next = await loadStatus(Boolean(data));
      if (!next || !isWritingStatusTerminal(next.status)) schedule(POLL_MS);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void cycle();
    };
    schedule(data ? POLL_MS : 0);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); sequence.current += 1; };
  }, [key, data?.status, loadStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data || isWritingStatusTerminal(data.status)) return;
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => window.clearInterval(timer);
  }, [data?.status]);

  useEffect(() => {
    originalTitle.current = document.title;
    return () => { document.title = originalTitle.current; };
  }, []);

  useEffect(() => {
    if (!data) return;
    document.title = `${STATUS_COPY[data.status].label} · Writing Admin`;
    if (!notified.current && ['graded', 'reviewed', 'delivered'].includes(data.status)) {
      notified.current = true;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Bài Writing đã sẵn sàng', { body: `Essay ${data.essayId.slice(0, 8)}…: ${STATUS_COPY[data.status].label}` });
      }
    }
  }, [data]);

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotification(permission);
  };

  if (!query.essayId) return <main className="aws-shell"><section className="aws-state is-error" role="alert"><span className="aws-state__code">MISSING ESSAY ID</span><h1>Không biết cần theo dõi bài nào</h1><p>URL phải có tham số <code>essay_id</code>. Hãy mở lại bài từ hàng chờ Writing.</p><a className="adm-btn-primary" href={writingStatusHref('queue', query)}>Mở hàng chờ</a></section></main>;

  const observedSeconds = Math.floor((now - observedFrom) / 1000);
  const copy = data ? STATUS_COPY[data.status] : null;
  const progress = data ? writingStatusProgress(data.status, observedSeconds, data.etaSeconds) : 0;
  const phase = data ? writingStatusPhase(data.status, data.gradingTier, observedSeconds) : null;
  const terminalSuccess = data && ['graded', 'reviewed', 'delivered'].includes(data.status);

  return <main className={`aws-shell${query.embed ? ' is-embedded' : ''}`}>
    {!query.embed && <header className="aws-header"><div><p className="aws-eyebrow">Writing · Job monitor</p><h1>Tiến trình chấm bài</h1><p>Theo dõi một essay từ hàng đợi đến khi feedback sẵn sàng — dữ liệu được đọc trực tiếp từ máy chủ.</p></div><a className="aws-back" href={writingStatusHref('queue', query)}>← Hàng chờ Writing</a></header>}

    {error && <div className="aws-warning" role="alert"><div><strong>{stale ? 'Đang hiển thị snapshot gần nhất.' : 'Không đọc được trạng thái bài.'}</strong><span>{error}</span></div><button className="adm-btn-secondary adm-btn-sm" type="button" disabled={loading} onClick={() => void loadStatus()}>Thử lại</button></div>}
    {data?.malformedOptional ? <div className="aws-warning" role="alert"><div><strong>Retry ledger có dữ liệu không hợp lệ.</strong><span>{data.malformedOptional} trường tùy chọn đã bị bỏ qua; trạng thái chính vẫn lấy từ backend.</span></div></div> : null}

    {loading && !data && <section className="aws-state" role="status"><span className="aws-spinner" aria-hidden="true" /><h1>Đang đọc trạng thái canonical…</h1><p>Essay <code>{query.essayId}</code></p></section>}
    {!loading && !data && error && <section className="aws-state is-error"><span className="aws-state__code">STATUS UNAVAILABLE</span><h1>Chưa có snapshot để hiển thị</h1><p>Kiểm tra quyền truy cập hoặc quay lại Queue để chọn bài khác.</p><a className="adm-btn-secondary" href={writingStatusHref('queue', query)}>Quay lại Queue</a></section>}

    {data && copy && <>
      <section className={`aws-hero is-${data.status}`} aria-labelledby="aws-status-title">
        <div className="aws-hero__top"><div><span className={`aws-pill is-${data.status}`}>{copy.label}</span><p className="aws-eyebrow">Essay <code>{data.essayId.slice(0, 8)}…</code></p></div><div className="aws-live"><span className={!isWritingStatusTerminal(data.status) ? 'is-pulsing' : ''} aria-hidden="true" /><strong>{isWritingStatusTerminal(data.status) ? 'Đã dừng polling' : 'Tự làm mới mỗi 5 giây'}</strong></div></div>
        <div className="aws-hero__copy"><h2 id="aws-status-title">{copy.title}</h2><p>{phase || copy.detail}</p></div>
        <div className="aws-progress-copy"><strong>Tiến độ thời gian ước tính</strong><span>{progress}%</span></div>
        <div className="aws-progress" role="progressbar" aria-label="Tiến độ thời gian ước tính" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
        <p className="aws-disclaimer">{isWritingStatusTerminal(data.status) ? `Snapshot terminal · đọc lại lúc ${formatDate(snapshot?.readAt || null)}` : `Đã theo dõi ${duration(observedSeconds)} · ETA backend khoảng ${duration(data.etaSeconds)}. Đây là ước tính theo thời gian, không phải phần trăm xử lý realtime.`}</p>
      </section>

      <ol className="aws-timeline" aria-label="Các chặng xử lý Writing">{STEPS.map((step, index) => <li key={step.id} className={stepState(step.id, data.status)} aria-current={stepState(step.id, data.status).includes('is-current') ? 'step' : undefined}><span className="aws-step__marker">{stepState(step.id, data.status).includes('is-complete') ? '✓' : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>

      <div className="aws-grid">
        <section className="aws-card" aria-labelledby="aws-job-title"><header><div><p className="aws-eyebrow">Canonical snapshot</p><h2 id="aws-job-title">Thông tin lượt chấm</h2></div><button className="adm-btn-secondary adm-btn-sm" type="button" disabled={loading} onClick={() => void loadStatus()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></header><dl><div><dt>Essay ID</dt><dd><code>{data.essayId}</code></dd></div><div><dt>Gửi lúc</dt><dd>{formatDate(data.createdAt)}</dd></div><div><dt>Grading tier</dt><dd>{data.gradingTier}</dd></div><div><dt>Attempt</dt><dd>{data.attemptCount || 'Chưa bắt đầu'}{data.attemptCount ? ` / ${data.maxAttempts}` : ''}</dd></div></dl></section>

        <section className="aws-card" aria-labelledby="aws-retry-title"><header><div><p className="aws-eyebrow">Reliability ledger</p><h2 id="aws-retry-title">Thử lại & phục hồi</h2></div><span className={`aws-count${data.attemptFailures ? ' is-warning' : ''}`}>{data.attemptFailures}</span></header>{data.lastFailure ? <div className="aws-failure"><strong>Lỗi gần nhất · attempt {data.lastFailure.attempt}</strong><p>{data.lastFailure.kind || 'Không rõ loại lỗi'}{data.lastFailure.model ? ` · ${data.lastFailure.model}` : ''}</p>{data.lastFailure.message && <blockquote>{data.lastFailure.message}</blockquote>}<small>{formatDate(data.lastFailure.at)}</small></div> : <div className="aws-empty"><strong>Chưa ghi nhận lần lỗi nào</strong><span>Ledger sẽ xuất hiện khi worker retry hoặc đổi model fallback.</span></div>}</section>
      </div>

      {data.status === 'failed' && <section className="aws-fatal" role="alert"><div><p className="aws-eyebrow">Action required</p><h2>Lượt chấm đã thất bại</h2><p>{data.errorMessage || 'Backend không trả về thông điệp lỗi chi tiết. Mở Queue để kiểm tra và quyết định bước xử lý tiếp theo.'}</p></div><a className="adm-btn-secondary" href={writingStatusHref('queue', query)}>Mở Queue</a></section>}

      <footer className="aws-actions"><div><strong>{terminalSuccess ? 'Feedback đã có thể mở trong workspace.' : 'Không cần giữ màn hình ở foreground.'}</strong><span>{terminalSuccess ? 'Kiểm tra nội dung trước khi trả bài.' : 'Polling tạm dừng khi tab bị ẩn và tiếp tục ngay khi quay lại.'}</span></div><div>{notification === 'default' && !isWritingStatusTerminal(data.status) && <button className="adm-btn-secondary" type="button" onClick={() => void enableNotifications()}>Bật thông báo</button>}{terminalSuccess && <a className="adm-btn-primary" href={writingStatusHref('grade', query)}>Mở workspace chấm →</a>}</div></footer>
    </>}
  </main>;
}
