'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  formatMetric,
  isUuid,
  normalizeFlashcardStatsPayload,
  normalizeVocabStatsPayload,
} from '@/lib/admin-vocab-stats-model.mjs';

type VocabStats = {
  vocab_bank_total: number;
  fp_reports_total: number;
  fp_rate_percent: number;
  users_with_vocab_enabled: number;
};
type FlashcardStats = {
  activity: Record<string, number>;
  srsHealth: Record<string, number> & { ratingDistributionPercent: Record<string, number> };
  engagement: Record<string, number> & { topReviewedWords: Array<{ headword: string; review_count: number }> };
  timeseries: Array<{ date: string; reviews: number }>;
  periodDays: number;
  computedAt: string;
};

const PERIODS = [['7', '7 ngày'], ['30', '30 ngày'], ['90', '90 ngày']] as const;
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');

function Tile({ label, value, hint, warning = false }: { label: string; value: string; hint?: string; warning?: boolean }) {
  return <article className={`avv-stat${warning ? ' is-warning' : ''}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

function formatComputedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

export function AdminVocabStats() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const requested = params?.get('days') ?? '30';
  const [days, setDays] = useState(PERIODS.some(([value]) => value === requested) ? requested : '30');
  const [vocab, setVocab] = useState<VocabStats | null>(null);
  const [flashcards, setFlashcards] = useState<FlashcardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (period: string) => {
    const requestId = ++sequence.current;
    setLoading(true); setErrors([]);
    const [vocabResult, flashcardResult] = await Promise.allSettled([
      window.api.get<unknown>('/admin/vocab/stats'),
      window.api.get<unknown>(`/admin/flashcards/stats?days=${encodeURIComponent(period)}`),
    ]);
    if (requestId !== sequence.current) return;
    const nextErrors: string[] = [];
    if (vocabResult.status === 'fulfilled') {
      const normalized = normalizeVocabStatsPayload(vocabResult.value) as VocabStats | null;
      if (normalized) setVocab(normalized); else nextErrors.push('Vocab stats trả về dữ liệu không đúng định dạng.');
    } else nextErrors.push(`Không tải được Vocab stats: ${messageOf(vocabResult.reason)}`);
    if (flashcardResult.status === 'fulfilled') {
      const normalized = normalizeFlashcardStatsPayload(flashcardResult.value) as FlashcardStats | null;
      if (normalized) setFlashcards(normalized); else nextErrors.push('Flashcards stats trả về dữ liệu không đúng định dạng.');
    } else nextErrors.push(`Không tải được Flashcards stats: ${messageOf(flashcardResult.reason)}`);
    setErrors(nextErrors); setLoading(false);
  }, []);

  useEffect(() => {
    setVocab(null); setFlashcards(null); setNotice(null);
    void load(days);
    return () => { sequence.current += 1; };
  }, [profile.id, days, load]);

  const changeDays = (next: string) => {
    setDays(next);
    const url = new URL(window.location.href);
    url.searchParams.set('days', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const setFlag = async (enabled: boolean) => {
    const canonicalId = userId.trim();
    if (!isUuid(canonicalId)) {
      setNotice({ kind: 'error', message: 'User ID phải là UUID hợp lệ.' });
      return;
    }
    // The flag readback and the regular refresh share one freshness boundary.
    // Otherwise an older refresh can arrive after this mutation and paint the
    // pre-mutation enabled-user count over the canonical readback.
    const requestId = ++sequence.current;
    setLoading(false);
    setSaving(true); setNotice(null);
    try {
      const result = await window.api.post<{ ok?: unknown; message?: unknown }>(`/admin/users/${encodeURIComponent(canonicalId)}/vocab-flag`, { enabled });
      if (requestId !== sequence.current) return;
      if (result?.ok !== true) throw new Error('Backend không trả xác nhận lưu hợp lệ.');
      const ackMessage = typeof result.message === 'string' && result.message
        ? result.message
        : 'Backend đã xác nhận cập nhật feature flag.';
      try {
        const refreshed = normalizeVocabStatsPayload(await window.api.get<unknown>('/admin/vocab/stats')) as VocabStats | null;
        if (requestId !== sequence.current) return;
        if (!refreshed) throw new Error('Dữ liệu đọc lại không đúng định dạng.');
        setVocab(refreshed);
        setNotice({ kind: 'success', message: ackMessage });
      } catch (readbackError) {
        if (requestId !== sequence.current) return;
        setNotice({
          kind: 'error',
          message: `Backend đã xác nhận thay đổi nhưng chưa đọc lại được số liệu chuẩn: ${messageOf(readbackError)} Hãy tải lại trước khi thao tác tiếp.`,
        });
      }
    } catch (caught) {
      if (requestId !== sequence.current) return;
      setNotice({ kind: 'error', message: `Không xác nhận được trạng thái feature flag: ${messageOf(caught)} Không bấm lại cho đến khi đã kiểm tra trạng thái người dùng.` });
    } finally { setSaving(false); }
  };

  return (
    <main className="avv-shell avv-stats-shell">
      <header className="avv-stats-hero">
        <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Sức khoẻ hệ thống</p><h1>Vocab + Flashcards Stats</h1><p>Dữ liệu chuẩn từ backend cho ngân hàng từ, feature flag và hoạt động SRS.</p></div>
        <div className="avv-stats-actions"><label>Khoảng thời gian<select value={days} disabled={loading} onChange={(event) => changeDays(event.target.value)}>{PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="btn-secondary" disabled={loading} type="button" onClick={() => void load(days)}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      </header>

      {errors.length > 0 && <div className="avv-banner is-error" role="alert"><strong>{vocab || flashcards ? 'Một phần dữ liệu chưa thể làm mới; phần còn lại vẫn là dữ liệu gần nhất.' : 'Không tải được dữ liệu.'}</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      {notice && <div className={`avv-banner is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
      {loading && !vocab && !flashcards && <div className="avv-state" role="status">Đang tổng hợp Vocab và Flashcards…</div>}

      {vocab && <section className="avv-metric-section" aria-labelledby="vocab-bank-title"><div className="avv-section-head"><div><p className="avv-eyebrow">Vocab bank</p><h2 id="vocab-bank-title">Quy mô và chất lượng</h2></div></div><div className="avv-stats-grid"><Tile label="Bank entries" value={formatMetric(vocab.vocab_bank_total)} hint="Thẻ chưa archive" /><Tile label="FP reports" value={formatMetric(vocab.fp_reports_total)} hint="Sự kiện vocab_fp_reported" /><Tile label="FP rate" value={formatMetric(vocab.fp_rate_percent, '%')} hint="Ngưỡng vận hành dưới 10%" warning={vocab.fp_rate_percent >= 10} /><Tile label="Users enabled" value={formatMetric(vocab.users_with_vocab_enabled)} hint="feature_flags.vocab_enabled" /></div></section>}

      <section className="avv-flag" aria-labelledby="vocab-flag-title"><div><p className="avv-eyebrow">Feature flag theo tài khoản</p><h2 id="vocab-flag-title">vocab_enabled</h2><p>Mutation chỉ gửi sau khi User ID hợp lệ; sau khi lưu, số liệu Vocab được đọc lại từ backend.</p></div><div className="avv-flag__controls"><label htmlFor="flag-user-id">User ID</label><input id="flag-user-id" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="00000000-0000-4000-8000-000000000000" autoComplete="off" /><div><button className="btn-primary" disabled={saving} type="button" onClick={() => void setFlag(true)}>Bật Vocab</button><button className="btn-danger" disabled={saving} type="button" onClick={() => void setFlag(false)}>Tắt Vocab</button></div></div></section>

      {flashcards && <>
        <section className="avv-metric-section" aria-labelledby="flashcard-activity-title"><div className="avv-section-head"><div><p className="avv-eyebrow">Flashcards</p><h2 id="flashcard-activity-title">Activity</h2></div><p>Cập nhật {formatComputedAt(flashcards.computedAt)}</p></div><div className="avv-stats-grid"><Tile label="Manual stacks" value={formatMetric(flashcards.activity.total_manual_stacks)} /><Tile label="Cards in stacks" value={formatMetric(flashcards.activity.total_cards_in_manual_stacks)} /><Tile label="Active users" value={formatMetric(flashcards.activity.total_active_users)} /><Tile label="Lifetime reviews" value={formatMetric(flashcards.activity.total_reviews_all_time)} /></div></section>
        <section className="avv-metric-section" aria-labelledby="srs-health-title"><div className="avv-section-head"><div><p className="avv-eyebrow">Flashcards</p><h2 id="srs-health-title">SRS health · {flashcards.periodDays} ngày</h2></div></div><div className="avv-stats-grid"><Tile label="Ratings in period" value={formatMetric(flashcards.srsHealth.rating_total_count)} /><Tile label="Average ease" value={formatMetric(flashcards.srsHealth.avg_ease_factor)} /><Tile label="Mastered >30 days" value={formatMetric(flashcards.srsHealth.cards_mastered_30plus_days)} /><Tile label="Cards with lapses" value={formatMetric(flashcards.srsHealth.cards_with_lapses)} /></div><div className="avv-ratings" aria-label="Phân bổ rating">{Object.entries(flashcards.srsHealth.ratingDistributionPercent).map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatMetric(value, '%')}</strong><i style={{ width: `${Math.min(100, value)}%` }} /></div>)}</div></section>
        <section className="avv-metric-section" aria-labelledby="engagement-title"><div className="avv-section-head"><div><p className="avv-eyebrow">Flashcards</p><h2 id="engagement-title">Engagement</h2></div></div><div className="avv-engagement"><div className="avv-stats-grid"><Tile label="Avg reviews / user · 7d" value={formatMetric(flashcards.engagement.avg_reviews_per_user_last_7_days)} /><Tile label="Average DAU" value={formatMetric(flashcards.engagement.avg_dau_last_30_days)} /></div><div className="avv-topwords"><h3>Từ được ôn nhiều nhất</h3>{flashcards.engagement.topReviewedWords.length ? <ol>{flashcards.engagement.topReviewedWords.map((word) => <li key={word.headword}><span>{word.headword}</span><strong>{formatMetric(word.review_count)}</strong></li>)}</ol> : <p>Chưa có lượt ôn trong khoảng thời gian này.</p>}</div></div></section>
      </>}
    </main>
  );
}
