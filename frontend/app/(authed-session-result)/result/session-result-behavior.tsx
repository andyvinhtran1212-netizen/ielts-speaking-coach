'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import {
  bandClass,
  buildSessionResult,
  roundHalf,
} from '@/lib/speaking-session-result-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface KeyedState<T> {
  key: string;
  value: T;
}

interface PendingVocabItem {
  id: string;
  headword?: string | null;
  definition_en?: string | null;
  definition_vi?: string | null;
  context_sentence?: string | null;
  reason?: string | null;
  session_id?: string | null;
}

interface WeakKpItem {
  ref_slug?: string | null;
  title?: string | null;
  category?: string | null;
  anchor?: string | null;
}

type ToastState = { id: number; message: string } | null;

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function statusOf(caught: unknown) {
  if (!caught || typeof caught !== 'object' || !('status' in caught)) return null;
  const status = Number((caught as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function isAbort(caught: unknown) {
  return caught instanceof DOMException && caught.name === 'AbortError';
}

function formatBand(value: unknown) {
  const rounded = roundHalf(value);
  return rounded == null ? '—' : rounded.toFixed(1);
}

function formatDate(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}

function prettySlug(value: unknown) {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mintUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function LoadingFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <div className="spinner mb-4" />
      <p className="result-loading-msg text-sm">{children}</p>
    </div>
  );
}

export function SessionResultLoading() {
  return (
    <>
      <ResultHeader />
      <LoadingFrame>Đang tải kết quả…</LoadingFrame>
    </>
  );
}

function ResultHeader() {
  return (
    <header className="result-header px-6 py-4">
      <div className="av-w-read flex items-center gap-4">
        <a href="/speaking" className="result-back-link">← Quay lại</a>
        <p className="eyebrow" style={{ margin: 0 }}>Speaking</p>
        <span className="result-header__sep">|</span>
        <h1 className="result-header__title text-base font-semibold">Kết quả luyện tập</h1>
      </div>
    </header>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="av-w-read py-16 text-center" role="alert">
      <div className="result-error-icon" aria-hidden="true">⚠</div>
      <p className="result-error-title text-lg font-semibold mb-2">Không thể tải kết quả</p>
      <p className="result-error-msg text-sm mb-6">{message}</p>
      <a href="/speaking" className="btn-primary">Quay lại</a>
    </div>
  );
}

function SealedState() {
  return (
    <div className="av-w-read py-16 text-center" role="status">
      <div className="result-error-icon" aria-hidden="true">🔒</div>
      <p className="result-error-title text-lg font-semibold mb-2">Kết quả chưa được công bố</p>
      <p className="result-error-msg text-sm mb-6">
        Bài thi đang được niêm phong. Điểm và nhận xét sẽ xuất hiện trên trang kết quả thi thử sau khi giám khảo công bố.
      </p>
      <a href="/full-test" className="btn-primary">Xem trạng thái bài thi</a>
    </div>
  );
}

function FeedbackList({ items, tone }: { items: string[]; tone: 'success' | 'warning' }) {
  if (!items.length) return <li className="av-text-faint italic text-xs">Không có dữ liệu</li>;
  return items.map((item) => (
    <li className="flex gap-2" key={item}>
      <span
        aria-hidden="true"
        style={{
          color: tone === 'success' ? 'var(--av-success)' : 'var(--av-warning)',
          marginTop: 2,
          flexShrink: 0,
        }}
      >
        ●
      </span>
      <span>{item}</span>
    </li>
  ));
}

function BandValue({ value, className = '' }: { value: unknown; className?: string }) {
  return <div className={`${className} ${bandClass(value)}`.trim()}>{formatBand(value)}</div>;
}

function GrammarResources({ resources }: { resources: any[] }) {
  if (!resources.length) return null;
  const track = (resource: any) => {
    if (!resource.recId) return;
    window.api.patch(`/api/grammar/recommendations/${encodeURIComponent(resource.recId)}/clicked`, {})
      .catch(() => {});
  };
  return (
    <section className="result-grammar-section">
      <div className="result-grammar-section__inner">
        <p className="result-card-eyebrow result-card-eyebrow--brand text-xs font-bold uppercase tracking-wider mb-1">
          Grammar Resources
        </p>
        <p className="result-grammar-sub text-sm mb-4">
          Bài học ngữ pháp liên quan đến lỗi hoặc điểm cần cải thiện trong bài của bạn
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {resources.map((resource, index) => {
            const href = `/grammar/${encodeURIComponent(resource.category)}/${encodeURIComponent(resource.slug)}`
              + (resource.anchor ? `#${encodeURIComponent(resource.anchor)}` : '');
            return (
              <a
                className={`result-grammar-card result-grammar-card--${index === 0 ? 'primary' : 'secondary'}`}
                href={href}
                key={`${resource.slug}:${resource.anchor}`}
                onClick={() => track(resource)}
                rel="noopener"
                target="_blank"
              >
                <div className="result-grammar-card__body">
                  <p className="result-grammar-card__title">{resource.title}</p>
                  {index === 0 && resource.summary ? (
                    <p className="result-grammar-card__summary">{resource.summary}</p>
                  ) : null}
                  <p className="result-grammar-card__reason">{resource.reason}</p>
                </div>
                {index === 0 ? (
                  <span className="result-grammar-card__cta">Học ngay →</span>
                ) : (
                  <span className="result-grammar-card__chevron" aria-hidden="true">→</span>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function KpWeakWidget({ requestKey }: { requestKey: string }) {
  const [state, setState] = useState<KeyedState<WeakKpItem[]> | null>(null);
  const items = state?.key === requestKey ? state.value : [];

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState(null);
    (async () => {
      try {
        const data = await window.api.getWith<{ items?: WeakKpItem[] }>(
          '/api/me/kp-mastery?status=weak&kp_type=grammar',
          {},
          { noRedirect: true, signal: controller.signal },
        );
        if (!disposed) setState({
          key: requestKey,
          value: Array.isArray(data?.items) ? data.items : [],
        });
      } catch (caught) {
        if (!isAbort(caught) && !disposed) setState({ key: requestKey, value: [] });
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey]);

  if (!items.length) return null;
  return (
    <div className="card p-5">
      <p className="result-card-eyebrow result-card-eyebrow--brand text-xs font-bold uppercase tracking-wider mb-1">
        Điểm cần luyện
      </p>
      <p className="text-sm mb-3" style={{ color: 'var(--av-text-secondary)' }}>
        {items.length} điểm ngữ pháp cần củng cố qua các buổi luyện của bạn.
      </p>
      <div style={{ marginBottom: 'var(--av-space-3)' }}>
        {items.slice(0, 3).map((item, index) => {
          const title = item.title || prettySlug(item.ref_slug);
          const chip = (
            <span style={{
              display: 'inline-block',
              fontSize: 'var(--av-fs-xs)',
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 999,
              margin: '0 6px 6px 0',
              color: 'var(--av-error)',
              background: 'var(--av-error-soft)',
            }}>
              {title}
            </span>
          );
          if (!item.category || !item.ref_slug) {
            return <span key={`${item.ref_slug || 'kp'}:${index}`}>{chip}</span>;
          }
          const href = `/grammar/${encodeURIComponent(item.category)}/${encodeURIComponent(item.ref_slug)}`
            + (item.anchor ? `#${encodeURIComponent(item.anchor)}` : '');
          return <a href={href} key={`${item.ref_slug}:${item.anchor || ''}`}>{chip}</a>;
        })}
      </div>
      <a
        href="/pages/grammar-roadmap.html"
        style={{
          fontSize: 'var(--av-fs-sm)',
          fontWeight: 600,
          color: 'var(--av-primary)',
          textDecoration: 'none',
        }}
      >
        Xem lộ trình của bạn →
      </a>
    </div>
  );
}

function PendingVocabPanel({
  requestKey,
  onToast,
}: {
  requestKey: string;
  onToast: (message: string) => void;
}) {
  const [state, setState] = useState<KeyedState<PendingVocabItem[]> | null>(null);
  const items = state?.key === requestKey ? state.value : [];

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState(null);
    (async () => {
      try {
        const data = await window.api.getWith<PendingVocabItem[]>(
          '/api/vocabulary/bank/pending',
          {},
          { signal: controller.signal },
        );
        if (!disposed) setState({ key: requestKey, value: Array.isArray(data) ? data : [] });
      } catch (caught) {
        if (!isAbort(caught) && !disposed) setState({ key: requestKey, value: [] });
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey]);

  const removeOne = async (item: PendingVocabItem, action: 'confirm' | 'drop') => {
    setState((current) => current?.key === requestKey
      ? { key: requestKey, value: current.value.filter((entry) => entry.id !== item.id) }
      : current);
    try {
      await window.api.post(`/api/vocabulary/bank/pending/${encodeURIComponent(item.id)}/${action}`, {});
    } catch (caught) {
      console.error(`[result] pending vocab ${action} failed:`, caught);
      setState((current) => current?.key === requestKey && !current.value.some((entry) => entry.id === item.id)
        ? { key: requestKey, value: [item, ...current.value] }
        : current);
      onToast(action === 'confirm' ? 'Không lưu được, thử lại nhé.' : 'Không bỏ được, thử lại nhé.');
    }
  };

  const keepAll = async () => {
    const snapshot = items;
    if (!snapshot.length) return;
    setState({ key: requestKey, value: [] });
    try {
      await window.api.post('/api/vocabulary/bank/pending/bulk-confirm', {
        ids: snapshot.map((item) => item.id),
      });
    } catch (caught) {
      console.error('[result] pending vocab bulk-confirm failed:', caught);
      setState((current) => current?.key === requestKey && current.value.length === 0
        ? { key: requestKey, value: snapshot }
        : current);
      onToast('Không lưu được, thử lại nhé.');
    }
  };

  if (!items.length) return null;
  return (
    <section className="pending-panel" data-pending-panel>
      <header className="pending-panel__head">
        <h2 className="pending-panel__title">Từ vựng mới ghi nhận</h2>
        <p className="pending-panel__subtitle">Xem qua và xác nhận để lưu vào bộ từ của bạn.</p>
        <button className="pending-panel__keep-all" onClick={keepAll} type="button">
          Giữ tất cả
        </button>
      </header>
      <div className="pending-panel__list">
        {items.map((item) => (
          <div className="pending-card" key={item.id}>
            <div className="pending-card__head">
              <span className="pending-card__headword">{item.headword}</span>
            </div>
            {item.definition_en || item.definition_vi ? (
              <div className="pending-card__def">
                {item.definition_en ? <span>{item.definition_en}</span> : null}
                {item.definition_vi ? <span className="pending-card__def-vi"> · {item.definition_vi}</span> : null}
              </div>
            ) : null}
            {item.context_sentence ? <p className="pending-card__context">“{item.context_sentence}”</p> : null}
            {item.reason ? <p className="pending-card__reason">{item.reason}</p> : null}
            <div className="pending-card__actions">
              {item.session_id ? (
                <a
                  className="vocab-action vocab-action--source"
                  href={`/result?id=${encodeURIComponent(item.session_id)}`}
                  title="Xem buổi luyện tập"
                >
                  ↗ nguồn
                </a>
              ) : null}
              <button
                className="pending-card__btn pending-card__btn--keep"
                onClick={() => removeOne(item, 'confirm')}
                type="button"
              >
                Giữ
              </button>
              <button
                className="pending-card__btn pending-card__btn--drop"
                onClick={() => removeOne(item, 'drop')}
                type="button"
              >
                Bỏ
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="pending-panel__notice">💡 Tự động lưu sau 24h nếu bạn không xác nhận.</p>
    </section>
  );
}

function BulletSection({ title, items, tone }: {
  title: string;
  items: unknown;
  tone: string;
}) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: tone }}>
        {title}
      </div>
      <ul className="space-y-1 text-sm" style={{ color: 'var(--av-text-secondary)', listStyle: 'none', padding: 0 }}>
        {items.map((item, index) => (
          <li className="flex gap-2" key={`${String(item)}:${index}`}>
            <span aria-hidden="true" style={{ color: tone, marginTop: 2, flexShrink: 0 }}>●</span>
            <span>{String(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GrammarIssues({ issues, recommendations }: { issues: unknown; recommendations: unknown }) {
  if (!Array.isArray(issues) || !issues.length) return null;
  const recMap = new Map((Array.isArray(recommendations) ? recommendations : [])
    .map((rec: any) => [String(rec?.issue || ''), rec]));
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--av-error)' }}>
        Grammar Issues
      </div>
      <ul className="space-y-1 text-sm" style={{ color: 'var(--av-text-secondary)', listStyle: 'none', padding: 0 }}>
        {issues.map((issue, index) => {
          const text = String(issue);
          const rec: any = recMap.get(text);
          const href = rec?.slug && rec?.category
            ? `/grammar/${encodeURIComponent(rec.category)}/${encodeURIComponent(rec.slug)}`
              + (rec.anchor ? `#${encodeURIComponent(rec.anchor)}` : '')
            : '';
          return (
            <li className="flex gap-2" key={`${text}:${index}`}>
              <span aria-hidden="true" style={{ color: 'var(--av-error)', marginTop: 2, flexShrink: 0 }}>●</span>
              <span>
                {text}
                {href ? (
                  <>{' '}<a
                    href={href}
                    onClick={() => {
                      if (rec.rec_id) window.api.patch(
                        `/api/grammar/recommendations/${encodeURIComponent(rec.rec_id)}/clicked`, {},
                      ).catch(() => {});
                    }}
                    rel="noopener"
                    style={{ color: 'var(--av-info)', fontSize: 11, textDecoration: 'underline', opacity: 0.85 }}
                    target="_blank"
                  >
                    → {rec.title || rec.slug}
                  </a></>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Corrections({ corrections }: { corrections: unknown }) {
  if (!Array.isArray(corrections) || !corrections.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--av-warning)' }}>
        Corrections
      </div>
      {corrections.map((correction: any, index) => (
        <div
          key={`${String(correction?.original || '')}:${index}`}
          style={{
            padding: '10px 12px',
            background: 'var(--av-surface-card)',
            border: '1px solid var(--av-border-subtle)',
            borderRadius: 8,
            marginBottom: 8,
          }}
        >
          <div className="text-sm mb-1" style={{ color: 'var(--av-error)' }}>❌ {correction?.original}</div>
          <div className="text-sm mb-1" style={{ color: 'var(--av-success)' }}>✓ {correction?.corrected}</div>
          <div className="text-xs italic" style={{ color: 'var(--av-text-muted)' }}>{correction?.explanation}</div>
        </div>
      ))}
    </div>
  );
}

function Transcript({ segments }: { segments: any[] }) {
  if (!segments.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold av-text-muted uppercase tracking-wider mb-1.5">Bản ghi lời nói</div>
      <div className="transcript-block text-sm">
        {segments.map((segment, index) => segment.kind === 'error' ? (
          <mark
            aria-label={`Lỗi ngữ pháp: ${segment.text} — gợi ý: ${segment.suggestion}`}
            className="ds-grammar-highlight"
            data-error-id={segment.id}
            data-tooltip={`${segment.suggestion || '(?)'}${segment.explanation ? ` • ${segment.explanation}` : ''}`}
            key={`${segment.id}:${index}`}
            role="button"
            tabIndex={0}
          >
            {segment.text}
          </mark>
        ) : <span key={`text:${index}`}>{segment.text}</span>)}
      </div>
    </div>
  );
}

function GrammarCheck({ groups, moreCount }: { groups: any[]; moreCount: number }) {
  if (!groups.length) return null;
  return (
    <div className="ds-grammar-section">
      <p className="ds-grammar-section-head">Grammar Issues (LanguageTool)</p>
      {groups.map((group) => (
        <div className="ds-grammar-category" key={group.category}>
          <p className="ds-grammar-category-title">{group.label}</p>
          <ul className="ds-grammar-error-list">
            {group.errors.map((error: any, index: number) => (
              <li className="ds-grammar-error-item" data-error-id={error.id} key={`${error.id}:${index}`}>
                <div className="ds-grammar-error-pair">
                  <span className="ds-grammar-error-original">{error.original}</span>
                  <span className="ds-grammar-error-arrow" aria-hidden="true">→</span>
                  <span className="ds-grammar-error-suggestion">{error.suggestion}</span>
                </div>
                {error.explanation ? <p className="ds-grammar-error-explanation">{error.explanation}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {moreCount > 0 ? <p className="ds-grammar-more-info">+{moreCount} lỗi khác đã được phát hiện.</p> : null}
    </div>
  );
}

function scoreTone(score: unknown) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 'var(--av-text-muted)';
  if (value >= 75) return 'var(--av-success)';
  if (value >= 55) return 'var(--av-warning)';
  return 'var(--av-error)';
}

function PronunciationWordDetails({
  defaultExpanded,
  word,
  children,
}: {
  defaultExpanded: boolean;
  word: string;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (defaultExpanded && detailsRef.current) detailsRef.current.open = true;
  }, [defaultExpanded]);
  return (
    <details
      className="ds-accordion__item"
      data-drilldown-word={word}
      ref={detailsRef}
    >
      {children}
    </details>
  );
}

function PronunciationDrilldown({ payload }: { payload: unknown }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    whenGlobalReady(
      () => Boolean((window as any).PronunciationDrilldown?.extractWeakWordsFromPayload),
      'PronunciationDrilldown (session result)',
    ).then((ok) => { if (!disposed) setReady(ok); });
    return () => { disposed = true; };
  }, []);
  if (!payload || !ready) return null;
  const drill = (window as any).PronunciationDrilldown;
  const extracted = drill.extractWeakWordsFromPayload(payload);
  if (!extracted?.legacy && !extracted?.weakWords?.length) return null;
  return (
    <div className="result-pron-drilldown" style={{ marginTop: 10 }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--av-primary)' }}>
        Phân tích phát âm chuyên sâu
      </div>
      {extracted.legacy ? (
        <p className="text-sm" data-drilldown-legacy style={{ color: 'var(--av-text-secondary)' }}>
          Phân tích phát âm chuyên sâu chưa khả dụng cho phiên này — các phiên luyện tập gần đây sẽ có nhận xét chi tiết hơn.
        </p>
      ) : (
        <div className="ds-accordion" data-drilldown-content>
          <p className="ds-accordion__hint">Bấm vào mỗi từ để xem chi tiết âm cần luyện.</p>
          {extracted.weakWords.map((word: any, wordIndex: number) => {
            const phonemes = Array.isArray(word.phonemes)
              ? word.phonemes.slice().sort((a: any, b: any) => (a.score ?? 999) - (b.score ?? 999))
              : [];
            const weakCount = phonemes.filter((phoneme: any) => phoneme.score != null && phoneme.score < 70).length;
            return (
              <PronunciationWordDetails
                defaultExpanded={extracted.weakWords.length <= 1}
                key={`${word.word}:${wordIndex}`}
                word={String(word.word || '')}
              >
                <summary className="ds-accordion__head">
                  <span className="ds-accordion__word">{word.word}</span>
                  <span className="ds-accordion__count">
                    {weakCount ? `${weakCount} âm cần luyện` : `${phonemes.length} âm`}
                  </span>
                </summary>
                <div className="ds-accordion__body">
                  {phonemes.length ? phonemes.map((phoneme: any, index: number) => {
                    const ref = drill.PHONEME_REF?.[phoneme.symbol];
                    const value = Number(phoneme.score);
                    const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
                    const tier = value < 60 ? 'low' : value < 80 ? 'mid' : 'high';
                    return (
                      <div className="ds-phoneme" key={`${phoneme.symbol}:${index}`}>
                        <div className="ds-phoneme__row">
                          <span className="ds-phoneme__sym">
                            {phoneme.symbol}{ref ? <span className="ds-phoneme__ipa"> /{ref.ipa}/</span> : null}
                          </span>
                          <span className={`ds-phoneme__score ds-phoneme__score--${tier}`}>
                            {Number.isFinite(value) ? Math.round(value) : '—'}/100
                          </span>
                        </div>
                        <div className="ds-phoneme__bar">
                          <div className={`ds-phoneme__bar-fill ds-phoneme__bar-fill--${tier}`} style={{ width: `${percent}%` }} />
                        </div>
                        {ref ? (
                          <>
                            <p className="ds-phoneme__examples">Ví dụ: {ref.examples.join(', ')}</p>
                            <p className="ds-phoneme__tip">{ref.tip_vn}</p>
                          </>
                        ) : <p className="ds-phoneme__tip">Hướng dẫn cho âm này đang được cập nhật.</p>}
                      </div>
                    );
                  }) : <p className="ds-phoneme__tip">Không có dữ liệu âm vị cho từ này.</p>}
                </div>
              </PronunciationWordDetails>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Pronunciation({ response }: { response: any }) {
  if (response?.pronunciation_status !== 'completed' || response?.pronunciation_score == null) return null;
  const scores = [
    ['Overall', response.pronunciation_score],
    ['Fluency', response.pronunciation_fluency],
    ['Accuracy', response.pronunciation_accuracy],
    ['Complete', response.pronunciation_completeness],
  ].filter(([, value]) => value != null);
  return (
    <>
      <div className="result-pron-block">
        <div className="result-pron-block__eyebrow">Phân tích phát âm · thang 0–100, khác thang band 0–9</div>
        <div className="result-pron-block__pills">
          {scores.map(([label, value]) => (
            <span
              key={String(label)}
              style={{
                fontSize: 11,
                padding: '3px 9px',
                borderRadius: 999,
                fontWeight: 600,
                background: 'var(--av-surface-card)',
                color: scoreTone(value),
              }}
            >
              {label}: {Number(value).toFixed(0)}
            </span>
          ))}
        </div>
        {Array.isArray(response.pronunciation_summary) && response.pronunciation_summary.length ? (
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {response.pronunciation_summary.map((line: unknown, index: number) => (
              <li key={`${String(line)}:${index}`} style={{ fontSize: 12, color: 'var(--av-text-secondary)', lineHeight: 1.5, padding: '2px 0' }}>
                • {String(line)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <PronunciationDrilldown payload={response.pronunciation_payload} />
    </>
  );
}

function QuestionFeedback({ card }: { card: any }) {
  const feedback = card.feedback;
  return (
    <>
      {card.warnings.length ? (
        <div className="ds-result-warnings">
          {card.warnings.map((warning: any, index: number) => (
            <div className="ds-warning-banner" key={`${warning.message}:${index}`} role="alert">
              <span className="ds-warning-icon" aria-hidden="true">{warning.icon}</span>
              <p className="ds-warning-message">{warning.message}</p>
            </div>
          ))}
        </div>
      ) : null}
      <Transcript segments={card.transcript} />
      <GrammarCheck groups={card.grammarGroups} moreCount={card.grammarMoreCount} />
      {card.gradingFailed ? (
        <div className="text-sm result-acc-failed italic">{card.statusMessage}</div>
      ) : card.isPractice ? (
        <>
          <p className="text-xs italic mb-2" style={{ color: 'var(--av-text-secondary)' }}>
            Chế độ luyện tập — phản hồi dạng gợi ý (điểm mạnh, ngữ pháp, từ vựng, phát âm), không chấm theo 4 tiêu chí IELTS.
          </p>
          <BulletSection items={feedback?.strengths} title="Strengths" tone="var(--av-success)" />
          <GrammarIssues issues={feedback?.grammar_issues} recommendations={feedback?.grammar_recommendations} />
          <BulletSection items={feedback?.vocabulary_issues} title="Vocabulary Issues" tone="var(--av-warning)" />
          <BulletSection items={feedback?.pronunciation_issues} title="Luyện phát âm — gợi ý chung" tone="var(--av-info)" />
          <Corrections corrections={feedback?.corrections} />
          {feedback?.sample_answer ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--av-primary)' }}>
                Sample Answer
              </div>
              <div className="improved-block text-sm">{feedback.sample_answer}</div>
            </div>
          ) : null}
        </>
      ) : feedback ? (
        <>
          <p className="text-xs italic mb-2" style={{ color: 'var(--av-text-secondary)' }}>
            Chế độ thi thử — chấm theo 4 tiêu chí IELTS (Fluency &amp; Coherence, Lexical, Grammar, Phát âm).
          </p>
          {[
            ['fc_feedback', 'Fluency & Coherence'],
            ['lr_feedback', 'Lexical Resource'],
            ['gra_feedback', 'Grammar & Accuracy'],
            ['p_feedback', 'Pronunciation'],
          ].map(([key, label]) => feedback[key] ? (
            <div key={key}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--av-primary)' }}>{label}</div>
              <div className="text-sm" style={{ color: 'var(--av-text-secondary)', lineHeight: 1.65 }}>{feedback[key]}</div>
            </div>
          ) : null)}
          <BulletSection items={feedback.strengths} title="Điểm mạnh" tone="var(--av-success)" />
          <BulletSection items={feedback.improvements} title="Cần cải thiện" tone="var(--av-warning)" />
          {feedback.improved_response ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--av-primary)' }}>
                Câu trả lời mẫu
              </div>
              <div className="improved-block text-sm">{feedback.improved_response}</div>
            </div>
          ) : null}
        </>
      ) : null}
      <Pronunciation response={card.response} />
    </>
  );
}

function QuestionAccordion({
  cards,
  activeAudio,
  onAudio,
  onDownload,
}: {
  cards: any[];
  activeAudio: string;
  onAudio: (key: string, url: string) => void;
  onDownload: (url: string, filename: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (!cards.length) return <p className="av-text-faint text-sm">Không có câu hỏi nào.</p>;
  return cards.map((card) => {
    const isOpen = open.has(card.key);
    return (
      <div className="card overflow-hidden" key={card.key}>
        <button
          aria-expanded={isOpen}
          className="result-acc-btn w-full text-left px-5 py-4 flex items-start justify-between gap-3 transition-colors"
          onClick={() => setOpen((current) => {
            const next = new Set(current);
            if (next.has(card.key)) next.delete(card.key);
            else next.add(card.key);
            return next;
          })}
          type="button"
        >
          <span className="flex-1">
            <span className="text-sm font-semibold result-acc-title mb-1 block">{card.questionText}</span>
            <span className="flex flex-wrap gap-1">
              {card.bandPills.length ? card.bandPills.map((pill: any) => (
                <span className={`text-xs font-semibold ${bandClass(pill.value)} mr-2`} key={pill.key}>
                  {pill.label}: {formatBand(pill.value)}
                </span>
              )) : card.gradingFailed ? (
                <span className="text-xs result-acc-failed">Chấm điểm không thành công</span>
              ) : (
                <span className="text-xs av-text-faint">Chưa có câu trả lời</span>
              )}
              {card.isPractice && card.bandPills.length ? (
                <span className="text-xs" style={{ color: 'var(--av-text-muted)' }}>Practice mode</span>
              ) : null}
            </span>
          </span>
          <span className={`acc-chevron shrink-0 mt-0.5 ${isOpen ? 'rotated' : ''}`} aria-hidden="true">⌄</span>
        </button>
        {card.audioUrl ? (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--av-border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => onAudio(card.key, card.audioUrl)} style={{ fontSize: 12, padding: '6px 12px' }} type="button">
              {activeAudio === card.key ? '■ Dừng' : '▶ Nghe lại'}
            </button>
            <button className="btn-secondary" onClick={() => onDownload(card.audioUrl, card.audioFilename)} style={{ fontSize: 12, padding: '6px 12px' }} type="button">
              ↓ Tải audio
            </button>
          </div>
        ) : null}
        <div className={`acc-body px-5 pb-5 space-y-3 ${isOpen ? 'open' : ''}`}>
          <QuestionFeedback card={card} />
        </div>
      </div>
    );
  });
}

function ResultContent({ view, requestKey }: { view: any; requestKey: string }) {
  const [toast, setToast] = useState<ToastState>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [activeAudio, setActiveAudio] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrls = useRef(new Set<string>());
  const actionControllers = useRef(new Set<AbortController>());
  const audioDownloads = useRef(new Set<string>());
  const pdfInFlight = useRef(false);
  const retryInFlight = useRef(false);
  const retryRequestId = useRef('');
  const alive = useRef(true);

  const showToast = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = '';
      audioRef.current = null;
      actionControllers.current.forEach((controller) => controller.abort());
      actionControllers.current.clear();
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const toggleAudio = (key: string, url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
      const wasSame = activeAudio === key;
      setActiveAudio('');
      if (wasSame) return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setActiveAudio(key);
    audio.onended = () => {
      if (audioRef.current === audio) audioRef.current = null;
      if (alive.current) setActiveAudio('');
    };
    audio.play().catch(() => {
      if (audioRef.current === audio) audioRef.current = null;
      if (alive.current) {
        setActiveAudio('');
        showToast('Không phát được audio. Hãy thử tải file về máy.');
      }
    });
  };

  const downloadAudio = async (url: string, filename: string) => {
    if (audioDownloads.current.has(url)) return;
    audioDownloads.current.add(url);
    const controller = new AbortController();
    actionControllers.current.add(controller);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!alive.current || controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.current.add(blobUrl);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        blobUrls.current.delete(blobUrl);
      }, 2000);
    } catch (caught) {
      if (isAbort(caught) || controller.signal.aborted) return;
      console.warn('[result] audio download failed:', caught);
      showToast('Không tải được audio. Bạn vẫn có thể dùng nút Nghe lại.');
    } finally {
      audioDownloads.current.delete(url);
      actionControllers.current.delete(controller);
    }
  };

  const downloadPdf = async () => {
    if (pdfInFlight.current) return;
    pdfInFlight.current = true;
    setPdfBusy(true);
    const controller = new AbortController();
    actionControllers.current.add(controller);
    try {
      const sb = (window as any).getSupabase?.();
      if (!sb?.auth) throw new Error('missing-supabase-client');
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('missing-session');
      const response = await fetch(`${window.api.base || ''}/sessions/${encodeURIComponent(view.sessionId)}/export/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!alive.current || controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.current.add(blobUrl);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = 'IELTS_Report.pdf';
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        blobUrls.current.delete(blobUrl);
      }, 2000);
    } catch (caught) {
      if (isAbort(caught) || controller.signal.aborted) return;
      console.error('[result] PDF export failed:', caught);
      showToast('Không thể tạo PDF lúc này. Vui lòng thử lại sau.');
    } finally {
      pdfInFlight.current = false;
      actionControllers.current.delete(controller);
      if (alive.current) setPdfBusy(false);
    }
  };

  const retry = async () => {
    if (retryInFlight.current) return;
    if (view.mode === 'test_full') return;
    const part = Number(view.part);
    if (![1, 2, 3].includes(part)) {
      showToast('Phiên cũ thiếu thông tin Part hợp lệ nên chưa thể tạo lại.');
      return;
    }
    retryInFlight.current = true;
    setRetryBusy(true);
    const storageKey = `aver:result-retry:${requestKey}`;
    if (!retryRequestId.current) {
      try {
        const saved = sessionStorage.getItem(storageKey) || '';
        retryRequestId.current = validUuid(saved) ? saved : mintUuid();
        sessionStorage.setItem(storageKey, retryRequestId.current);
      } catch (_) {
        retryRequestId.current = mintUuid();
      }
    }
    try {
      const data = await window.api.post<{ session_id?: string; id?: string }>('/sessions', {
        mode: view.mode || 'practice',
        part,
        topic: view.topic,
        client_session_id: retryRequestId.current,
      });
      const nextId = data?.session_id || data?.id;
      if (!nextId) throw new Error('missing-session-id');
      if (alive.current) {
        try { sessionStorage.removeItem(storageKey); } catch (_) { /* storage unavailable */ }
        // The centralized policy preserves Legacy admission until Gate E passes,
        // while keeping this caller safe when the policy later moves to Next.
        window.location.href = admitCorePlayer('speaking', { session_id: nextId });
      }
    } catch (caught) {
      console.error('[result] retry session failed:', caught);
      if (alive.current) {
        retryInFlight.current = false;
        setRetryBusy(false);
        showToast('Chưa xác nhận được phiên mới. Bấm lại sẽ kiểm tra cùng một yêu cầu, không tạo trùng.');
      }
    }
  };

  if (view.isSealed) return <SealedState />;
  return (
    <main className="av-w-read py-8 space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <span className="result-meta-part text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
            Part {view.part}
          </span>
          <span className="result-meta-topic text-lg font-semibold">{view.topic}</span>
        </div>
        <p className="result-meta-date text-sm">{formatDate(view.startedAt)}</p>
      </section>

      {!view.isCompleted ? (
        <div className="ds-warning-banner" role="status">
          <span className="ds-warning-icon" aria-hidden="true">⏳</span>
          <p className="ds-warning-message">
            Phiên này chưa hoàn tất trên máy chủ. Điểm tổng hợp chỉ hiển thị sau khi trạng thái canonical là completed.
          </p>
        </div>
      ) : null}

      <section>
        <div className="ds-band-hero mb-4 ds-fadein">
          <div className="ds-section-head" style={{ marginBottom: 8 }}>Band tổng quan</div>
          <BandValue className="ds-band-value" value={view.overall} />
          <div className="ds-band-label">Overall Band Score</div>
        </div>
        {!view.isPractice ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              ['fc', 'Fluency & Coherence', 'ds-crit-fc'],
              ['lr', 'Lexical Resource', 'ds-crit-lr'],
              ['gra', 'Grammatical Range', 'ds-crit-gra'],
              ['p', 'Pronunciation', 'ds-crit-p'],
            ].map(([key, label, tone]) => (
              <div className={`ds-crit ${tone}`} key={key}>
                <BandValue className="ds-crit-score" value={view.bands[key]} />
                <div className="ds-crit-label">{label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="result-card-eyebrow result-card-eyebrow--strength text-xs font-bold uppercase tracking-wider mb-3">Điểm mạnh</h2>
          <ul className="result-feedback-list space-y-2 text-sm"><FeedbackList items={view.strengths} tone="success" /></ul>
        </div>
        <div className="card p-5">
          <h2 className="result-card-eyebrow result-card-eyebrow--improve text-xs font-bold uppercase tracking-wider mb-3">Cần cải thiện</h2>
          <ul className="result-feedback-list space-y-2 text-sm"><FeedbackList items={view.improvements} tone="warning" /></ul>
        </div>
      </section>

      {view.takeaway ? (
        <section className="card p-5">
          <h2 className="result-card-eyebrow result-card-eyebrow--brand text-xs font-bold uppercase tracking-wider mb-2">Trọng tâm luyện tập</h2>
          <p className="text-sm" style={{ color: 'var(--av-text-secondary)' }}>{view.takeaway}</p>
        </section>
      ) : null}

      <GrammarResources resources={view.grammarResources} />
      <KpWeakWidget requestKey={requestKey} />

      <section>
        <h2 className="result-section-eyebrow text-xs font-bold uppercase tracking-wider mb-3">Chi tiết từng câu hỏi</h2>
        <div className="space-y-3">
          <QuestionAccordion
            activeAudio={activeAudio}
            cards={view.cards}
            onAudio={toggleAudio}
            onDownload={downloadAudio}
          />
        </div>
      </section>

      <PendingVocabPanel onToast={showToast} requestKey={requestKey} />

      <div className="flex flex-wrap gap-3 justify-center pb-8">
        <button className="btn-primary result-icon-btn" disabled={pdfBusy} onClick={downloadPdf} type="button">
          ↓ {pdfBusy ? 'Đang tạo PDF…' : 'Tải báo cáo PDF'}
        </button>
        <a href="/speaking" className="btn-secondary result-icon-btn">▦ Quay lại</a>
        {view.mode === 'test_full' ? (
          <a href="/full-test" className="btn-secondary result-icon-btn">↻ Làm lại Full Test</a>
        ) : (
          <button className="btn-secondary result-icon-btn" disabled={retryBusy} onClick={retry} type="button">
            ↻ {retryBusy ? 'Đang tạo phiên…' : 'Luyện lại chủ đề này'}
          </button>
        )}
      </div>

      {toast ? (
        <div className="result-toast" role="alert" style={{
          position: 'fixed',
          left: '50%',
          bottom: 24,
          transform: 'translateX(-50%)',
          background: 'var(--av-surface-elevated)',
          color: 'var(--av-text-primary)',
          padding: '12px 18px',
          borderRadius: 8,
          boxShadow: 'var(--av-shadow-lg)',
          zIndex: 9999,
          maxWidth: '90vw',
        }}>
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

export function SessionResultBehavior() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('id')?.trim()
    || searchParams?.get('session_id')?.trim()
    || '';
  const requestKey = status === 'signed-in' && user?.id
    ? `${user.id}:${sessionId}`
    : null;
  const [resultState, setResultState] = useState<KeyedState<any> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);
  const result = resultState?.key === requestKey ? resultState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setResultState(null);
      setErrorState(null);
      window.location.replace('/login.html');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let disposed = false;
    setResultState(null);
    setErrorState(null);

    if (!sessionId) {
      setErrorState({ key: requestKey, value: 'Thiếu session ID trong URL.' });
      return () => controller.abort();
    }

    (async () => {
      const ready = await whenGlobalReady(
        () => Boolean((window as any).api?.getWith && (window as any).getSupabase),
        'window.api + Supabase (session result)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
        });
        return;
      }

      try {
        const encodedId = encodeURIComponent(sessionId);
        const [session, categories] = await Promise.all([
          window.api.getWith<any>(`/sessions/${encodedId}`, {}, { signal: controller.signal }),
          fetch(`${window.api.base || ''}/api/grammar/categories`, { signal: controller.signal })
            .then((response) => response.ok ? response.json() : null)
            .catch((caught) => {
              if (isAbort(caught)) throw caught;
              return null;
            }),
        ]);
        if (disposed) return;
        if (session?.question_lookup_failed === true) {
          setErrorState({
            key: requestKey,
            value: 'Máy chủ không đọc được câu hỏi đã lưu. Trang không hiển thị dữ liệu rỗng để tránh báo sai kết quả; hãy thử tải lại.',
          });
          return;
        }
        if (session?.response_lookup_failed === true) {
          setErrorState({
            key: requestKey,
            value: 'Máy chủ không đọc được phản hồi đã lưu. Trang không hiển thị dữ liệu rỗng để tránh báo sai kết quả; hãy thử tải lại.',
          });
          return;
        }

        let audioItems: any[] = [];
        try {
          const audio = await window.api.getWith<any[]>(
            `/sessions/${encodedId}/audio-urls`, {}, { signal: controller.signal },
          );
          audioItems = Array.isArray(audio) ? audio : [];
        } catch (caught) {
          if (isAbort(caught)) throw caught;
          console.warn('[result] signed audio lookup failed; using persisted fallback URLs:', caught);
        }
        if (disposed) return;

        const sb = (window as any).getSupabase();
        const { data } = await sb.auth.getSession();
        if (disposed) return;
        if (!data?.session || data.session.user?.id !== user?.id) {
          setErrorState({ key: requestKey, value: 'Phiên đăng nhập đã thay đổi. Hãy tải lại trang.' });
          return;
        }
        setResultState({ key: requestKey, value: buildSessionResult(session, categories, audioItems) });
      } catch (caught) {
        if (isAbort(caught) || disposed) return;
        console.error('[result] native load failed:', caught);
        const message = statusOf(caught) === 404
          ? 'Không tìm thấy phiên luyện tập hoặc bạn không có quyền truy cập.'
          : 'Không tải được kết quả. Hãy thử lại sau.';
        setErrorState({ key: requestKey, value: message });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, sessionId, user?.id]);

  const loading = status === 'initial-loading'
    || (status === 'signed-in' && Boolean(requestKey) && !result && !error);

  return (
    <>
      <ResultHeader />
      {loading ? <LoadingFrame>Đang tải kết quả…</LoadingFrame> : null}
      {error ? <ErrorState message={error} /> : null}
      {result ? <ResultContent key={requestKey || ''} requestKey={requestKey || ''} view={result} /> : null}
    </>
  );
}
