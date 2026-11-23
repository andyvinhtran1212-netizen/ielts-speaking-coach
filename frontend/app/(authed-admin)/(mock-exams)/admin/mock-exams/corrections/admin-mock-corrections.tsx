'use client';

import { useCallback, useEffect, useState } from 'react';

import { messageOf } from '@/components/admin-directory-ui';
import {
  normalizeCorrectionContentHealth,
  normalizeCorrectionPerformance,
  normalizeCorrectionTimeline,
} from '@/lib/admin-mock-corrections-model.mjs';

type Performance = ReturnType<typeof normalizeCorrectionPerformance>;
type Health = ReturnType<typeof normalizeCorrectionContentHealth>;
type Timeline = ReturnType<typeof normalizeCorrectionTimeline>;

const STATE_LABEL: Record<string, string> = {
  RESULT_ONLY: 'Mới xem kết quả', EVIDENCE_ATTEMPTED: 'Đã tự tìm bằng chứng',
  LOCATION_HINT_SEEN: 'Đã xem vị trí', DECISIVE_HINT_SEEN: 'Đã xem gợi ý quyết định',
  FULL_EXPLANATION_SEEN: 'Đã mở lời giải', CORRECTION_OUTPUT_SUBMITTED: 'Đã nộp correction output',
  CORRECTION_VERIFIED: 'Đã qua bài sửa cùng nguồn', TRANSFER_PASSED: 'Đã qua transfer',
  RETEST_SCHEDULED: 'Đã hẹn retest', MASTERED: 'Mastered', REOPENED: 'Mở lại',
};

function percent(value: unknown) {
  return value == null ? '—' : `${Math.round(Number(value) * 100)}%`;
}

export function AdminMockCorrections() {
  const [learnerId, setLearnerId] = useState('');
  const [skill, setSkill] = useState('');
  const [classAssignmentId, setClassAssignmentId] = useState('');
  const [mockExamId, setMockExamId] = useState('');
  const [performance, setPerformance] = useState<Performance>(null);
  const [health, setHealth] = useState<Health>(null);
  const [timeline, setTimeline] = useState<Timeline>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setTimeline(null); setSelectedId('');
    const params = new URLSearchParams();
    if (learnerId.trim()) params.set('learner_id', learnerId.trim());
    if (skill) params.set('skill', skill);
    if (classAssignmentId.trim()) params.set('class_assignment_id', classAssignmentId.trim());
    if (mockExamId.trim()) params.set('mock_exam_id', mockExamId.trim());
    try {
      const [rawPerformance, rawHealth] = await Promise.all([
        window.api.get<unknown>(`/admin/mock-corrections/performance${params.size ? `?${params}` : ''}`),
        window.api.get<unknown>('/admin/mock-corrections/content-health'),
      ]);
      const nextPerformance = normalizeCorrectionPerformance(rawPerformance);
      const nextHealth = normalizeCorrectionContentHealth(rawHealth);
      if (!nextPerformance || !nextHealth) throw new Error('Dashboard correction sai contract backend.');
      setPerformance(nextPerformance); setHealth(nextHealth);
    } catch (caught) {
      setError(messageOf(caught));
    } finally { setLoading(false); }
  }, [classAssignmentId, learnerId, mockExamId, skill]);

  // Filters are submitted explicitly; do not refetch on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const openTimeline = async (itemId: string) => {
    setSelectedId(itemId); setTimeline(null); setError('');
    try {
      const value = normalizeCorrectionTimeline(await window.api.get<unknown>(`/admin/mock-corrections/items/${encodeURIComponent(itemId)}/timeline`));
      if (!value) throw new Error('Timeline correction sai contract backend.');
      setTimeline(value);
    } catch (caught) { setError(messageOf(caught)); }
  };

  const summary = performance?.summary || {};
  const funnel = summary.correction_funnel || {};
  const versions = health ? Object.entries(health.versions) : [];

  return <main className="mcd-shell">
    <header className="mcd-hero"><div><p className="mex-kicker">Mock correction · Internal QA</p><h1>Performance & correction funnel</h1><p>Dữ liệu canonical từ item attempts, correction sessions và event ledger.</p></div><a className="adm-btn-secondary" href="/admin/mock-exams">Về kho đề</a></header>

    <section className="mcd-health" aria-label="Trạng thái nội dung QA">
      <div><strong>{health?.object_count ?? '—'}</strong><span>web objects đã import</span></div>
      {versions.map(([version, raw]) => { const row = raw as any; return <div key={version}><strong>{row.current_count || 0}/{row.object_count || 0}</strong><span>{version}</span><small>{row.unbound_internal_qa || 0} unbound QA · {row.rights_blocked || 0} rights blocked · {row.editorial_blocked || 0} editorial blocked · {row.serving_blocked || 0} serving blocked</small></div>; })}
    </section>

    <form className="mcd-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>Học viên ID<input value={learnerId} onChange={(event) => setLearnerId(event.target.value)} placeholder="UUID hoặc để trống" /></label>
      <label>Kỹ năng<select value={skill} onChange={(event) => setSkill(event.target.value)}><option value="">Tất cả</option><option value="reading">Reading</option><option value="listening">Listening</option></select></label>
      <label>Class assignment ID<input value={classAssignmentId} onChange={(event) => { setClassAssignmentId(event.target.value); if (event.target.value) setMockExamId(''); }} placeholder="Một scope mỗi lần" /></label>
      <label>Mock exam ID<input value={mockExamId} onChange={(event) => { setMockExamId(event.target.value); if (event.target.value) setClassAssignmentId(''); }} placeholder="Một scope mỗi lần" /></label>
      <button className="adm-btn-primary" type="submit" disabled={loading}>{loading ? 'Đang tải…' : 'Áp dụng'}</button>
    </form>

    {error ? <div className="mex-alert is-error" role="alert">{error}</div> : null}
    {performance?.malformedCount ? <div className="mex-alert is-warning" role="alert">{performance.malformedCount} item sai contract đã bị loại khỏi dashboard.</div> : null}

    <section className="mcd-cards" aria-label="Tổng quan performance">
      <div><span>Accuracy</span><strong>{percent(summary.accuracy)}</strong><small>{summary.correct_items || 0}/{summary.scored_items || 0} câu</small></div>
      <div><span>Confidence TB</span><strong>{summary.average_confidence ?? '—'}</strong><small>thang 1–5</small></div>
      <div className="is-attention"><span>High-confidence wrong</span><strong>{summary.high_confidence_errors || 0}</strong><small>ưu tiên giáo viên xem</small></div>
      <div><span>Revision rate</span><strong>{percent(summary.revision_rate)}</strong><small>{summary.revised_items || 0} câu đổi đáp án</small></div>
      <div><span>Correction output</span><strong>{percent(summary.correction_completion_rate)}</strong><small>{summary.correction_output_items || 0}/{summary.wrong_items || 0} câu sai</small></div>
    </section>

    <section className="mcd-funnel"><h2>Correction funnel</h2><div>{Object.entries(funnel).map(([key, value]) => <span key={key}><small>{key.replaceAll('_', ' ')}</small><strong>{String(value)}</strong></span>)}</div><p>Mở full explanation không được tính là hoàn thành; mốc hoàn thành hiện tại là đã nộp correction output.</p></section>

    <section className="mcd-workspace">
      <div className="mcd-table-wrap"><table><thead><tr><th>Item</th><th>Kết quả</th><th>Confidence</th><th>Revision</th><th>Attribution</th><th>Correction state</th></tr></thead><tbody>
        {(performance?.items || []).slice(0, 500).map((item: any) => <tr key={item.id} className={selectedId === item.id ? 'is-selected' : ''}>
          <td><button className="mcd-item-link" type="button" onClick={() => void openTimeline(item.id)}><strong>{item.skill} · Q{item.question_number}</strong><small>{item.object_id || 'legacy/no object'}</small></button></td>
          <td>{item.is_correct == null ? '—' : item.is_correct ? 'Đúng' : 'Sai'}</td><td>{item.post_test_confidence ?? '—'}</td><td>{item.revision_count || 0}</td>
          <td>{(item.pre_reveal_self_attribution || []).join(', ') || '—'}</td><td>{STATE_LABEL[item.correction_state] || item.correction_state || 'Chưa mở review'}</td>
        </tr>)}
      </tbody></table>{(performance?.items || []).length > 500 ? <p className="mcd-empty">Đang hiển thị 500 item mới nhất; summary vẫn tính toàn bộ snapshot.</p> : null}{!loading && !(performance?.items || []).length ? <p className="mcd-empty">Chưa có item attempt trong scope này.</p> : null}</div>

      <aside className="mcd-timeline"><h2>Timeline từng câu</h2>{selectedId && !timeline ? <p>Đang tải timeline…</p> : !timeline ? <p>Chọn một item để xem thứ tự event và payload audit.</p> : <>
        <div className="mcd-timeline__state"><strong>{STATE_LABEL[(timeline.correction as any)?.state] || (timeline.correction as any)?.state || 'Chưa có session'}</strong><span>{(timeline.content as any)?.rights_status || 'no content'} · {(timeline.content as any)?.editorial_status || 'no editorial state'}</span></div>
        <ol>{timeline.events.map((event: any) => <li key={event.event_id}><div><strong>{event.sequence_no ?? '—'}. {event.event_name}</strong><time>{event.server_received_at ? new Date(event.server_received_at).toLocaleString('vi-VN') : '—'}</time></div><pre>{JSON.stringify(event.payload || {}, null, 2)}</pre></li>)}</ol>
        {timeline.events_truncated ? <p className="mex-alert is-warning">Timeline đã giới hạn ở 500 events.</p> : null}
      </>}</aside>
    </section>
  </main>;
}
