'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import type { ListeningLessonDetailWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface FormCard { id: string; title: string; purpose: string; replay: string; support: string; itemCount: number; durationSeconds: number; checkedCount: number; selfReviewCount: number; status: string; assisted: boolean; attemptId: string | null }
interface Lesson { programmeId: string; title: string; instructions: string; outcomes: string[]; forms: FormCard[]; partial: boolean }
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; lesson: Lesson };
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
const PURPOSE: Record<string, string> = { practice: 'Luyện tập', transfer: 'Vận dụng', checkpoint: 'Kiểm tra' };

export function ListeningLessonDetail({ lessonId }: { lessonId: string }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
    if (status !== 'signed-in' || !user?.id) return;
    const controller = new AbortController(); let active = true;
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (listening lesson)');
      if (!ready || !active) throw new Error('API unavailable');
      const payload = row(await window.api.getWith<ListeningLessonDetailWire>(`/api/listening/lessons/${encodeURIComponent(lessonId)}`, undefined, { signal: controller.signal }));
      const forms = (Array.isArray(payload.forms) ? payload.forms : []).map((value) => {
        const form = row(value);
        return { id: String(form.id || ''), title: String(form.title || 'Bài nghe'), purpose: String(form.purpose || 'practice'), replay: String(form.replay_policy || 'allowed'), support: String(form.support_policy || 'separate_mode'), itemCount: Number(form.item_count || 0), durationSeconds: Number(form.duration_seconds || 0), checkedCount: Number(form.checked_item_count || 0), selfReviewCount: Number(form.self_review_item_count || 0), status: String(form.status || 'new'), assisted: form.assisted === true, attemptId: form.attempt_id ? String(form.attempt_id) : null };
      }).filter((form) => form.id);
      if (active) setState({ status: 'ready', lesson: { programmeId: String(payload.programme_id || ''), title: String(payload.title || 'Bài nghe'), instructions: String(payload.instructions || ''), outcomes: Array.isArray(payload.outcomes) ? payload.outcomes.map(String) : [], forms, partial: payload.partial_data === true } });
    })().catch((error: unknown) => { if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error' }); });
    return () => { active = false; controller.abort(); };
  }, [lessonId, status, user?.id]);

  const programmeHref = state.status === 'ready' && state.lesson.programmeId === 'general-listening-practice' ? '/listening/general' : '/listening/ielts';
  return <main className="shell listening-lesson-detail">
    <a className="listening-back" href={programmeHref}>← Thư viện chương trình</a>
    {state.status === 'loading' ? <div className="listening-state" role="status">Đang tải bài học…</div> : null}
    {state.status === 'error' ? <div className="listening-state is-error" role="alert"><p>Không tải được bài học.</p><button type="button" onClick={() => window.location.reload()}>Thử lại</button></div> : null}
    {state.status === 'ready' ? <>
      <header className="listening-library__hero"><p className="listening-kicker">Bài học</p><h1>{state.lesson.title}</h1><p>{state.lesson.instructions}</p></header>
      {state.lesson.outcomes.length ? <section className="listening-outcomes"><h2>Mục tiêu luyện tập</h2><ul>{state.lesson.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ul></section> : null}
      {state.lesson.partial ? <div className="error-banner" role="status">Tiến độ tạm thời chưa đầy đủ.</div> : null}
      <section className="listening-form-list" aria-labelledby="form-list-title"><div className="listening-section-heading"><div><p className="listening-kicker">Các lượt luyện</p><h2 id="form-list-title">Chọn bài nghe</h2></div><span>Không chấm band · có thể đối chiếu từng câu</span></div>
        {state.lesson.forms.length ? state.lesson.forms.map((form, index) => {
          const resultHref = form.status === 'completed' && form.attemptId ? `/listening/programmes/result/${form.attemptId}` : null;
          const duration = form.durationSeconds ? `${Math.max(1, Math.ceil(form.durationSeconds / 60))} phút` : 'Chưa rõ thời lượng';
          const feedback = [form.checkedCount ? `${form.checkedCount} câu kiểm tra tự động` : '', form.selfReviewCount ? `${form.selfReviewCount} câu tự đối chiếu` : ''].filter(Boolean).join(' · ');
          const support = form.support === 'available' ? 'Có hỗ trợ' : 'Hỗ trợ ở chế độ riêng';
          return <article className="listening-form-card" key={form.id}><span className="listening-form-card__index">{String(index + 1).padStart(2, '0')}</span><div><p>{PURPOSE[form.purpose] || 'Bài nghe'} · {form.itemCount} câu · {duration}{form.assisted ? ' · Có hỗ trợ' : ''}</p><h3>{form.title}</h3><small>{form.replay === 'once' ? 'Nghe một lần' : 'Được nghe lại'} · {support}{feedback ? ` · ${feedback}` : ''}</small></div><a href={resultHref || `/listening/programmes/form/${form.id}`}>{resultHref ? 'Xem lại' : form.status === 'in_progress' ? 'Tiếp tục' : 'Bắt đầu'} →</a></article>;
        }) : <div className="listening-state"><p>Chưa có bài nghe được xuất bản.</p></div>}
      </section>
    </> : null}
  </main>;
}
