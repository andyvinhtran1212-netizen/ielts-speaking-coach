'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import type { ListeningProgrammePlayerWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface Question { q_num: number; prompt: string; response_type: string; options: Record<string, string>; visual_url?: string; visual_accessibility?: string }
interface FormData { title: string; programmeId: string; lessonId: string; replayPolicy: string; audioUrl: string; questions: Question[] }
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; form: FormData; attemptId: string };
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export function ProgrammeFormRunner({ testId }: { testId: string }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<Record<number, number>>({});
  const audioRef = useRef<HTMLAudioElement>(null);
  const [onceState, setOnceState] = useState<'ready' | 'playing' | 'paused' | 'done'>('ready');

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
    if (status !== 'signed-in' || !user?.id) return;
    let active = true; const controller = new AbortController();
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith && !!window.api?.postWith, 'window.api (programme form)');
      if (!ready || !active) throw new Error('API chưa sẵn sàng');
      const test = row(await window.api.getWith<ListeningProgrammePlayerWire>(`/api/listening/tests/${encodeURIComponent(testId)}`, undefined, { signal: controller.signal }));
      if (test.scoring_policy !== 'report_only') throw new Error('Bài này không thuộc chương trình report-only.');
      const sections = Array.isArray(test.sections) ? test.sections : [];
      const exercises = sections.flatMap((value) => {
        const section = row(value); return Array.isArray(section.exercises) ? section.exercises : [];
      });
      const exercise = exercises.map(row).find((value) => row(value.payload).variant === 'programme_form_v1');
      const payload = row(exercise?.payload);
      const questions = (Array.isArray(payload.questions) ? payload.questions : []).map((value) => {
        const question = row(value); const options = row(question.options);
        return { q_num: Number(question.q_num), prompt: String(question.prompt || ''), response_type: String(question.response_type || ''), options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, String(option)])), visual_url: question.visual_url ? String(question.visual_url) : undefined, visual_accessibility: question.visual_accessibility ? String(question.visual_accessibility) : undefined };
      }).filter((question) => question.q_num > 0);
      const progress = row(await window.api.getWith<unknown>(`/api/listening/tests/${encodeURIComponent(testId)}/attempts/in-progress`, undefined, { signal: controller.signal }));
      let attempt = row(progress.attempt);
      if (!attempt.attempt_id) attempt = row(await window.api.postWith<unknown>(`/api/listening/tests/${encodeURIComponent(testId)}/attempts`, {}));
      const restored: Record<number, string> = {};
      for (const value of (Array.isArray(attempt.answers) ? attempt.answers : [])) { const answer = row(value); restored[Number(answer.q_num)] = String(answer.user_answer || ''); }
      if (!active) return;
      setAnswers(restored);
      const attemptId = String(attempt.attempt_id || '');
      setOnceState(localStorage.getItem(`listening-once:${attemptId}`) ? 'done' : 'ready');
      setState({ status: 'ready', attemptId, form: { title: String(test.title || 'Bài luyện nghe'), programmeId: String(test.programme_id || ''), lessonId: String(test.listening_lesson_id || ''), replayPolicy: String(test.replay_policy || 'allowed'), audioUrl: String(test.audio_url || ''), questions } });
    })().catch((error: unknown) => { if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được bài nghe.' }); });
    return () => { active = false; controller.abort(); Object.values(pending.current).forEach(window.clearTimeout); };
  }, [status, testId, user?.id]);

  const answeredCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);
  async function save(qNum: number, value: string, failSubmit = false) {
    if (state.status !== 'ready') return;
    setSaveState('saving');
    try { await window.api.patchWith(`/api/listening/tests/attempts/${state.attemptId}/answers`, { q_num: qNum, user_answer: value }); setSaveState('saved'); }
    catch (error) { setSaveState('error'); if (failSubmit) throw error; }
  }
  function update(qNum: number, value: string, immediate = false) {
    setAnswers((current) => ({ ...current, [qNum]: value }));
    if (pending.current[qNum]) window.clearTimeout(pending.current[qNum]);
    if (immediate) void save(qNum, value);
    else pending.current[qNum] = window.setTimeout(() => void save(qNum, value), 650);
  }
  function toggleMultiple(question: Question, key: string) {
    const selected = new Set((answers[question.q_num] || '').split(',').map((value) => value.trim()).filter(Boolean));
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    update(question.q_num, [...selected].sort().join(', '), true);
  }
  async function submit() {
    if (state.status !== 'ready' || submitting) return;
    setSubmitting(true);
    try {
      Object.values(pending.current).forEach(window.clearTimeout);
      pending.current = {};
      await Promise.all(state.form.questions.map((question) => save(question.q_num, answers[question.q_num] || '', true)));
      await window.api.postWith(`/api/listening/tests/attempts/${state.attemptId}/submit`, {});
      window.location.assign(`/listening/programmes/result/${state.attemptId}`);
    } catch { setSaveState('error'); setSubmitting(false); }
  }
  function controlOnce() {
    if (state.status !== 'ready' || onceState === 'done' || !audioRef.current) return;
    if (onceState === 'playing') {
      audioRef.current.pause();
      setOnceState('paused');
      return;
    }
    if (onceState === 'ready') localStorage.setItem(`listening-once:${state.attemptId}`, 'used');
    setOnceState('playing');
    void audioRef.current.play();
  }

  if (state.status === 'loading') return <main className="programme-runner programme-state" role="status">Đang chuẩn bị bài nghe…</main>;
  if (state.status === 'error') return <main className="programme-runner programme-state is-error" role="alert"><p>{state.message}</p><a href="/listening">Về trang Luyện nghe</a></main>;
  const lessonProgrammePath = state.form.programmeId === 'general-listening-practice' ? 'general' : 'ielts';
  return <main className="programme-runner">
    <header className="programme-runner__header"><a href={`/listening/${lessonProgrammePath}/${state.form.lessonId}`}>← Bài học</a><div><p>Report-only · Không quy đổi band</p><h1>{state.form.title}</h1></div><span>{answeredCount}/{state.form.questions.length} câu</span></header>
    <section className="programme-audio" aria-label="Audio bài nghe">
      {state.form.replayPolicy === 'once' ? <><audio ref={audioRef} src={state.form.audioUrl} preload="metadata" onEnded={() => setOnceState('done')} /><button type="button" onClick={controlOnce} disabled={onceState === 'done'}>{onceState === 'ready' ? '▶ Bắt đầu lượt nghe duy nhất' : onceState === 'playing' ? 'Tạm dừng' : onceState === 'paused' ? 'Tiếp tục nghe' : 'Đã sử dụng lượt nghe'}</button></> : <audio src={state.form.audioUrl} controls preload="metadata" />}
      <p>{state.form.replayPolicy === 'once' ? 'Bài này chỉ cho phép bắt đầu audio một lần trong lượt làm hiện tại.' : 'Bạn có thể nghe lại để luyện tập.'}</p>
    </section>
    <section className="programme-questions">
      {state.form.questions.map((question) => <article className="programme-question" key={question.q_num}>
        <span className="programme-question__number">{question.q_num}</span><div className="programme-question__body"><p>{question.prompt}</p>
        {question.visual_url ? <img src={question.visual_url} alt={question.visual_accessibility || 'Sơ đồ cho câu hỏi'} /> : null}
        {['single_choice', 'map_label'].includes(question.response_type) ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="radio" name={`q-${question.q_num}`} checked={answers[question.q_num] === key} onChange={() => update(question.q_num, key, true)} /><span><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {question.response_type === 'multiple_choice' ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="checkbox" checked={(answers[question.q_num] || '').split(',').map((value) => value.trim()).includes(key)} onChange={() => toggleMultiple(question, key)} /><span><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {['short_answer', 'written', 'open_rubric'].includes(question.response_type) ? <textarea rows={question.response_type === 'open_rubric' ? 5 : 2} value={answers[question.q_num] || ''} onChange={(event) => update(question.q_num, event.target.value)} onBlur={(event) => void save(question.q_num, event.target.value)} placeholder="Nhập câu trả lời của bạn" /> : null}
        </div>
      </article>)}
    </section>
    <footer className="programme-submit"><span aria-live="polite">{saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : saveState === 'error' ? 'Có câu chưa lưu được — hãy thử lại' : 'Câu trả lời được tự động lưu'}</span><button type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? 'Đang nộp…' : 'Nộp và tự đối chiếu'}</button></footer>
  </main>;
}
