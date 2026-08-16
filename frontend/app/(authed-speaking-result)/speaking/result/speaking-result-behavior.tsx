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

const CRITERIA: Array<[keyof SpeakingBands, string]> = [
  ['fc', 'Fluency & Coherence'],
  ['lr', 'Lexical Resource'],
  ['gra', 'Grammar'],
  ['p', 'Pronunciation'],
];

function formatBand(value: number | string | null | undefined) {
  if (value == null || value === '') return '—';
  return Number(value).toFixed(1);
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
  return <div className="spr-wrap">{children}</div>;
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

  return (
    <>
      {/* Kết quả tổng đã là route native; href thường vẫn dùng được cả hard/soft nav. */}
      <a
        className="spr-back"
        href={`/mock/result?sitting=${encodeURIComponent(sittingId)}`}
      >
        ← Về trang kết quả
      </a>
      <div className="spr-eyebrow">Speaking · thi trực tiếp với giáo viên</div>
      <h1 className="spr-h1">Nhận xét chi tiết của giáo viên chấm</h1>
      <div className="spr-meta">{metaText}</div>

      {speaking.intro ? <div className="spr-quote">{speaking.intro}</div> : null}

      <div className="spr-h2">Band theo từng tiêu chí</div>
      <div className="spr-band-grid">
        {CRITERIA.map(([key, label]) => {
          const band = bands[key];
          if (band == null) return null;
          return (
            <div className="spr-band" key={key}>
              <div className="spr-band-label">{label}</div>
              <div className="spr-band-val">{formatBand(band)}</div>
              <div className="spr-band-meter" aria-hidden="true">
                <span style={{ width: `${bandPercent(band)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {metrics.length ? (
        <>
          <div className="spr-h2">Số đo từ bản ghi buổi thi</div>
          <table className="spr-metrics">
            <thead>
              <tr><th></th><th>Của bạn</th><th>Trung bình lớp</th></tr>
            </thead>
            <tbody>
              {metrics.map((metric, index) => (
                <tr key={`${String(metric.label ?? 'metric')}:${index}`}>
                  <td>{display(metric.label)}</td>
                  <td>{display(metric.value)}</td>
                  <td>{display(metric.class_avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {sections.length ? <div className="spr-h2">Nhận xét &amp; cách luyện</div> : null}
      {sections.map((section, index) => (
        <div className="spr-note" key={`${section.title || 'section'}:${index}`}>
          <div className="spr-note__title">{section.title}</div>
          {section.body ? <div className="spr-note__body">{section.body}</div> : null}
          {section.advice ? (
            <div className="spr-note__advice">Cách luyện: {section.advice}</div>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function SpeakingResultLoading() {
  return <PageFrame><div className="spr-state">Đang tải nhận xét…</div></PageFrame>;
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
    key: string; value: string;
  } | null>(null);

  // State cũ không được render trong frame giữa lúc account/search param đã
  // đổi nhưng effect mới chưa kịp chạy.
  const result = resultState?.key === requestKey ? resultState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

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
      setErrorState({ key: requestKey, value: 'Thiếu mã lượt thi.' });
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
          });
          return;
        }
        setResultState({ key: requestKey, value: speaking as SpeakingNote });
      } catch (caught: any) {
        if (caught?.name !== 'AbortError' && !disposed) {
          setErrorState({
            key: requestKey,
            value: `Không tải được nhận xét: ${caught?.message || String(caught)}`,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, sittingId]);

  return (
    <PageFrame>
      {status === 'initial-loading' || (status === 'signed-in' && !result && !error) ? (
        <div className="spr-state">Đang tải nhận xét…</div>
      ) : null}
      {error ? <div className="spr-state spr-state--error">{error}</div> : null}
      {result ? <SpeakingResultContent speaking={result} sittingId={sittingId} /> : null}
    </PageFrame>
  );
}
