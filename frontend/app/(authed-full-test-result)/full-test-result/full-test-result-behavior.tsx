'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  bandTone,
  buildFullTestResult,
  fullTestSummaryPath,
} from '@/lib/speaking-full-test-result-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface KeyedState<T> {
  key: string;
  value: T;
}

function isAbort(caught: unknown) {
  return caught instanceof DOMException && caught.name === 'AbortError';
}

function statusOf(caught: unknown) {
  if (!caught || typeof caught !== 'object' || !('status' in caught)) return null;
  const status = Number((caught as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function formatBand(value: unknown) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '—';
}

function formatDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
}

function FullTestHeader({ date = '' }: { date?: string }) {
  return (
    <header className="ftr-header ftr-context-bar px-6 py-4 sticky top-0 z-20">
      <div className="av-w-page flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <a href="/speaking" className="ftr-back-link">← Quay lại</a>
          <p className="eyebrow" style={{ margin: 0 }}>Speaking</p>
          <span className="ftr-header__sep">|</span>
          <h1 className="ftr-header__title text-sm font-semibold">Kết quả IELTS Mock Test</h1>
        </div>
        {date ? <span className="ftr-header__date text-xs">{date}</span> : null}
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-40" role="status">
      <div className="spinner mb-4" />
      <p className="ftr-loading-msg text-sm">Đang tổng hợp kết quả…</p>
    </div>
  );
}

export function FullTestResultLoading() {
  return <><FullTestHeader /><LoadingState /></>;
}

function StatePanel({
  icon,
  title,
  children,
  actionHref = '/speaking',
  actionLabel = 'Quay lại Speaking',
  tone = 'error',
}: {
  icon: string;
  title: string;
  children: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  tone?: 'error' | 'warning' | 'neutral';
}) {
  return (
    <div className="av-w-read py-20 text-center" role={tone === 'error' ? 'alert' : 'status'}>
      <div className={`ftr-state-icon ftr-state-icon--${tone}`} aria-hidden="true">{icon}</div>
      <p className="ftr-state-title text-lg font-semibold mb-2">{title}</p>
      <div className="ftr-error-msg text-sm mb-6">{children}</div>
      <a href={actionHref} className="btn-primary">{actionLabel}</a>
    </div>
  );
}

function FeedbackList({ items, tone }: { items: string[]; tone: 'strength' | 'improve' }) {
  if (!items.length) return <li className="ftr-empty text-sm">Chưa có nhận xét tổng hợp.</li>;
  return items.map((item) => <li className={`${tone}-pill`} key={item}>{item}</li>);
}

function CriterionRow({ criterion }: { criterion: any }) {
  const width = criterion.value == null ? 0 : Math.max(0, Math.min(100, criterion.value / 9 * 100));
  return (
    <div className="ftr-crit-row flex items-center gap-3">
      <span className="ftr-crit-label" title={criterion.label}>{criterion.shortLabel}</span>
      <div className="ftr-crit-track" aria-hidden="true">
        <div className={`ftr-crit-fill crit-fill--${criterion.key}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`ftr-crit-score ${bandTone(criterion.value)}`}>{formatBand(criterion.value)}</span>
    </div>
  );
}

function PartCard({ part }: { part: any }) {
  return (
    <article className="part-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="ftr-part-badge text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
          Part {part.part}
        </span>
        <span className={`ftr-part-band text-2xl font-extrabold ${bandTone(part.band)}`}>
          {formatBand(part.band)}
        </span>
      </div>
      <p className="ftr-part-topic text-xs mb-1">{part.questionCount} câu hỏi</p>
      <p className="ftr-part-topic text-sm mb-4">{part.topic}</p>
      {part.keyFeedback?.strength ? (
        <div className="strength-pill mb-2"><span className="ftr-pill-icon">✓</span>{part.keyFeedback.strength}</div>
      ) : null}
      {part.keyFeedback?.improvement ? (
        <div className="improve-pill"><span className="ftr-pill-icon">→</span>{part.keyFeedback.improvement}</div>
      ) : null}
      <a href={`/result?id=${encodeURIComponent(part.sessionId)}`} className="ftr-part-link mt-4 block text-center text-xs py-2 rounded-lg">
        Xem chi tiết Part {part.part}
      </a>
    </article>
  );
}

function PronunciationSummary({ data }: { data: any }) {
  if (!data) {
    return (
      <section className="card p-6 fade-up fade-up-4">
        <p className="ftr-eyebrow text-xs font-semibold uppercase tracking-wider mb-2">Phát âm tổng hợp</p>
        <p className="ftr-empty text-sm">Chưa có dữ liệu phát âm đã lưu cho bài thi này.</p>
      </section>
    );
  }
  const dimensions = [
    ['Độ chính xác', data.accuracy],
    ['Độ lưu loát', data.fluency],
    ['Độ đầy đủ', data.completeness],
    ['Ngữ điệu', data.prosody],
  ];
  return (
    <section className="card p-6 fade-up fade-up-4">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="ftr-eyebrow text-xs font-semibold uppercase tracking-wider mb-1">Phát âm tổng hợp</p>
          <p className="ftr-part-topic text-xs">Từ {data.responseCount} câu trả lời đã phân tích</p>
        </div>
        <div className="ftr-pron-score">
          <strong>{data.overall == null ? '—' : Math.round(data.overall)}</strong><span>/100</span>
        </div>
      </div>
      <div className="ftr-pron-grid">
        {dimensions.map(([label, value]) => (
          <div className="ftr-pron-metric" key={String(label)}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="ftr-pron-label text-sm">{label}</span>
              <span className="ftr-pron-value text-sm font-bold">{value == null ? '—' : `${Math.round(value)}/100`}</span>
            </div>
            <div className="ftr-pron-track" aria-hidden="true">
              <div style={{ width: `${value == null ? 0 : value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultContent({ view, requestKey }: { view: any; requestKey: string }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [toast, setToast] = useState('');
  const inFlight = useRef(false);
  const alive = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const blobUrls = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const downloadPdfs = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPdfBusy(true);
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const sb = (window as any).getSupabase?.();
      const { data } = sb?.auth ? await sb.auth.getSession() : { data: null };
      const token = data?.session?.access_token;
      if (!token) throw new Error('missing-session');
      let completed = 0;
      for (const part of view.parts) {
        try {
          const response = await fetch(`${window.api.base || ''}/sessions/${encodeURIComponent(part.sessionId)}/export/pdf`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!alive.current || controller.signal.aborted) return;
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.current.add(blobUrl);
          const anchor = document.createElement('a');
          anchor.href = blobUrl;
          anchor.download = `IELTS_Speaking_Full_Test_Part_${part.part}.pdf`;
          anchor.click();
          completed += 1;
          window.setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            blobUrls.current.delete(blobUrl);
          }, 2000);
        } catch (caught) {
          if (isAbort(caught) || controller.signal.aborted) throw caught;
          // Continue with the remaining Parts and report the exact partial count.
        }
      }
      if (alive.current) setToast(completed === view.parts.length
        ? 'Đã tải đủ 3 báo cáo PDF.'
        : `Đã tải ${completed}/${view.parts.length} báo cáo. Bạn có thể thử lại phần còn thiếu.`);
    } catch (caught) {
      if (!isAbort(caught) && !controller.signal.aborted && alive.current) {
        setToast('Không thể tải PDF lúc này. Vui lòng thử lại sau.');
      }
    } finally {
      controllers.current.delete(controller);
      inFlight.current = false;
      if (alive.current) setPdfBusy(false);
    }
  };

  return (
    <main className="av-w-page py-10 space-y-8" data-request-key={requestKey}>
      {!view.chainVerified ? (
        <div className="ftr-chain-notice" role="status">
          Đây là bài thi được tạo trước khi hệ thống lưu mã chuỗi ba Part. Kết quả vẫn được kiểm tra theo đúng Part và tài khoản.
        </div>
      ) : null}

      <section className="card ftr-hero p-8 text-center fade-up fade-up-1">
        <p className="eyebrow mb-3">Overall Band Score</p>
        <div className="band-hero mb-2">{formatBand(view.overallBand)}</div>
        <p className="ftr-hero-sub text-sm">Điểm canonical tổng hợp từ ba Part đã hoàn thành</p>
        <div className="mt-8 space-y-4 text-left max-w-md mx-auto">
          {view.criteria.map((criterion: any) => <CriterionRow criterion={criterion} key={criterion.key} />)}
        </div>
      </section>

      <section className="fade-up fade-up-2">
        <h2 className="ftr-section-title text-base font-bold mb-4">Kết quả từng phần</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {view.parts.map((part: any) => <PartCard part={part} key={part.sessionId} />)}
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-4 fade-up fade-up-3">
        <div className="card p-6">
          <p className="ftr-eyebrow ftr-eyebrow--strength text-xs font-semibold uppercase tracking-wider mb-4">✓ Điểm mạnh nổi bật</p>
          <ul className="space-y-2"><FeedbackList items={view.strengths} tone="strength" /></ul>
        </div>
        <div className="card p-6">
          <p className="ftr-eyebrow ftr-eyebrow--improve text-xs font-semibold uppercase tracking-wider mb-4">→ Cần cải thiện</p>
          <ul className="space-y-2"><FeedbackList items={view.improvements} tone="improve" /></ul>
        </div>
      </section>

      {view.grammarIssues.length ? (
        <section className="card p-6 fade-up fade-up-4">
          <p className="ftr-eyebrow text-xs font-semibold uppercase tracking-wider mb-4">Lỗi ngữ pháp tái diễn</p>
          {view.grammarIssues.map((issue: string, index: number) => (
            <div className="grammar-item" key={issue}>
              <span className="grammar-item__index text-xs font-bold mt-0.5 shrink-0">{index + 1}.</span>
              <p className="grammar-item__text text-sm">{issue}</p>
            </div>
          ))}
        </section>
      ) : null}

      <PronunciationSummary data={view.pronunciation} />

      <section className="fade-up fade-up-5">
        <div className="flex flex-wrap gap-3 justify-center">
          <a href="/speaking" className="btn-primary">Luyện lại</a>
          {view.parts.map((part: any) => (
            <a className="btn-secondary ftr-detail-link" href={`/result?id=${encodeURIComponent(part.sessionId)}`} key={part.sessionId}>
              Chi tiết Part {part.part}
            </a>
          ))}
          <button className="btn-secondary" disabled={pdfBusy} onClick={downloadPdfs} type="button">
            {pdfBusy ? 'Đang tạo PDF…' : 'Tải 3 PDF'}
          </button>
        </div>
      </section>

      {toast ? <div className="ftr-toast" role="status">{toast}</div> : null}
    </main>
  );
}

export function FullTestResultBehavior() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const p1 = searchParams?.get('p1')?.trim() || searchParams?.get('session_id')?.trim() || '';
  const p2 = searchParams?.get('p2')?.trim() || '';
  const p3 = searchParams?.get('p3')?.trim() || '';
  const requestKey = status === 'signed-in' && user?.id ? `${user.id}:${p1}:${p2}:${p3}` : null;
  const [resultState, setResultState] = useState<KeyedState<any> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);
  const result = resultState?.key === requestKey ? resultState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let disposed = false;
    setResultState(null);
    setErrorState(null);
    const path = fullTestSummaryPath({ p1, p2, p3 });
    if (!path) {
      setErrorState({ key: requestKey, value: 'Thiếu session Part 1 trong URL.' });
      return () => controller.abort();
    }

    (async () => {
      const ready = await whenGlobalReady(
        () => Boolean((window as any).api?.getWith && (window as any).getSupabase),
        'window.api + Supabase (full-test result)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({ key: requestKey, value: 'Không tải được thành phần kết nối. Hãy tải lại trang.' });
        return;
      }
      try {
        const raw = await window.api.getWith<any>(path, {}, { signal: controller.signal });
        if (disposed) return;
        const sb = (window as any).getSupabase();
        const { data } = await sb.auth.getSession();
        if (disposed) return;
        if (!data?.session || data.session.user?.id !== user?.id) {
          setErrorState({ key: requestKey, value: 'Phiên đăng nhập đã thay đổi. Hãy tải lại trang.' });
          return;
        }
        setResultState({ key: requestKey, value: buildFullTestResult(raw) });
      } catch (caught) {
        if (isAbort(caught) || disposed) return;
        const code = statusOf(caught);
        const message = code === 404
          ? 'Không tìm thấy bài thi hoặc bạn không có quyền truy cập.'
          : code === 400 || code === 409
            ? 'Chuỗi ba Part chưa hợp lệ hoặc chưa hoàn tất. Hãy quay lại Speaking và mở đúng bài thi.'
            : 'Máy chủ chưa tải được kết quả đã lưu. Hãy thử lại sau.';
        setErrorState({ key: requestKey, value: message });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, p1, p2, p3, user?.id]);

  const loading = status === 'initial-loading'
    || (status === 'signed-in' && Boolean(requestKey) && !result && !error);
  const date = result ? formatDate(result.startedAt) : '';

  return (
    <>
      <FullTestHeader date={date} />
      {loading ? <LoadingState /> : null}
      {error ? (
        <StatePanel icon="!" title="Không thể tải kết quả"><p>{error}</p></StatePanel>
      ) : null}
      {result?.sealed ? (
        <StatePanel icon="⌁" title="Kết quả chưa được công bố" actionHref="/full-test" actionLabel="Xem trạng thái bài thi" tone="neutral">
          <p>Bài thi đang được niêm phong. Điểm và nhận xét chỉ xuất hiện sau khi giám khảo công bố.</p>
        </StatePanel>
      ) : result?.failed ? (
        <StatePanel icon="!" title="Một phần chấm điểm chưa hoàn tất" tone="warning">
          <p>Hệ thống không tạo điểm tổng từ dữ liệu thiếu. Bài đã ghi vẫn được lưu để quản trị viên xử lý lại.</p>
        </StatePanel>
      ) : result && !result.ready ? (
        <StatePanel icon="…" title="Kết quả đang được tổng hợp" actionLabel="Quay lại Speaking" tone="neutral">
          <p>Ba Part chưa có đủ điểm canonical. Hãy đợi ít phút rồi tải lại trang; hệ thống sẽ không hiển thị điểm tạm.</p>
        </StatePanel>
      ) : result?.ready ? (
        <ResultContent key={requestKey || ''} requestKey={requestKey || ''} view={result} />
      ) : null}
    </>
  );
}
