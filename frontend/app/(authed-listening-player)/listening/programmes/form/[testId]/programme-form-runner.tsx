'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { createProgrammeAnswerDraftStore, createProgrammeAnswerWriteQueue, createProgrammeSaveStatusTracker } from '@/lib/listening-programme-answer-queue.mjs';
import { availableQuestionLanguages, displayQuestion, groupProgrammeQuestions } from '@/lib/listening-programme-learning.mjs';
import { confirmProgrammeOncePlayback, startProgrammeOncePlayback } from '@/lib/listening-programme-once-playback.mjs';
import type { ListeningProgrammePlayerWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface Question { q_num: number; source_item_id: string; prompt: string; response_type: string; options: Record<string, string>; visual_url?: string; visual_accessibility?: string }
interface FormData { title: string; programmeId: string; lessonId: string; replayPolicy: string; audioUrl: string; questions: Question[] }
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; form: FormData; attemptId: string };
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export function ProgrammeFormRunner({ testId }: { testId: string }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<'continuous' | 'guided'>('continuous');
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [currentGroup, setCurrentGroup] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<Record<number, number>>({});
  const saveQueue = useRef<ReturnType<typeof createProgrammeAnswerWriteQueue> | null>(null);
  const draftStore = useRef<ReturnType<typeof createProgrammeAnswerDraftStore> | null>(null);
  const saveStatusTracker = useRef(createProgrammeSaveStatusTracker());
  const submitLock = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const groupHeadingRef = useRef<HTMLHeadingElement>(null);
  const onceClaimId = useRef('');
  const [onceState, setOnceState] = useState<'ready' | 'starting' | 'playing' | 'paused' | 'unconfirmed' | 'done'>('ready');
  const [onceMessage, setOnceMessage] = useState('');

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem('av-listening-learning-mode');
      const storedLanguage = localStorage.getItem('av-listening-question-language');
      if (storedMode === 'continuous' || storedMode === 'guided') setMode(storedMode);
      if (storedLanguage === 'vi' || storedLanguage === 'en') setLanguage(storedLanguage);
    } catch { /* Preferences are optional; the form remains usable. */ }
  }, []);

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
    if (status !== 'signed-in' || !user?.id) return;
    let active = true; const controller = new AbortController();
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith && !!window.api?.postWith, 'window.api (programme form)');
      if (!ready || !active) throw new Error('API chưa sẵn sàng');
      const attempt = row(await window.api.postWith<unknown>(`/api/listening/tests/${encodeURIComponent(testId)}/attempts?standalone=true`, {}));
      const attemptId = String(attempt.attempt_id || '');
      const test = row(await window.api.getWith<ListeningProgrammePlayerWire>(`/api/listening/tests/${encodeURIComponent(testId)}?attempt_id=${encodeURIComponent(attemptId)}`, undefined, { signal: controller.signal }));
      if (test.scoring_policy !== 'report_only') throw new Error('Bài này không thuộc chương trình report-only.');
      const sections = Array.isArray(test.sections) ? test.sections : [];
      const exercises = sections.flatMap((value) => {
        const section = row(value); return Array.isArray(section.exercises) ? section.exercises : [];
      });
      const exercise = exercises.map(row).find((value) => row(value.payload).variant === 'programme_form_v1');
      const payload = row(exercise?.payload);
      const questions = (Array.isArray(payload.questions) ? payload.questions : []).map((value) => {
        const question = row(value); const options = row(question.options);
        return { q_num: Number(question.q_num), source_item_id: String(question.source_item_id || ''), prompt: String(question.prompt || ''), response_type: String(question.response_type || ''), options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, String(option)])), visual_url: question.visual_url ? String(question.visual_url) : undefined, visual_accessibility: question.visual_accessibility ? String(question.visual_accessibility) : undefined };
      }).filter((question) => question.q_num > 0);
      const restored: Record<number, string> = {};
      for (const value of (Array.isArray(attempt.answers) ? attempt.answers : [])) { const answer = row(value); restored[Number(answer.q_num)] = String(answer.user_answer || ''); }
      if (!active) return;
      saveStatusTracker.current.reset();
      setSaveState('idle');
      const store = createProgrammeAnswerDraftStore(localStorage, attemptId);
      const recovered = store.load();
      const queue = createProgrammeAnswerWriteQueue(async (qNum, value) => {
        await window.api.patchWith(`/api/listening/tests/attempts/${attemptId}/answers`, { q_num: qNum, user_answer: value });
        store.clearIfCurrent(qNum, value);
      });
      draftStore.current = store;
      saveQueue.current = queue;
      setAnswers({ ...restored, ...recovered });
      setCurrentGroup(0);
      for (const [rawQNum, value] of Object.entries(recovered)) {
        const qNum = Number(rawQNum);
        const operation = saveStatusTracker.current.begin(qNum);
        setSaveState(operation.status);
        void queue.enqueue(qNum, value).then(() => {
          if (active) setSaveState(saveStatusTracker.current.succeed(operation.token));
        }).catch(() => {
          if (active) setSaveState(saveStatusTracker.current.fail(operation.token));
        });
      }
      onceClaimId.current = crypto.randomUUID();
      setOnceMessage('');
      const replayPolicy = String(test.replay_policy || 'allowed');
      const audioUrl = String(test.audio_url || '');
      setOnceState(attempt.playback_started_at || (replayPolicy === 'once' && !audioUrl) ? 'done' : 'ready');
      setState({ status: 'ready', attemptId, form: { title: String(test.title || 'Bài luyện nghe'), programmeId: String(test.programme_id || ''), lessonId: String(test.listening_lesson_id || ''), replayPolicy, audioUrl, questions } });
    })().catch((error: unknown) => { if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được bài nghe.' }); });
    return () => { active = false; controller.abort(); Object.values(pending.current).forEach(window.clearTimeout); pending.current = {}; saveQueue.current = null; draftStore.current = null; submitLock.current = false; };
  }, [status, testId, user?.id]);

  const answeredCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);
  const groups = useMemo(() => state.status === 'ready' ? groupProgrammeQuestions(state.form.questions) as Array<{ key: string; questions: Question[] }> : [], [state]);
  const languages = useMemo(() => state.status === 'ready' ? availableQuestionLanguages(state.form.questions) as string[] : [], [state]);
  const activeLanguage = languages.includes(language) ? language : 'vi';
  const selectedGroup = Math.min(currentGroup, Math.max(groups.length - 1, 0));
  const visibleQuestions = state.status === 'ready' ? (mode === 'guided' ? groups[selectedGroup]?.questions || [] : state.form.questions) : [];
  function chooseMode(value: 'continuous' | 'guided') {
    setMode(value);
    try { localStorage.setItem('av-listening-learning-mode', value); } catch { /* Keep current choice in memory. */ }
  }
  function chooseLanguage(value: 'vi' | 'en') {
    setLanguage(value);
    try { localStorage.setItem('av-listening-question-language', value); } catch { /* Keep current choice in memory. */ }
  }
  function moveToGroup(index: number) {
    setCurrentGroup(index);
    window.requestAnimationFrame(() => groupHeadingRef.current?.focus());
  }
  async function save(qNum: number, value: string) {
    const queue = saveQueue.current;
    if (state.status !== 'ready' || !queue) return;
    const tracker = saveStatusTracker.current;
    const operation = tracker.begin(qNum);
    setSaveState(operation.status);
    try { await queue.enqueue(qNum, value); setSaveState(tracker.succeed(operation.token)); }
    catch { setSaveState(tracker.fail(operation.token)); }
  }
  function update(qNum: number, value: string, immediate = false) {
    if (submitLock.current) return;
    draftStore.current?.remember(qNum, value);
    setAnswers((current) => ({ ...current, [qNum]: value }));
    if (pending.current[qNum]) window.clearTimeout(pending.current[qNum]);
    delete pending.current[qNum];
    if (immediate) void save(qNum, value);
    else pending.current[qNum] = window.setTimeout(() => { delete pending.current[qNum]; void save(qNum, value); }, 650);
  }
  function toggleMultiple(question: Question, key: string) {
    const selected = new Set((answers[question.q_num] || '').split(',').map((value) => value.trim()).filter(Boolean));
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    update(question.q_num, [...selected].sort().join(', '), true);
  }
  async function submit() {
    const queue = saveQueue.current;
    if (state.status !== 'ready' || submitLock.current || !queue) return;
    submitLock.current = true;
    setSubmitting(true);
    const tracker = saveStatusTracker.current;
    const operation = tracker.beginFlush();
    setSaveState(operation.status);
    try {
      Object.values(pending.current).forEach(window.clearTimeout);
      pending.current = {};
      await queue.flush(state.form.questions.map((question) => ({ qNum: question.q_num, value: answers[question.q_num] || '' })));
      setSaveState(tracker.finishFlush(operation.token));
      await window.api.postWith(`/api/listening/tests/attempts/${state.attemptId}/submit`, {});
      draftStore.current?.clear();
      window.location.assign(`/listening/programmes/result/${state.attemptId}`);
    } catch {
      tracker.fail(operation.token);
      setSaveState('error');
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  async function acknowledgeOncePlayback() {
    if (state.status !== 'ready') return false;
    const result = row(await window.api.postWith<unknown>(`/api/listening/tests/attempts/${state.attemptId}/playback-started`, { playback_claim_id: onceClaimId.current }));
    return result.accepted === true;
  }
  async function controlOnce() {
    if (state.status !== 'ready' || ['starting', 'done'].includes(onceState) || !audioRef.current) return;
    if (onceState === 'playing') {
      audioRef.current.pause();
      setOnceState('paused');
      return;
    }
    if (onceState === 'unconfirmed') {
      const result = await confirmProgrammeOncePlayback(audioRef.current, acknowledgeOncePlayback);
      setOnceState(result.state);
      setOnceMessage(result.message);
      return;
    }
    if (onceState === 'paused') {
      try {
        await audioRef.current.play();
        setOnceMessage('');
        setOnceState('playing');
      } catch {
        setOnceMessage('Trình duyệt chưa phát được audio. Hãy thử lại.');
      }
      return;
    }
    setOnceState('starting');
    const result = await startProgrammeOncePlayback(audioRef.current, acknowledgeOncePlayback);
    setOnceState(result.state);
    setOnceMessage(result.message);
  }

  if (state.status === 'loading') return <main className="programme-runner programme-state shell" role="status">Đang chuẩn bị bài nghe…</main>;
  if (state.status === 'error') return <main className="programme-runner programme-state shell is-error" role="alert"><p>{state.message}</p><a href="/listening">Về trang Luyện nghe</a></main>;
  const lessonProgrammePath = state.form.programmeId === 'general-listening-practice' ? 'general' : 'ielts';
  return <main className="programme-runner shell">
    <header className="programme-runner__header"><a href={`/listening/${lessonProgrammePath}/${state.form.lessonId}`}>← Bài học</a><div><p>Luyện nghe theo nhịp của bạn</p><h1>{state.form.title}</h1><span>Nghe, thử trả lời và sửa lại. Đây không phải bài tính band IELTS.</span></div><span>{answeredCount}/{state.form.questions.length} câu đã thử</span></header>
    <section className="programme-learning-controls" aria-label="Tùy chọn luyện nghe">
      <div><span>Cách luyện</span><div className="programme-segmented" role="group" aria-label="Cách luyện"><button type="button" aria-pressed={mode === 'continuous'} onClick={() => chooseMode('continuous')}>Làm liền mạch</button><button type="button" aria-pressed={mode === 'guided'} onClick={() => chooseMode('guided')}>Luyện từng bước</button></div></div>
      <div><span>Ngôn ngữ câu hỏi</span>{languages.length ? <div className="programme-segmented" role="group" aria-label="Ngôn ngữ câu hỏi"><button type="button" aria-pressed={activeLanguage === 'vi'} onClick={() => chooseLanguage('vi')}>Tiếng Việt</button><button type="button" aria-pressed={activeLanguage === 'en'} onClick={() => chooseLanguage('en')}>English</button></div> : <p className="programme-language-note">Đang hiển thị bản gốc; bản dịch được biên tập dần theo bài.</p>}</div>
    </section>
    <div className="programme-learning-workspace">
      <aside className="programme-audio" aria-label="Audio và tiến độ bài nghe">
        <h2>Nghe và khám phá</h2>
        {state.form.replayPolicy === 'once' ? <><audio ref={audioRef} src={state.form.audioUrl || undefined} preload="metadata" onEnded={() => setOnceState('done')} /><button type="button" onClick={() => void controlOnce()} disabled={onceState === 'starting' || onceState === 'done'}>{onceState === 'ready' ? '▶ Bắt đầu lượt nghe duy nhất' : onceState === 'starting' ? 'Đang bắt đầu…' : onceState === 'playing' ? 'Tạm dừng' : onceState === 'paused' ? 'Tiếp tục nghe' : onceState === 'unconfirmed' ? 'Xác nhận lượt nghe' : 'Đã sử dụng lượt nghe'}</button>{onceMessage ? <p role="status">{onceMessage}</p> : null}</> : <audio src={state.form.audioUrl} controls preload="metadata" />}
        <p>{state.form.replayPolicy === 'once' ? 'Bài này chỉ cho phép bắt đầu audio một lần trong lượt làm hiện tại. Chuyển cách luyện không tạo lượt nghe mới.' : 'Bạn có thể nghe lại toàn bài trong lúc làm hoặc sửa câu trả lời.'}</p>
        <div className="programme-learning-progress"><strong>Đường nghe</strong><span>{answeredCount}/{state.form.questions.length} câu đã thử</span><ol aria-label="Tiến độ các câu hỏi">{groups.map((group, index) => <li key={group.key} data-current={mode === 'guided' && index === selectedGroup} data-answered={group.questions.every((question) => !!answers[question.q_num]?.trim())}><button type="button" onClick={() => { chooseMode('guided'); moveToGroup(index); }} aria-label={`Đến câu ${group.questions[0].q_num}`}>{group.questions[0].q_num}</button></li>)}</ol></div>
      </aside>
      <section className="programme-learning-stage" aria-label="Câu hỏi luyện nghe">
        <div className="programme-learning-stage__header"><h2 tabIndex={-1} ref={groupHeadingRef}>{mode === 'guided' ? `Tập trung vào câu ${visibleQuestions[0]?.q_num}` : 'Nghe và trả lời theo mạch'}</h2><p>{mode === 'guided' ? `Câu ${selectedGroup + 1}/${groups.length}` : 'Bạn có thể quay lại sửa bất kỳ câu nào trước khi đối chiếu.'}</p></div>
        <div className="programme-questions">
      {visibleQuestions.map((sourceQuestion) => { const question = displayQuestion(sourceQuestion, activeLanguage) as Question; return <article className="programme-question" key={question.q_num}>
        <span className="programme-question__number">{question.q_num}</span><div className="programme-question__body" lang={languages.length ? activeLanguage : undefined}><p>{question.prompt}</p>
        {question.visual_url ? <img src={question.visual_url} alt={question.visual_accessibility || 'Sơ đồ cho câu hỏi'} /> : null}
        {['single_choice', 'map_label'].includes(question.response_type) ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="radio" name={`q-${question.q_num}`} checked={answers[question.q_num] === key} disabled={submitting} onChange={() => update(question.q_num, key, true)} /><span><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {question.response_type === 'multiple_choice' ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="checkbox" checked={(answers[question.q_num] || '').split(',').map((value) => value.trim()).includes(key)} disabled={submitting} onChange={() => toggleMultiple(question, key)} /><span><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {['short_answer', 'written', 'open_rubric'].includes(question.response_type) ? <textarea rows={question.response_type === 'open_rubric' ? 5 : 2} value={answers[question.q_num] || ''} disabled={submitting} onChange={(event) => update(question.q_num, event.target.value)} onBlur={(event) => { if (pending.current[question.q_num]) window.clearTimeout(pending.current[question.q_num]); delete pending.current[question.q_num]; void save(question.q_num, event.target.value); }} placeholder="Nhập câu trả lời của bạn" /> : null}
        </div>
      </article>; })}
        </div>
        {mode === 'guided' ? <nav className="programme-step-actions" aria-label="Chuyển câu hỏi"><button type="button" disabled={selectedGroup === 0} onClick={() => moveToGroup(selectedGroup - 1)}>Câu trước</button><span>Có thể quay lại và sửa câu trả lời bất cứ lúc nào.</span><button type="button" disabled={selectedGroup >= groups.length - 1} onClick={() => moveToGroup(selectedGroup + 1)}>Câu tiếp theo</button></nav> : null}
      </section>
    </div>
    <footer className="programme-submit"><span aria-live="polite">{saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : saveState === 'error' ? 'Có câu chưa lưu được — hãy thử lại' : 'Câu trả lời được tự động lưu'}</span><button type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? 'Đang nộp…' : 'Nộp và tự đối chiếu'}</button></footer>
  </main>;
}
