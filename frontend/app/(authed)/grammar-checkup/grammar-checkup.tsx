'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';

type Session = ApiGetJson<'/api/grammar/diagnostics/sessions/{session_id}'>;
type NextResponse = ApiPostJson<'/api/grammar/diagnostics/sessions/{session_id}/next'>;
type Item = NonNullable<NextResponse['item']>;
type AnswerResponse = ApiPostJson<'/api/grammar/diagnostics/sessions/{session_id}/responses'>;
type Report = ApiGetJson<'/api/grammar/diagnostics/sessions/{session_id}/report'>;
type Availability = ApiGetJson<'/api/grammar/diagnostics/availability'>;

function messageOf(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return String(caught || 'Có lỗi xảy ra.');
}

export function GrammarCheckup() {
  const router = useRouter();
  const search = useSearchParams();
  const assignmentItem = search?.get('assignment_item') || '';
  const requestedSession = search?.get('session') || '';
  const requestedView = search?.get('view') || '';
  const [phase, setPhase] = useState<'loading' | 'assigned-only' | 'setup' | 'question' | 'report' | 'error'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'ENTRY' | 'REVIEW'>('ENTRY');
  const [module, setModule] = useState<'GENERAL' | 'ACADEMIC'>('GENERAL');
  const [length, setLength] = useState<'QUICK' | 'FULL'>('QUICK');
  const openedAt = useRef(Date.now());
  const booted = useRef(false);

  const showReport = useCallback(async (sessionId: string) => {
    const value = await window.api.get<Report>(`/api/grammar/diagnostics/sessions/${encodeURIComponent(sessionId)}/report`);
    setReport(value); setPhase('report'); setItem(null);
  }, []);

  const loadNext = useCallback(async (sessionId: string) => {
    const value = await window.api.post<NextResponse>(
      `/api/grammar/diagnostics/sessions/${encodeURIComponent(sessionId)}/next`,
    );
    if (value.complete) { await showReport(sessionId); return; }
    if (!value.item) throw new Error('Máy chủ không trả câu hỏi hợp lệ.');
    setItem(value.item); setSelected(null); openedAt.current = Date.now(); setPhase('question');
  }, [showReport]);

  const enterSession = useCallback(async (sessionId: string) => {
    const current = await window.api.get<Session>(`/api/grammar/diagnostics/sessions/${encodeURIComponent(sessionId)}`);
    setSession(current);
    if (current.status === 'completed') await showReport(sessionId);
    else await loadNext(sessionId);
  }, [loadNext, showReport]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        if (requestedSession) {
          if (requestedView === 'report') await showReport(requestedSession);
          else await enterSession(requestedSession);
          return;
        }
        if (assignmentItem) {
          const created = await window.api.post<Session>('/api/grammar/diagnostics/sessions', {
            mode: 'REVIEW', module: 'GENERAL', test_length: 'QUICK',
            class_assignment_item_id: assignmentItem,
          });
          router.replace(`/grammar-checkup?session=${encodeURIComponent(created.id)}`);
          await enterSession(created.id);
          return;
        }
        const availability = await window.api.get<Availability>('/api/grammar/diagnostics/availability');
        setPhase(availability.assigned_only ? 'assigned-only' : 'setup');
      } catch (caught) { setError(messageOf(caught)); setPhase('error'); }
    })();
  }, [assignmentItem, enterSession, requestedSession, requestedView, router, showReport]);

  const start = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const created = await window.api.post<Session>('/api/grammar/diagnostics/sessions', {
        mode, module, test_length: length,
      });
      router.replace(`/grammar-checkup?session=${encodeURIComponent(created.id)}`);
      setSession(created); await loadNext(created.id);
    } catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(false); }
  };

  const answer = async () => {
    if (busy || selected == null || !session || !item) return;
    setBusy(true); setError('');
    try {
      const result = await window.api.post<AnswerResponse>(
        `/api/grammar/diagnostics/sessions/${encodeURIComponent(session.id)}/responses`,
        {
          item_id: item.item_id, selected_option: selected,
          response_time_ms: Math.max(0, Date.now() - openedAt.current), assistance_used: false,
        },
      );
      setSession({ ...session, answered: result.answered, remaining: result.remaining, status: result.complete ? 'completed' : session.status });
      if (result.complete) await showReport(session.id);
      else await loadNext(session.id);
    } catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(false); }
  };

  if (phase === 'loading') return <main className="gd-shell"><div className="gd-empty">Đang mở Grammar Check-up…</div></main>;
  if (phase === 'error') return <main className="gd-shell"><div className="gd-empty gd-error" role="alert"><strong>Không mở được Grammar Check-up.</strong><p>{error}</p><a className="av-button av-button-secondary" href="/my-class">Quay lại My Class</a></div></main>;
  if (phase === 'assigned-only') return <main className="gd-shell"><div className="gd-empty"><strong>Grammar Check-up đang ở giai đoạn giao qua lớp.</strong><p>Hãy mở bài Grammar giáo viên đã giao trong My Class. Chế độ tự luyện công khai sẽ được mở ở một đợt riêng sau khi hoàn tất đánh giá thực tế.</p><a className="av-button av-button-primary" href="/my-class">Mở My Class</a></div></main>;

  if (phase === 'setup') return (
    <main className="gd-shell">
      <a className="gd-back" href="/grammar">← Grammar Wiki</a>
      <header className="gd-hero">
        <div><p className="gd-eyebrow">MASTER30 · BETA</p><h1>Grammar Diagnostic & Adaptive Review</h1><p>Nhận diện điểm nghẽn ngữ pháp theo 14 năng lực, rồi đề xuất tuyến ôn phù hợp. Kết quả là hồ sơ sẵn sàng, không phải band IELTS.</p></div>
        <span className="gd-beta">Structural alpha</span>
      </header>
      <section className="gd-setup" aria-labelledby="gd-start-title">
        <div><p className="gd-kicker">Bắt đầu</p><h2 id="gd-start-title">Chọn độ sâu phù hợp</h2></div>
        <div className="gd-choice-grid" role="radiogroup" aria-label="Độ dài bài kiểm tra">
          <button type="button" role="radio" className={length === 'QUICK' ? 'is-selected' : ''} aria-checked={length === 'QUICK'} onClick={() => setLength('QUICK')}><strong>Quick Check-up</strong><span>28 câu · khoảng 15–20 phút</span><small>18 câu sàng lọc + 10 câu xác nhận</small></button>
          <button type="button" role="radio" className={length === 'FULL' ? 'is-selected' : ''} aria-checked={length === 'FULL'} onClick={() => setLength('FULL')}><strong>Full Diagnostic</strong><span>54 câu · có thể tạm dừng</span><small>34 câu diện rộng + 20 câu xác nhận</small></button>
        </div>
        <div className="gd-fields">
          <label>Điểm xuất phát<select value={mode} onChange={(event) => setMode(event.target.value as 'ENTRY' | 'REVIEW')}><option value="ENTRY">Kiểm tra nền tảng phổ thông</option><option value="REVIEW">Ôn theo chương trình MASTER30</option></select></label>
          <label>Hướng học<select value={module} onChange={(event) => setModule(event.target.value as 'GENERAL' | 'ACADEMIC')}><option value="GENERAL">General English / IELTS chung</option><option value="ACADEMIC">IELTS Academic</option></select></label>
        </div>
        <div className="gd-note"><strong>Tự chấm phần trắc nghiệm.</strong> Bài tạo câu không tự chấm và chỉ xuất hiện khi giáo viên giao riêng.</div>
        {error && <div className="gd-inline-error" role="alert">{error}</div>}
        <button className="av-button av-button-primary gd-start" type="button" onClick={() => void start()} disabled={busy}>{busy ? 'Đang tạo phiên…' : 'Bắt đầu check-up'}</button>
      </section>
    </main>
  );

  if (phase === 'question' && session && item) {
    const progress = Math.max(1, Math.round(((item.ordinal - 1) / item.total) * 100));
    return (
      <main className="gd-shell gd-session">
        <header className="gd-session-head"><div><p className="gd-eyebrow">{session.test_length === 'QUICK' ? 'QUICK CHECK-UP' : 'FULL DIAGNOSTIC'}</p><h1>{item.phase === 'BASELINE' ? 'Sàng lọc diện rộng' : 'Xác nhận có trọng tâm'}</h1></div><span>{item.ordinal}/{item.total}</span></header>
        <div className="gd-progress" aria-label={`Đã đến câu ${item.ordinal} trên ${item.total}`}><i style={{ width: `${progress}%` }} /></div>
        <p className="gd-save">Câu trả lời được lưu sau mỗi câu · có thể quay lại sau</p>
        <section className="gd-question" aria-labelledby="gd-question-text">
          <div className="gd-question-meta"><span>{item.phase === 'BASELINE' ? 'Sàng lọc' : 'Xác nhận'}</span><span>Chọn một đáp án</span></div>
          <h2 id="gd-question-text">{item.prompt}</h2>
          <div className="gd-options" role="radiogroup" aria-label="Các lựa chọn">
            {item.options.map((option, index) => <button key={`${index}-${option}`} type="button" role="radio" className={selected === index ? 'is-selected' : ''} aria-checked={selected === index} onClick={() => setSelected(index)}><b>{String.fromCharCode(65 + index)}</b><span>{option}</span></button>)}
          </div>
          {error && <div className="gd-inline-error" role="alert">{error}</div>}
          <div className="gd-question-actions"><span>Đáp án và giải thích được giữ kín đến cuối phiên.</span><button className="av-button av-button-primary" type="button" disabled={selected == null || busy} onClick={() => void answer()}>{busy ? 'Đang lưu…' : item.ordinal === item.total ? 'Hoàn tất & xem báo cáo' : 'Lưu & tiếp tục'}</button></div>
        </section>
      </main>
    );
  }

  if (phase === 'report' && report) return (
    <main className="gd-shell gd-report">
      <a className="gd-back" href="/my-class">← Quay lại My Class</a>
      <header className="gd-report-hero"><p className="gd-eyebrow">GRAMMAR READINESS PROFILE</p><h1>Bản đồ ưu tiên của bạn</h1><p>{report.calibration_note}</p></header>
      <section className="gd-report-section"><div className="gd-section-title"><span>01</span><div><p>Ưu tiên ôn tập</p><h2>Tập trung tối đa ba điểm gốc</h2></div></div>{report.priorities.length ? <div className="gd-priority-list">{report.priorities.map((priority, index) => <article className="gd-priority" key={priority.attribute_id}><div className="gd-priority-no">{index + 1}</div><div><div className="gd-priority-head"><span>{priority.attribute_id}</span><span>{priority.confidence_label}</span></div><h3>{priority.title}</h3><p>{priority.observed_pattern}</p><p className="gd-risk">{priority.risk}</p>{priority.contrast_example && <code>{priority.contrast_example}</code>}<p><strong>Bước tiếp theo:</strong> {priority.next_action}</p><div className="gd-evidence">{priority.evidence_status.independent_items} mẫu độc lập{priority.lesson_sources ? ` · Ôn B${priority.lesson_sources.replaceAll('B', '').replaceAll(',', ', B')}` : ''}</div>{priority.route_id && <a className="av-button av-button-secondary" href={`/grammar-checkup/review/${encodeURIComponent(priority.route_id)}?session=${encodeURIComponent(report.session_id)}`}>Mở tuyến ôn</a>}</div></article>)}</div> : <div className="gd-empty">Chưa có điểm yếu đủ bằng chứng để đưa vào top ưu tiên.</div>}</section>
      <section className="gd-report-grid"><div><p className="gd-kicker">Điểm đang làm được</p><h2>Tín hiệu tích cực</h2>{report.strengths.length ? report.strengths.map((row) => <div className="gd-mini-card" key={row.attribute_id}><strong>{row.title}</strong><span>{row.state === 'CONFIRMED_STRENGTH' ? 'Đã xác nhận' : 'Tạm thời'} · {row.independent_items} mẫu</span></div>) : <p>Chưa có vùng đủ bằng chứng để gọi là điểm mạnh.</p>}</div><div><p className="gd-kicker">Cần thêm bằng chứng</p><h2>Chưa kết luận</h2><div className="gd-tags">{report.insufficient_evidence.map((row) => <span key={row.attribute_id}>{row.attribute_id} · {row.title}</span>)}</div></div></section>
      <div className="gd-note"><strong>Phần productive:</strong> {report.productive_note}</div>
      <div className="gd-report-actions"><a className="av-button av-button-secondary" href="/grammar">Mở Grammar Wiki</a><a className="av-button av-button-primary" href="/my-class">Quay lại My Class</a></div>
    </main>
  );

  return <main className="gd-shell"><div className="gd-empty">Đang chuẩn bị nội dung…</div></main>;
}
