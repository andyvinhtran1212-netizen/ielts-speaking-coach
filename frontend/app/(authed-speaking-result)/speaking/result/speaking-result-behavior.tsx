'use client';

// React behavior cho `/speaking/result`.
//
// Component sở hữu state và vòng đời request. Không sửa DOM trực tiếp, không
// chờ DOMContentLoaded, và request bị abort khi logout, đổi tài khoản, đổi
// sitting hoặc rời route.
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type DisplayValue = string | number | null;

interface SpeakingMeta {
  parts?: string | null;
  duration?: string | null;
}

interface SpeakingBands {
  fc?: number | string | null;
  lr?: number | string | null;
  gra?: number | string | null;
  p?: number | string | null;
}

interface SpeakingMetric {
  label?: DisplayValue;
  value?: DisplayValue;
  class_avg?: DisplayValue;
}

interface SpeakingSection {
  title?: string | null;
  body?: string | null;
  advice?: string | null;
}

interface SpeakingNote {
  meta?: SpeakingMeta;
  intro?: string | null;
  bands?: SpeakingBands;
  metrics?: SpeakingMetric[];
  sections?: SpeakingSection[];
}

interface ResultPayload {
  per_skill_notes?: Record<string, unknown>;
}

const CRITERIA: Array<[keyof SpeakingBands, string, string]> = [
  ['fc', 'Độ trôi chảy & mạch lạc', 'FC'],
  ['lr', 'Vốn từ', 'LR'],
  ['gra', 'Ngữ pháp', 'GRA'],
  ['p', 'Phát âm', 'P'],
];

function formatBand(value: number | string | null | undefined) {
  if (value == null || value === '') return '—';
  const band = Number(value);
  return Number.isFinite(band) ? band.toFixed(1) : '—';
}

function bandPercent(value: number | string | null | undefined) {
  const band = Number(value);
  if (!Number.isFinite(band)) return 0;
  return Math.round(Math.min(9, Math.max(0, band)) / 9 * 100);
}

function display(value: DisplayValue | undefined) {
  return value == null ? '—' : value;
}

function PageFrame({ children }: { children: ReactNode }) {
  return <main className="shell spr-wrap">{children}</main>;
}

function SpeakingResultContent({ speaking, sittingId }: {
  speaking: SpeakingNote;
  sittingId: string;
}) {
  const meta = speaking.meta || {};
  const metaText = [
    meta.parts,
    meta.duration ? `Bài thi dài ${meta.duration}` : null,
  ].filter(Boolean).join(' · ');
  const bands = speaking.bands || {};
  const metrics = Array.isArray(speaking.metrics) ? speaking.metrics : [];
  const sections = Array.isArray(speaking.sections) ? speaking.sections : [];
  const practiceSteps = sections.filter((section) => section.advice);
  const noteSections = sections.filter((section) => section.body);

  return (
    <>
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href={`/mock/result?sitting=${encodeURIComponent(sittingId)}`}>
            <span aria-hidden="true">←</span><span>Kết quả tổng</span>
          </a>
        </div>
      </header>
      <section className="spr-hero">
        <div><p className="spr-eyebrow">Speaking · giáo viên chấm trực tiếp</p><h1 className="spr-h1">Nhận xét giúp bạn biết nên luyện gì tiếp</h1><p className="spr-meta">{metaText || 'Báo cáo Speaking cá nhân'}</p></div>
        <span className="spr-hero__mark">Báo cáo giáo viên</span>
      </section>

      {speaking.intro ? <section className="spr-teacher"><span>Lời nhắn từ giáo viên</span><p>{speaking.intro}</p></section> : null}

      <div className="spr-section-head"><div><p>Band thành phần</p><h2>Điểm theo từng tiêu chí</h2></div></div>
      <div className="spr-band-grid">
        {CRITERIA.map(([key, label, code]) => {
          const band = bands[key];
          if (band == null || band === '') return null;
          const numericBand = Number(band);
          const accessibleBand = Number.isFinite(numericBand)
            ? Math.min(9, Math.max(0, numericBand)) : 0;
          return (
            <div className="spr-band" key={key}>
              <div className="spr-band-label"><span>{code}</span>{label}</div>
              <div className="spr-band-val">{formatBand(band)}</div>
              <div className="spr-band-meter" role="progressbar" aria-label={`Band ${label}`} aria-valuemin={0} aria-valuemax={9} aria-valuenow={accessibleBand}>
                <span style={{ width: `${bandPercent(band)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {metrics.length ? (
        <section className="spr-section-card">
          <div className="spr-section-head"><div><p>Dữ liệu buổi thi</p><h2>Số đo từ bản ghi</h2></div></div>
          <div className="spr-metrics-wrap"><table className="spr-metrics">
            <thead>
              <tr><th></th><th>Của bạn</th><th>Trung bình lớp</th></tr>
            </thead>
            <tbody>
              {metrics.map((metric, index) => (
                <tr key={`${String(metric.label ?? 'metric')}:${index}`}>
                  <td data-label="Chỉ số">{display(metric.label)}</td>
                  <td data-label="Của bạn">{display(metric.value)}</td>
                  <td data-label="Trung bình lớp">{display(metric.class_avg)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ) : null}

      {practiceSteps.length ? (
        <section className="spr-plan">
          <div className="spr-section-head"><div><p>Hành động tiếp theo</p><h2>Ưu tiên luyện tiếp</h2></div><span>{practiceSteps.length} việc nên làm</span></div>
          <ol>{practiceSteps.map((section, index) => <li key={`${section.title || 'practice'}:${index}`}><span>{index + 1}</span><div><strong>{section.title || 'Bước luyện tập'}</strong><p>{section.advice}</p></div></li>)}</ol>
        </section>
      ) : null}

      {noteSections.length ? (
        <section className="spr-notes">
          <div className="spr-section-head"><div><p>Phân tích của giáo viên</p><h2>Nhận xét chi tiết</h2></div></div>
          {noteSections.map((section, index) => (
            <article className="spr-note" key={`${section.title || 'section'}:${index}`}>
              {section.title ? <h3 className="spr-note__title">{section.title}</h3> : null}
              {section.body ? <div className="spr-note__body">{section.body}</div> : null}
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}

export function SpeakingResultLoading() {
  return <PageFrame><div className="spr-state" role="status">Đang tải nhận xét…</div></PageFrame>;
}

export function SpeakingResultBehavior() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const sittingId = searchParams?.get('sitting')?.trim() || '';
  const requestKey = status === 'signed-in' && user?.id
    ? `${user.id}:${sittingId}`
    : null;
  const [resultState, setResultState] = useState<{
    key: string; value: SpeakingNote;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    key: string; value: string; retryable: boolean;
  } | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  // State cũ không được render trong frame giữa lúc account/search param đã
  // đổi nhưng effect mới chưa kịp chạy.
  const result = resultState?.key === requestKey ? resultState.value : null;
  const error = errorState?.key === requestKey ? errorState : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setResultState(null);
      setErrorState(null);
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setResultState(null);
    setErrorState(null);

    if (!sittingId) {
      setErrorState({ key: requestKey, value: 'Thiếu mã lượt thi.', retryable: false });
      return () => controller.abort();
    }

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (speaking result)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
          retryable: true,
        });
        return;
      }

      try {
        const payload = await window.api.getWith<ResultPayload>(
          `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/result`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;

        const speaking = payload?.per_skill_notes?.speaking;
        if (!speaking || typeof speaking !== 'object' || Array.isArray(speaking)) {
          setErrorState({
            key: requestKey,
            value: 'Lượt thi này không có nhận xét Speaking.',
            retryable: false,
          });
          return;
        }
        setResultState({ key: requestKey, value: speaking as SpeakingNote });
      } catch (caught: unknown) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError') && !disposed) {
          setErrorState({
            key: requestKey,
            value: 'Không tải được nhận xét. Vui lòng thử lại.',
            retryable: true,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, sittingId, reloadVersion]);

  return (
    <PageFrame>
      {status === 'initial-loading' || (status === 'signed-in' && !result && !error) ? (
        <div className="spr-state" role="status">Đang tải nhận xét…</div>
      ) : null}
      {error ? (
        <div className="spr-state spr-state--error" role="alert">
          <div><strong>Chưa mở được báo cáo Speaking</strong><p>{error.value}</p></div>
          <div className="spr-state__actions">
            {sittingId
              ? <a href={`/mock/result?sitting=${encodeURIComponent(sittingId)}`}>Về kết quả tổng</a>
              : <a href="/full-test">Về danh sách kỳ thi</a>}
            {error.retryable ? <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>Thử lại</button> : null}
          </div>
        </div>
      ) : null}
      {result ? <SpeakingResultContent speaking={result} sittingId={sittingId} /> : null}
    </PageFrame>
  );
}
