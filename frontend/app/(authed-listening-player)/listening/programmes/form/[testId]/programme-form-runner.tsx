'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { createProgrammeAnswerDraftStore, createProgrammeAnswerWriteQueue, createProgrammeSaveStatusTracker } from '@/lib/listening-programme-answer-queue.mjs';
import { availableQuestionLanguages, displayOptionLanguage, displayQuestion, groupProgrammeQuestions } from '@/lib/listening-programme-learning.mjs';
import { confirmProgrammeOncePlayback, startProgrammeOncePlayback } from '@/lib/listening-programme-once-playback.mjs';
import { createProgrammeReplayController } from '@/lib/listening-programme-replay.mjs';
import type { ListeningGuidedStateWire, ListeningProgrammePlayerWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface Question { q_num: number; source_item_id: string; prompt: string; response_type: string; options: Record<string, string>; visual_url?: string; visual_accessibility?: string; editorial_translation?: unknown }
interface FormData { title: string; programmeId: string; lessonId: string; replayPolicy: string; audioUrl: string; questions: Question[]; guidanceAvailable: boolean }
type FeedbackItem = NonNullable<ListeningGuidedStateWire['items']>[number];
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; form: FormData; attemptId: string };
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export function ProgrammeFormRunner({ testId }: { testId: string }) {
  const { status, user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<Record<number, FeedbackItem>>({});
  const [revealStatus, setRevealStatus] = useState<Record<number, 'revealing' | 'error' | 'unavailable'>>({});
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
  const revealPromises = useRef<Map<number, Promise<void>>>(new Map());
  const audioRef = useRef<HTMLAudioElement>(null);
  const replayController = useRef<ReturnType<typeof createProgrammeReplayController> | null>(null);
  if (!replayController.current) replayController.current = createProgrammeReplayController(() => audioRef.current);
  const groupHeadingRef = useRef<HTMLHeadingElement>(null);
  const onceClaimId = useRef('');
  const [onceState, setOnceState] = useState<'ready' | 'starting' | 'playing' | 'paused' | 'unconfirmed' | 'done'>('ready');
  const [onceMessage, setOnceMessage] = useState('');
  const [audioError, setAudioError] = useState('');

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
        return { q_num: Number(question.q_num), source_item_id: String(question.source_item_id || ''), prompt: String(question.prompt || ''), response_type: String(question.response_type || ''), options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, String(option)])), visual_url: question.visual_url ? String(question.visual_url) : undefined, visual_accessibility: question.visual_accessibility ? String(question.visual_accessibility) : undefined, editorial_translation: question.editorial_translation };
      }).filter((question) => question.q_num > 0);
      const restored: Record<number, string> = {};
      for (const value of (Array.isArray(attempt.answers) ? attempt.answers : [])) { const answer = row(value); restored[Number(answer.q_num)] = String(answer.user_answer || ''); }
      let guided: ListeningGuidedStateWire | null = null;
      try {
        guided = await window.api.getWith<ListeningGuidedStateWire>(`/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/guided-state`, undefined, { signal: controller.signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        // A mixed-version deployment or temporary endpoint outage must not
        // make the existing answer-and-submit programme flow unusable.
      }
      const revealed = Object.fromEntries((guided?.items || []).map((item) => [item.q_num, item]));
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
      setFeedback(revealed);
      setRevealStatus({});
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
      setState({ status: 'ready', attemptId, form: { title: String(test.title || 'Bài luyện nghe'), programmeId: String(test.programme_id || ''), lessonId: String(test.listening_lesson_id || ''), replayPolicy, audioUrl, questions, guidanceAvailable: guided !== null } });
    })().catch((error: unknown) => { if (active && !(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được bài nghe.' }); });
    return () => { active = false; controller.abort(); Object.values(pending.current).forEach(window.clearTimeout); pending.current = {}; saveQueue.current = null; draftStore.current = null; submitLock.current = false; replayController.current?.dispose(); revealPromises.current.clear(); };
  }, [status, testId, user?.id]);

  const answeredCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);
  const groups = useMemo(() => state.status === 'ready' ? groupProgrammeQuestions(state.form.questions) as Array<{ key: string; questions: Question[] }> : [], [state]);
  const languages = useMemo(() => state.status === 'ready' ? availableQuestionLanguages(state.form.questions) as string[] : [], [state]);
  const bilingualWritten = state.status === 'ready' && languages.length > 0 && state.form.questions.some((question) => ['short_answer', 'written', 'open_rubric'].includes(question.response_type));
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
  async function reveal(qNum: number) {
    const queue = saveQueue.current;
    if (state.status !== 'ready' || !state.form.guidanceAvailable || !queue || submitLock.current
        || feedback[qNum] || revealPromises.current.has(qNum)
        || !answers[qNum]?.trim()) return;
    const value = answers[qNum];
    if (pending.current[qNum]) window.clearTimeout(pending.current[qNum]);
    delete pending.current[qNum];
    setRevealStatus((current) => ({ ...current, [qNum]: 'revealing' }));
    const operation = (async () => {
      // A failed or ambiguous PATCH never leads to a protected-key response.
      await queue.flush([{ qNum, value }]);
      const result = await window.api.postWith<ListeningGuidedStateWire>(
        `/api/listening/tests/attempts/${encodeURIComponent(state.attemptId)}/questions/${qNum}/reveal`, {},
      );
      const item = (result.items || []).find((candidate) => candidate.q_num === qNum);
      if (!item) throw new Error('Không xác minh được phần đối chiếu.');
      setFeedback((current) => ({ ...current, [qNum]: item }));
      setRevealStatus((current) => { const next = { ...current }; delete next[qNum]; return next; });
    })();
    revealPromises.current.set(qNum, operation);
    try { await operation; }
    catch (error: unknown) {
      const statusCode = row(error).status;
      setRevealStatus((current) => ({ ...current, [qNum]: [403, 404, 409, 422].includes(Number(statusCode)) ? 'unavailable' : 'error' }));
    }
    finally { revealPromises.current.delete(qNum); }
  }
  async function submit() {
    const queue = saveQueue.current;
    if (state.status !== 'ready' || submitLock.current || !queue
        || revealPromises.current.size) return;
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
  function replayQuestion(item: FeedbackItem) {
    if (state.status !== 'ready' || state.form.replayPolicy !== 'allowed') return;
    setAudioError('');
    void replayController.current?.replay(item.audio_window).then((started) => {
      if (!started) setAudioError('Không phát được đoạn nghe. Bạn có thể thử lại hoặc dùng audio toàn bài.');
    });
  }

  if (state.status === 'loading') return <main className="programme-runner programme-state shell" role="status">Đang chuẩn bị bài nghe…</main>;
  if (state.status === 'error') return <main className="programme-runner programme-state shell is-error" role="alert"><p>{state.message}</p><a href="/listening">Về trang Luyện nghe</a></main>;
  const lessonProgrammePath = state.form.programmeId === 'general-listening-practice' ? 'general' : 'ielts';
  return <main className="programme-runner shell">
    <header className="programme-runner__header"><a href={`/listening/${lessonProgrammePath}/${state.form.lessonId}`}>← Bài học</a><div><p>Luyện nghe theo nhịp của bạn</p><h1>{state.form.title}</h1><span>Nghe, thử trả lời và sửa lại. Đây không phải bài tính band IELTS.</span></div><span>{answeredCount}/{state.form.questions.length} câu đã thử</span></header>
    <section className="programme-learning-controls" aria-label="Tùy chọn luyện nghe">
      <div><span>Cách luyện</span><div className="programme-segmented" role="group" aria-label="Cách luyện"><button type="button" aria-pressed={mode === 'continuous'} onClick={() => chooseMode('continuous')}>Làm liền mạch</button><button type="button" aria-pressed={mode === 'guided'} onClick={() => chooseMode('guided')}>Luyện từng bước</button></div></div>
      <div><span>Ngôn ngữ câu hỏi</span>{languages.length ? <div className="programme-segmented" role="group" aria-label="Ngôn ngữ câu hỏi"><button type="button" aria-pressed={activeLanguage === 'vi'} onClick={() => chooseLanguage('vi')}>Tiếng Việt</button><button type="button" aria-pressed={activeLanguage === 'en'} onClick={() => chooseLanguage('en')}>English</button></div> : <p className="programme-language-note">Đang hiển thị bản gốc; bản dịch được biên tập dần theo bài.</p>}{bilingualWritten ? <p className="programme-language-note">Đổi ngôn ngữ chỉ đổi câu hỏi, không đổi cách đối chiếu đáp án. Với câu điền, hãy ghi từ hoặc cụm từ nghe được trong audio.</p> : null}</div>
    </section>
    {!state.form.guidanceAvailable ? <p className="programme-guidance-unavailable" role="status">Đối chiếu từng câu tạm thời chưa sẵn sàng. Bạn vẫn có thể nghe, trả lời và hoàn thành bài.</p> : null}
    <div className="programme-learning-workspace">
      <aside className="programme-audio" aria-label="Audio và tiến độ bài nghe">
        <h2>Nghe và khám phá</h2>
        {state.form.replayPolicy === 'once' ? <><audio ref={audioRef} src={state.form.audioUrl || undefined} preload="metadata" onEnded={() => setOnceState('done')} onError={() => setAudioError('Không tải được audio. Hãy thử lại sau.')} /><button type="button" onClick={() => void controlOnce()} disabled={onceState === 'starting' || onceState === 'done'}>{onceState === 'ready' ? '▶ Bắt đầu lượt nghe duy nhất' : onceState === 'starting' ? 'Đang bắt đầu…' : onceState === 'playing' ? 'Tạm dừng' : onceState === 'paused' ? 'Tiếp tục nghe' : onceState === 'unconfirmed' ? 'Xác nhận lượt nghe' : 'Đã sử dụng lượt nghe'}</button>{onceMessage ? <p role="status">{onceMessage}</p> : null}</> : <audio ref={audioRef} src={state.form.audioUrl} controls preload="metadata" onError={() => setAudioError('Không tải được audio. Hãy thử lại sau.')} />}
        {audioError ? <p role="alert">{audioError}</p> : null}
        <p>{state.form.replayPolicy === 'once' ? 'Bài này chỉ cho phép bắt đầu audio một lần trong lượt làm hiện tại. Chuyển cách luyện không tạo lượt nghe mới.' : 'Bạn có thể nghe lại toàn bài trong lúc làm hoặc sửa câu trả lời.'}</p>
        <div className="programme-learning-progress"><strong>Đường nghe</strong><span>{answeredCount}/{state.form.questions.length} câu đã thử · {Object.keys(feedback).length} câu đã đối chiếu</span><ol aria-label="Tiến độ các câu hỏi">{groups.map((group, index) => <li key={group.key} data-current={mode === 'guided' && index === selectedGroup} data-answered={group.questions.every((question) => !!answers[question.q_num]?.trim())} data-revealed={group.questions.every((question) => !!feedback[question.q_num])}><button type="button" onClick={() => { chooseMode('guided'); moveToGroup(index); }} aria-label={`Đến câu ${group.questions[0].q_num}${feedback[group.questions[0].q_num] ? ', đã đối chiếu' : ''}`}>{group.questions[0].q_num}</button></li>)}</ol></div>
      </aside>
      <section className="programme-learning-stage" aria-label="Câu hỏi luyện nghe">
        <div className="programme-learning-stage__header"><h2 tabIndex={-1} ref={groupHeadingRef}>{mode === 'guided' ? `Tập trung vào câu ${visibleQuestions[0]?.q_num}` : 'Nghe và trả lời theo mạch'}</h2><p>{mode === 'guided' ? `Câu ${selectedGroup + 1}/${groups.length}` : 'Trả lời từng câu, đối chiếu ngay và sửa khi cần.'}</p></div>
        <div className="programme-questions">
      {visibleQuestions.map((sourceQuestion) => { const question = languages.length ? displayQuestion(sourceQuestion, activeLanguage) as Question : sourceQuestion; const optionLanguage = languages.length ? displayOptionLanguage(sourceQuestion, activeLanguage) : undefined; const item = feedback[question.q_num]; const revealing = revealStatus[question.q_num] === 'revealing'; return <article className="programme-question" key={question.q_num}>
        <span className="programme-question__number">{question.q_num}</span><div className="programme-question__body"><p lang={languages.length ? activeLanguage : undefined}>{question.prompt}</p>
        {question.visual_url ? <figure className="programme-question-visual"><div className="programme-question-visual__viewport" role="region" aria-label={`Sơ đồ câu ${question.q_num}, có thể cuộn ngang`} tabIndex={0}><img src={question.visual_url} alt={question.visual_accessibility || 'Sơ đồ cho câu hỏi'} lang={languages.length ? activeLanguage : undefined} /></div><figcaption>Trên màn hình nhỏ, vuốt ngang hoặc dùng phím mũi tên để xem toàn bộ sơ đồ.</figcaption></figure> : null}
        {['single_choice', 'map_label'].includes(question.response_type) ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="radio" name={`q-${question.q_num}`} checked={answers[question.q_num] === key} disabled={submitting || revealing} onChange={() => update(question.q_num, key, true)} /><span lang={optionLanguage}><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {question.response_type === 'multiple_choice' ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="checkbox" checked={(answers[question.q_num] || '').split(',').map((value) => value.trim()).includes(key)} disabled={submitting || revealing} onChange={() => toggleMultiple(question, key)} /><span lang={optionLanguage}><strong>{key}</strong>{label}</span></label>)}</div> : null}
        {['short_answer', 'written', 'open_rubric'].includes(question.response_type) ? <textarea rows={question.response_type === 'open_rubric' ? 5 : 2} value={answers[question.q_num] || ''} disabled={submitting || revealing} onChange={(event) => update(question.q_num, event.target.value)} onBlur={(event) => { if (pending.current[question.q_num]) window.clearTimeout(pending.current[question.q_num]); delete pending.current[question.q_num]; void save(question.q_num, event.target.value); }} placeholder="Nhập câu trả lời của bạn" /> : null}
        <div className="programme-question-feedback-action"><button type="button" disabled={!!item || !state.form.guidanceAvailable || !answers[question.q_num]?.trim() || revealing || submitting || revealStatus[question.q_num] === 'unavailable'} onClick={() => void reveal(question.q_num)}>{item ? 'Đã đối chiếu câu này' : revealing ? 'Đang đối chiếu…' : 'Đối chiếu câu này'}</button>{revealStatus[question.q_num] === 'error' ? <p role="alert">Chưa đối chiếu được. Câu trả lời của bạn vẫn còn; hãy thử lại.</p> : null}{revealStatus[question.q_num] === 'unavailable' ? <p role="alert">Lượt luyện hoặc câu hỏi này không còn cho phép đối chiếu. <a href="/listening">Về thư viện nghe</a></p> : null}</div>
        {item ? <section className="programme-question-feedback" aria-label={`Đối chiếu câu ${question.q_num}`}>
          <div className="programme-question-feedback__status"><span>Nhìn lại câu vừa nghe</span><strong>{item.state === 'checked' ? item.correct ? 'Bạn nghe đúng từ lần đầu' : 'Đây là chỗ đáng nghe lại' : 'Tự đối chiếu với gợi ý'}</strong></div>
          <div className="programme-question-feedback__sequence"><div><span>Câu trả lời đầu</span><p>{item.first_answer}</p></div><div><span>Tham chiếu</span><p>{item.expected?.join(' · ') || item.reference_answers?.join(' · ') || item.answer_sentence || item.core_info || 'Xem gợi ý bên dưới'}</p></div><div><span>Bản sửa hiện tại</span><p>{answers[question.q_num] !== item.first_answer ? answers[question.q_num] || 'Chưa có bản sửa' : 'Bạn có thể sửa câu trả lời phía trên'}</p></div></div>
          {item.rationale || item.self_review_rationale ? <p className="programme-question-feedback__rationale">{item.rationale || item.self_review_rationale}</p> : null}
          {item.required_facts?.length ? <div className="programme-question-feedback__facts"><span>Ý cần nghe được</span><ul>{item.required_facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div> : null}
          {item.optional_facts?.length ? <p className="programme-question-feedback__rationale">Ý bổ sung: {item.optional_facts.join(' · ')}</p> : null}
          {item.audio_window?.start != null && state.form.replayPolicy === 'allowed' ? <button className="programme-question-feedback__replay" type="button" onClick={() => replayQuestion(item)}>▶ Nghe lại đoạn này</button> : null}
        </section> : null}
        </div>
      </article>; })}
        </div>
        {mode === 'guided' ? <nav className="programme-step-actions" aria-label="Chuyển câu hỏi"><button type="button" disabled={selectedGroup === 0} onClick={() => moveToGroup(selectedGroup - 1)}>Câu trước</button><span>Có thể quay lại và sửa câu trả lời bất cứ lúc nào.</span><button type="button" disabled={selectedGroup >= groups.length - 1} onClick={() => moveToGroup(selectedGroup + 1)}>Câu tiếp theo</button></nav> : null}
      </section>
    </div>
    <footer className="programme-submit"><span aria-live="polite">{saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : saveState === 'error' ? 'Có câu chưa lưu được — hãy thử lại' : 'Câu trả lời được tự động lưu'}{Object.keys(feedback).length ? ' · Lượt học có hỗ trợ' : ''}</span><button type="button" onClick={() => void submit()} disabled={submitting || Object.values(revealStatus).includes('revealing')}>{submitting ? 'Đang hoàn thành…' : 'Hoàn thành và xem lại'}</button></footer>
  </main>;
}
