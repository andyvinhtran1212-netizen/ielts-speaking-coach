'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  formatPilotMetric,
  isPilotSampleReady,
  normalizePilotMetrics,
} from '@/lib/admin-vocab-pilot-metrics-model.mjs';

type Percentage = number | null;
type Immediate = { eligible_unit_starts: number; completed_unit_starts: number; attempts: number; completion_rate_percent: Percentage; accuracy_percent: Percentage };
type Delayed = { eligible_unit_starts: number; assessed_unit_starts: number; attempts: number; transfer_attempts: number; followup_rate_percent: Percentage; accuracy_percent: Percentage; transfer_success_percent: Percentage };
type Metrics = {
  period_days: number;
  computed_at: string;
  cohort: { enabled_users: number; learners_started: number; unit_starts: number };
  runtime_flags: Record<string, boolean>;
  immediate: Immediate;
  day7: Delayed;
  day28: Delayed;
  recommendations: { created: number; opened: number; completed: number; dismissed: number; open_rate_percent: Percentage; completion_rate_percent: Percentage };
  units: Array<{ unit_slug: string; display_headword: string; started: number; immediate_eligible: number; immediate_completed: number; day7_eligible: number; day7_assessed: number; day7_accuracy_percent: Percentage; day28_eligible: number; day28_assessed: number; day28_accuracy_percent: Percentage }>;
};

const PERIODS = [['30', '30 ngày'], ['90', '90 ngày'], ['180', '180 ngày']] as const;
const FLAG_LABELS: Record<string, string> = {
  vocab_units_read: 'Đọc unit',
  vocab_unit_attempts_write: 'Ghi attempt',
  vocab_unit_recommendations: 'Recommendation',
  vocab_ai_scoring: 'AI scoring',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="avv-stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function Outcome({ id, eyebrow, title, data, delayed = false }: { id: string; eyebrow: string; title: string; data: Immediate | Delayed; delayed?: boolean }) {
  const eligible = data.eligible_unit_starts;
  const measured = delayed ? (data as Delayed).assessed_unit_starts : (data as Immediate).completed_unit_starts;
  const ready = isPilotSampleReady(eligible);
  return <section className="avv-metric-section" aria-labelledby={id}>
    <div className="avv-section-head"><div><p className="avv-eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div><span className={`avv-sample ${ready ? 'is-ready' : 'is-early'}`}>{ready ? 'Đủ mẫu tối thiểu để đọc xu hướng' : `Mẫu sớm · ${eligible}/10 unit-start đủ hạn`}</span></div>
    <div className="avv-stats-grid">
      <Tile label="Đủ cửa sổ đo" value={formatPilotMetric(eligible)} hint={delayed ? 'Chỉ cohort đã đi hết toàn bộ cửa sổ' : 'Đã đủ 24 giờ từ lần bắt đầu'} />
      <Tile label={delayed ? 'Có delayed check' : 'Hoàn tất unit'} value={formatPilotMetric(measured)} hint={delayed ? 'Không tính chưa làm thành sai' : 'Đã thử đủ task của version'} />
      <Tile label={delayed ? 'Follow-up rate' : 'Completion rate'} value={formatPilotMetric(delayed ? (data as Delayed).followup_rate_percent : (data as Immediate).completion_rate_percent, '%')} hint="Mẫu số chỉ gồm cohort đủ hạn" />
      <Tile label="Accuracy" value={formatPilotMetric(data.accuracy_percent, '%')} hint={`${data.attempts} attempts trong cửa sổ`} />
      {delayed ? <Tile label="Productive transfer" value={formatPilotMetric((data as Delayed).transfer_success_percent, '%')} hint={`${(data as Delayed).transfer_attempts} attempts tự tạo câu`} /> : null}
    </div>
  </section>;
}

export function AdminVocabPilotMetrics() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const requested = params?.get('days') ?? '90';
  const [days, setDays] = useState(PERIODS.some(([value]) => value === requested) ? requested : '90');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (period: string) => {
    const requestId = ++sequence.current;
    setLoading(true); setError('');
    try {
      const normalized = normalizePilotMetrics(await window.api.get<unknown>(`/admin/vocabulary/pilot-metrics?days=${encodeURIComponent(period)}`)) as Metrics | null;
      if (!normalized) throw new Error('Backend trả snapshot không đúng contract.');
      if (requestId === sequence.current) {
        setMetrics(normalized);
        return true;
      }
    } catch (caught) {
      if (requestId === sequence.current) setError(`Không tải được số liệu pilot: ${messageOf(caught)}`);
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    setMetrics(null); setNotice(null);
    void load(days);
    return () => { sequence.current += 1; };
  }, [days, load, profile.id]);

  const changeDays = (next: string) => {
    setDays(next);
    const url = new URL(window.location.href);
    url.searchParams.set('days', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const setCohort = async (enabled: boolean) => {
    const id = userId.trim();
    if (!UUID.test(id)) { setNotice({ kind: 'error', message: 'User ID phải là UUID hợp lệ.' }); return; }
    setSaving(true); setNotice(null);
    try {
      const saved = await window.api.post<{ vocab_curated_enabled?: unknown }>(`/admin/vocabulary/pilot-cohort/${encodeURIComponent(id)}`, { enabled });
      if (saved?.vocab_curated_enabled !== enabled) throw new Error('Backend không xác nhận đúng trạng thái.');
      if (!await load(days)) {
        setNotice({
          kind: 'error',
          message: 'Backend đã xác nhận thay đổi nhưng chưa đọc lại được cohort canonical. Hãy tải lại trước khi thao tác tiếp.',
        });
        return;
      }
      setNotice({ kind: 'success', message: enabled ? 'Đã thêm học viên vào cohort Vocab Curated.' : 'Đã rút học viên khỏi cohort Vocab Curated.' });
    } catch (caught) {
      setNotice({ kind: 'error', message: `Không xác nhận được thay đổi cohort: ${messageOf(caught)}` });
    } finally { setSaving(false); }
  };

  return <main className="avv-shell avv-stats-shell avv-pilot-shell">
    <header className="avv-stats-hero"><div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Curated Vocab · Pilot</p><h1>Learning outcomes, không phải page views</h1><p>Đo completion tức thời, delayed check ngày 7 và retention ngày 28 bằng attempts canonical. Mẫu chưa đủ được giữ ở trạng thái “chưa kết luận”.</p></div><div className="avv-stats-actions"><label>Khoảng cohort<select value={days} disabled={loading} onChange={(event) => changeDays(event.target.value)}>{PERIODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="btn-secondary" disabled={loading} type="button" onClick={() => void load(days)}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div></header>
    {error ? <div className="avv-banner is-error" role="alert">{error}</div> : null}
    {notice ? <div className={`avv-banner is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div> : null}
    {loading && !metrics ? <div className="avv-state" role="status">Đang tổng hợp dữ liệu học…</div> : null}
    {metrics ? <>
      <section className="avv-pilot-flags" aria-label="Rollout gates"><div><span>Cohort đang bật</span><strong>{formatPilotMetric(metrics.cohort.enabled_users)}</strong><small>{metrics.cohort.learners_started} học viên đã bắt đầu · {metrics.cohort.unit_starts} unit-start trong {metrics.period_days} ngày</small></div>{Object.entries(metrics.runtime_flags).map(([key, enabled]) => <span className={`adm-status-pill ${enabled ? 'is-live' : 'is-readonly'}`} key={key}>{FLAG_LABELS[key] || key}: {enabled ? 'ON' : 'OFF'}</span>)}</section>
      <Outcome id="pilot-immediate" eyebrow="0–24 giờ" title="Hoàn tất và kiểm soát ban đầu" data={metrics.immediate} />
      <Outcome id="pilot-day7" eyebrow="Ngày 6–10" title="Delayed check khoảng ngày 7" data={metrics.day7} delayed />
      <Outcome id="pilot-day28" eyebrow="Ngày 25–35" title="Retention check khoảng ngày 28" data={metrics.day28} delayed />
      <section className="avv-metric-section" aria-labelledby="pilot-recommendations"><div className="avv-section-head"><div><p className="avv-eyebrow">Speaking → learning</p><h2 id="pilot-recommendations">Recommendation lifecycle</h2></div><p>Opened là mở từ recommendation; completed có thể đến từ mọi lối vào unit. Cả hai đều là server lifecycle.</p></div><div className="avv-stats-grid"><Tile label="Đã tạo" value={formatPilotMetric(metrics.recommendations.created)} hint="Recommendation canonical" /><Tile label="Đã mở từ đề xuất" value={formatPilotMetric(metrics.recommendations.opened)} hint={formatPilotMetric(metrics.recommendations.open_rate_percent, '%')} /><Tile label="Đã hoàn tất unit" value={formatPilotMetric(metrics.recommendations.completed)} hint={formatPilotMetric(metrics.recommendations.completion_rate_percent, '%')} /><Tile label="Đã bỏ qua" value={formatPilotMetric(metrics.recommendations.dismissed)} hint="Chưa có UI dismiss trong V1" /></div></section>
      <section className="avv-metric-section"><div className="avv-section-head"><div><p className="avv-eyebrow">Content diagnosis</p><h2>Theo learning unit</h2></div><p>Không xếp hạng unit khi số mẫu còn nhỏ; bảng giúp phát hiện chỗ cần audit.</p></div><div className="avv-table-wrap"><table className="avv-table avv-pilot-table"><thead><tr><th>Unit</th><th>Started</th><th>Immediate</th><th>Day 7</th><th>Day 28</th></tr></thead><tbody>{metrics.units.length ? metrics.units.map((unit) => <tr key={unit.unit_slug}><td data-label="Unit"><strong>{unit.display_headword}</strong><small>{unit.unit_slug}</small></td><td data-label="Started">{unit.started}</td><td data-label="Immediate">{unit.immediate_completed}/{unit.immediate_eligible}</td><td data-label="Day 7">{unit.day7_assessed}/{unit.day7_eligible}<small>{formatPilotMetric(unit.day7_accuracy_percent, '%')} accuracy</small></td><td data-label="Day 28">{unit.day28_assessed}/{unit.day28_eligible}<small>{formatPilotMetric(unit.day28_accuracy_percent, '%')} accuracy</small></td></tr>) : <tr><td colSpan={5} data-label="Trạng thái">Chưa có unit-start trong khoảng đã chọn.</td></tr>}</tbody></table></div></section>
      <section className="avv-pilot-definitions"><h2>Cách đọc đúng</h2><dl><div><dt>Immediate</dt><dd>24 giờ đầu sau attempt đầu tiên; completion cần thử đủ task của đúng published version.</dd></div><div><dt>Day 7</dt><dd>Attempts từ ngày 6 đến trước ngày 10. Chỉ cohort đã đi hết 10 ngày mới vào mẫu số.</dd></div><div><dt>Day 28</dt><dd>Attempts từ ngày 25 đến trước ngày 35. Chỉ cohort đã đi hết 35 ngày mới vào mẫu số.</dd></div><div><dt>Chưa đủ dữ liệu</dt><dd>Giữ nguyên là null; tuyệt đối không hiển thị thành 0% hoặc kết luận thất bại.</dd></div></dl><small>Snapshot lúc {new Date(metrics.computed_at).toLocaleString('vi-VN')}.</small></section>
    </> : null}
    <section className="avv-flag" aria-labelledby="pilot-cohort-title"><div><p className="avv-eyebrow">Cohort canonical</p><h2 id="pilot-cohort-title">vocab_curated_enabled</h2><p>Mutation cập nhật feature flag và ghi audit event trong cùng transaction. Sau đó dashboard đọc lại số lượng chuẩn.</p></div><div className="avv-flag__controls"><label htmlFor="pilot-user-id">User ID</label><input id="pilot-user-id" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="00000000-0000-4000-8000-000000000000" autoComplete="off" /><div><button className="btn-primary" disabled={saving} type="button" onClick={() => void setCohort(true)}>Thêm vào pilot</button><button className="btn-danger" disabled={saving} type="button" onClick={() => void setCohort(false)}>Rút khỏi pilot</button></div></div></section>
  </main>;
}
