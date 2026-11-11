'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import type { ApiGetJson } from '@/lib/openapi-contract';
import type { AuthStatus } from '@/lib/auth/auth-provider';
import { ListeningSourceBlock } from '@/components/listening-source-block';
import { ListeningQuestionAudio, pauseOtherListeningAudio } from '@/components/listening-question-audio';
import { ListeningSourceSupplement } from '@/components/listening-source-supplement';
import type { components } from '@/types/api';
import { ListeningSourceExplanation } from '@/components/listening-source-explanation';
import { programmeLessonPath } from '@/lib/listening-programme-navigation.mjs';
import type { ListeningSourceBlockWire, ListeningSourceResponseFieldWire } from '@/lib/listening-source-collection-api';
import { readSourceGapAnswers, writeSourceGapAnswers, displaySourceAnswer, displaySourceReferenceAnswer } from '@/lib/listening-source-responses.mjs';
import { listeningProgrammeLessonHref, listeningProgrammeResultHref } from '@/lib/listening-library-context.mjs';
import { createProgrammeAnswerDraftStore, createProgrammeAnswerWriteQueue, createProgrammeSaveStatusTracker, programmeAnswerFlushEntries } from '@/lib/listening-programme-answer-queue.mjs';
import { availableQuestionLanguages, displayOptionLanguage, displayQuestion, groupProgrammeQuestions } from '@/lib/listening-programme-learning.mjs';
import { confirmProgrammeOncePlayback, startProgrammeOncePlayback } from '@/lib/listening-programme-once-playback.mjs';
import { createProgrammeReplayController } from '@/lib/listening-programme-replay.mjs';
import type { ListeningGuidedStateWire, ListeningProgrammePlayerWire } from '@/lib/listening-programmes-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface Question { supplement?: components['schemas']['SourceSupplementalQuestion']; q_num: number; source_item_id: string; prompt: string; response_type: string; options: Record<string, string>; visual_url?: string; visual_accessibility?: string; editorial_translation?: unknown; source_block_id?: string; source_display_number?: string; selection_count?: number; fields?: ListeningSourceResponseFieldWire[] }
type SourceAudio = ApiGetJson<'/api/listening/source-collections/80-days/days/{day_number}/audio'>;
interface FormData { questionClips?: SourceAudio['question_clips']; audioVariants?: SourceAudio['variants']; audioLoadError?: boolean; title: string; programmeId: string; lessonId: string; replayPolicy: string; audioUrl: string; questions: Question[]; guidanceAvailable: boolean; sourceDay?: number; sourceBlocks: ListeningSourceBlockWire[]; audioGranularity?: string }
type FeedbackItem = NonNullable<ListeningGuidedStateWire['items']>[number];
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; form: FormData; attemptId: string };
interface FormScope { active: boolean; controller: AbortController }
function row(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function questionLabel(question: Question | undefined) { return question?.source_display_number || String(question?.q_num || ''); }
function feedbackResponseFields(question: Question, item: FeedbackItem | undefined): ListeningSourceResponseFieldWire[] | undefined {
  if (question.response_type !== 'multi_gap_completion') return undefined;
  if (!item || item.q_num !== question.q_num || !question.source_item_id || item.source_item_id !== question.source_item_id) return [];
  return item.fields?.length ? item.fields : question.fields || [];
}

interface SupplementScope { supplements?: components['schemas']['SourceSupplementalQuestion'][]; sourceBlocks?: ListeningSourceBlockWire[]; manifest?: string }
export function ProgrammeFormRunner({ testId, active = true, embedded = false, supplements, sourceBlocks, manifest }: { testId: string; active?: boolean; embedded?: boolean } & SupplementScope) {
  const { status, user } = useAuth();
  return <ProgrammeFormView key={JSON.stringify([status, user?.id ?? null, testId])} testId={testId} status={status} userId={user?.id ?? null} active={active} embedded={embedded} supplements={supplements} sourceBlocks={sourceBlocks} manifest={manifest} />;
}

function ProgrammeFormView({ testId, status, userId, active, embedded, supplements, sourceBlocks, manifest }: { testId: string; status: AuthStatus; userId: string | null; active: boolean; embedded: boolean } & SupplementScope) {
  const params = useSearchParams();
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
  const scopeRef = useRef<FormScope | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSource = useRef('');
  const [audioVariant, setAudioVariant] = useState('original');
  const [audioRetrying, setAudioRetrying] = useState(false);
  const playbackUrl = state.status === 'ready' ? state.form.audioVariants?.find((variant) => variant.variant_id === audioVariant)?.url || (!state.form.sourceDay || audioVariant === 'original' ? state.form.audioUrl : '') : '';
  const Container = embedded ? 'section' : 'main';
  const mediaGeneration = useRef(0);
  audioSource.current = active ? playbackUrl : '';
  const replayController = useRef<ReturnType<typeof createProgrammeReplayController> | null>(null);
  if (!replayController.current) replayController.current = createProgrammeReplayController(() => audioRef.current);
  const groupHeadingRef = useRef<HTMLHeadingElement>(null);
  const onceClaimId = useRef('');
  const [onceState, setOnceState] = useState<'ready' | 'starting' | 'playing' | 'paused' | 'unconfirmed' | 'done'>('ready');
  const [onceMessage, setOnceMessage] = useState('');
  const [audioError, setAudioError] = useState('');

  function current(scope: FormScope | null): scope is FormScope {
    return !!scope?.active && scope === scopeRef.current;
  }
  const bindAudio = useCallback((element: HTMLAudioElement | null) => {
    const previous = audioRef.current;
    if (previous === element) return;
    mediaGeneration.current += 1;
    if (previous) {
      replayController.current?.dispose();
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    audioRef.current = element;
    if (element && audioSource.current && element.getAttribute('src') !== audioSource.current) element.setAttribute('src', audioSource.current);
  }, []);
  useLayoutEffect(() => {
    const scope: FormScope = { active: status === 'signed-in' && !!userId, controller: new AbortController() };
    scopeRef.current = scope;
    return () => {
      scope.active = false;
      scope.controller.abort();
      Object.values(pending.current).forEach(window.clearTimeout);
      pending.current = {};
      saveQueue.current = null;
      draftStore.current = null;
      revealPromises.current.clear();
      bindAudio(null);
    };
  }, [bindAudio, status, userId]);

  useLayoutEffect(() => {
    mediaGeneration.current += 1;
    replayController.current?.dispose();
    const media = audioRef.current;
    if (media) {
      media.pause();
      if (active && playbackUrl) media.setAttribute('src', playbackUrl);
      else media.removeAttribute('src');
      media.load();
    }
    setAudioError('');
  }, [active, playbackUrl]);

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
    if (status !== 'signed-in' || !userId) return;
    const scope = scopeRef.current;
    if (!current(scope)) return;
    let active = true;
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith && !!window.api?.postWith, 'window.api (programme form)');
      if (!active || !current(scope)) return;
      if (!ready) throw new Error('API chưa sẵn sàng');
      const attempt = row(await window.api.postWith<unknown>(`/api/listening/tests/${encodeURIComponent(testId)}/attempts?standalone=true`, {}, undefined, { signal: scope.controller.signal }));
      if (!active || !current(scope)) return;
      const attemptId = String(attempt.attempt_id || '');
      const test = row(await window.api.getWith<ListeningProgrammePlayerWire>(`/api/listening/tests/${encodeURIComponent(testId)}?attempt_id=${encodeURIComponent(attemptId)}`, undefined, { signal: scope.controller.signal }));
      if (!active || !current(scope)) return;
      if (test.scoring_policy !== 'report_only') throw new Error('Bài này không thuộc chương trình report-only.');
      const sections = Array.isArray(test.sections) ? test.sections : [];
      const exercises = sections.flatMap((value) => {
        const section = row(value); return Array.isArray(section.exercises) ? section.exercises : [];
      });
      const exercise = exercises.map(row).find((value) => row(value.payload).variant === 'programme_form_v1');
      const payload = row(exercise?.payload);
      const questions = (Array.isArray(payload.questions) ? payload.questions : []).map((value) => {
        const question = row(value); const options = row(question.options);
        return { q_num: Number(question.q_num), source_item_id: String(question.source_item_id || ''), prompt: String(question.prompt || ''), response_type: String(question.response_type || ''), options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, String(option)])), visual_url: question.visual_url ? String(question.visual_url) : undefined, visual_accessibility: question.visual_accessibility ? String(question.visual_accessibility) : undefined, editorial_translation: question.editorial_translation, source_block_id: question.source_block_id ? String(question.source_block_id) : undefined, source_display_number: question.source_display_number ? String(question.source_display_number) : undefined, selection_count: Number(question.selection_count) || undefined, fields: Array.isArray(question.fields) ? question.fields.map((value) => { const field = row(value); return { field_id: String(field.field_id || ''), prompt: String(field.prompt || ''), word_limit: Number(field.word_limit) || null }; }) : [] };
      }).filter((question) => question.q_num > 0);
      const restored: Record<number, string> = {};
      for (const value of (Array.isArray(attempt.answers) ? attempt.answers : [])) { const answer = row(value); restored[Number(answer.q_num)] = String(answer.user_answer || ''); }
      let guided: ListeningGuidedStateWire | null = null;
      try {
        guided = await window.api.getWith<ListeningGuidedStateWire>(`/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/guided-state`, undefined, { signal: scope.controller.signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        // A mixed-version deployment or temporary endpoint outage must not
        // make the existing answer-and-submit programme flow unusable.
      }
      const revealed = Object.fromEntries((guided?.items || []).map((item) => [item.q_num, item]));
      if (!active || !current(scope)) return;
      saveStatusTracker.current.reset();
      setSaveState('idle');
      const store = createProgrammeAnswerDraftStore(localStorage, attemptId);
      const recovered = store.load();
      const queue = createProgrammeAnswerWriteQueue(async (qNum, value) => {
        if (!current(scope)) throw new DOMException('Programme scope ended', 'AbortError');
        await window.api.patchWith(`/api/listening/tests/attempts/${attemptId}/answers`, { q_num: qNum, user_answer: value }, undefined, { signal: scope.controller.signal });
        if (current(scope)) store.clearIfCurrent(qNum, value);
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
          if (active && current(scope)) setSaveState(saveStatusTracker.current.succeed(operation.token));
        }).catch(() => {
          if (active && current(scope)) setSaveState(saveStatusTracker.current.fail(operation.token));
        });
      }
      onceClaimId.current = crypto.randomUUID();
      setOnceMessage('');
      const replayPolicy = String(test.replay_policy || 'allowed');
      let audioVariants: SourceAudio['variants'] | undefined;
      let questionClips: SourceAudio['question_clips'] | undefined;
      let audioLoadError = false;
      const sourceDay = test.programme_id === 'ielts-80-days-listening' ? Number(test.source_day) || undefined : undefined;
      if (sourceDay) {
        try {
          const response = await window.api.getWith<SourceAudio>(`/api/listening/source-collections/80-days/days/${sourceDay}/audio`, undefined, { signal: scope.controller.signal });
          if (response.day !== sourceDay || !Array.isArray(response.variants)) throw new Error('Audio không khớp buổi học.');
          audioVariants = response.variants;
          questionClips = response.question_clips;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          audioLoadError = true;
        }
      }
      if (!active || !current(scope)) return;
      setAudioVariant(audioVariants?.some((variant) => variant.variant_id === 'original') || test.audio_url ? 'original' : 'kokoro-v1');
      const audioUrl = String(test.audio_url || '');
      setOnceState(attempt.playback_started_at || (replayPolicy === 'once' && !audioUrl) ? 'done' : 'ready');
      setState({ status: 'ready', attemptId, form: { title: String(test.title || 'Bài luyện nghe'), programmeId: String(test.programme_id || ''), lessonId: String(test.listening_lesson_id || ''), replayPolicy, audioUrl, audioVariants, questionClips, audioLoadError, questions, guidanceAvailable: guided !== null, sourceDay, sourceBlocks: Array.isArray(test.source_blocks) ? test.source_blocks as ListeningSourceBlockWire[] : [], audioGranularity: test.audio_granularity ? String(test.audio_granularity) : undefined } });
    })().catch((error: unknown) => { if (active && current(scope) && !(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được bài nghe.' }); });
    return () => { active = false; scope.controller.abort(); Object.values(pending.current).forEach(window.clearTimeout); pending.current = {}; saveQueue.current = null; draftStore.current = null; submitLock.current = false; replayController.current?.dispose(); revealPromises.current.clear(); };
  }, [status, testId, userId]);

  const answeredCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);
  const practiceQuestions = useMemo(() => {
    if (state.status !== 'ready') return [];
    const all: Question[] = [...state.form.questions, ...(supplements || []).map((question, index) => ({ q_num: -index - 1, source_item_id: question.item_id, source_display_number: question.source_display_number, source_block_id: question.block_id, prompt: question.prompt, response_type: question.response_type, options: {}, supplement: question }))];
    const order = (sourceBlocks || state.form.sourceBlocks).flatMap((block) => block.item_ids || []);
    if (supplements?.length) all.sort((a, b) => order.indexOf(a.source_item_id) - order.indexOf(b.source_item_id));
    return all;
  }, [state, supplements, sourceBlocks]);
  const groups = useMemo(() => state.status === 'ready' ? groupProgrammeQuestions(practiceQuestions) as Array<{ key: string; sourceBlockId?: string | null; questions: Question[] }> : [], [state, practiceQuestions]);
  const languages = useMemo(() => state.status === 'ready' ? availableQuestionLanguages(state.form.questions) as string[] : [], [state]);
  const bilingualWritten = state.status === 'ready' && languages.length > 0 && state.form.questions.some((question) => ['short_answer', 'written', 'open_rubric'].includes(question.response_type));
  const activeLanguage = languages.includes(language) ? language : 'vi';
  const selectedGroup = Math.min(currentGroup, Math.max(groups.length - 1, 0));
  const visibleQuestions = state.status === 'ready' ? (mode === 'guided' ? groups[selectedGroup]?.questions || [] : practiceQuestions) : [];
  const visibleGroups = mode === 'guided' ? groups.slice(selectedGroup, selectedGroup + 1) : groups;
  function chooseMode(value: 'continuous' | 'guided') {
    setMode(value);
    try { localStorage.setItem('av-listening-learning-mode', value); } catch { /* Keep current choice in memory. */ }
  }
  function chooseLanguage(value: 'vi' | 'en') {
    setLanguage(value);
    try { localStorage.setItem('av-listening-question-language', value); } catch { /* Keep current choice in memory. */ }
  }
  function moveToGroup(index: number) {
    const scope = scopeRef.current;
    if (!current(scope)) return;
    setCurrentGroup(index);
    window.requestAnimationFrame(() => { if (current(scope)) groupHeadingRef.current?.focus(); });
  }
  async function save(qNum: number, value: string) {
    const scope = scopeRef.current;
    const queue = saveQueue.current;
    if (state.status !== 'ready' || !queue || !current(scope)) return;
    const tracker = saveStatusTracker.current;
    const operation = tracker.begin(qNum);
    setSaveState(operation.status);
    try { await queue.enqueue(qNum, value); if (current(scope)) setSaveState(tracker.succeed(operation.token)); }
    catch { if (current(scope)) setSaveState(tracker.fail(operation.token)); }
  }
  function update(qNum: number, value: string, immediate = false) {
    const scope = scopeRef.current;
    if (submitLock.current || !current(scope)) return;
    draftStore.current?.remember(qNum, value);
    setAnswers((current) => ({ ...current, [qNum]: value }));
    if (pending.current[qNum]) window.clearTimeout(pending.current[qNum]);
    delete pending.current[qNum];
    if (immediate) void save(qNum, value);
    else pending.current[qNum] = window.setTimeout(() => { if (!current(scope)) return; delete pending.current[qNum]; void save(qNum, value); }, 650);
  }
  function toggleMultiple(question: Question, key: string) {
    const selected = new Set((answers[question.q_num] || '').split(',').map((value) => value.trim()).filter(Boolean));
    if (selected.has(key)) selected.delete(key); else if (!question.selection_count || selected.size < question.selection_count) selected.add(key);
    update(question.q_num, [...selected].sort().join(', '), true);
  }
  async function reveal(qNum: number) {
    const scope = scopeRef.current;
    const queue = saveQueue.current;
    if (state.status !== 'ready' || !state.form.guidanceAvailable || !queue || submitLock.current
        || feedback[qNum] || revealPromises.current.has(qNum)
        || !answers[qNum]?.trim() || !current(scope)) return;
    const value = answers[qNum];
    if (pending.current[qNum]) window.clearTimeout(pending.current[qNum]);
    delete pending.current[qNum];
    setRevealStatus((current) => ({ ...current, [qNum]: 'revealing' }));
    const operation = (async () => {
      // A failed or ambiguous PATCH never leads to a protected-key response.
      await queue.flush([{ qNum, value }]);
      if (!current(scope)) return;
      const result = await window.api.postWith<ListeningGuidedStateWire>(
        `/api/listening/tests/attempts/${encodeURIComponent(state.attemptId)}/questions/${qNum}/reveal`, {}, undefined, { signal: scope.controller.signal },
      );
      if (!current(scope)) return;
      const item = (result.items || []).find((candidate) => candidate.q_num === qNum);
      if (!item) throw new Error('Không xác minh được phần đối chiếu.');
      setFeedback((current) => ({ ...current, [qNum]: item }));
      setRevealStatus((current) => { const next = { ...current }; delete next[qNum]; return next; });
    })();
    revealPromises.current.set(qNum, operation);
    try { await operation; }
    catch (error: unknown) {
      if (!current(scope)) return;
      const statusCode = row(error).status;
      setRevealStatus((current) => ({ ...current, [qNum]: [403, 404, 409, 422].includes(Number(statusCode)) ? 'unavailable' : 'error' }));
    }
    finally { if (revealPromises.current.get(qNum) === operation) revealPromises.current.delete(qNum); }
  }
  async function submit() {
    const scope = scopeRef.current;
    const queue = saveQueue.current;
    if (state.status !== 'ready' || submitLock.current || !queue
        || revealPromises.current.size || !current(scope)) return;
    submitLock.current = true;
    setSubmitting(true);
    const tracker = saveStatusTracker.current;
    const operation = tracker.beginFlush();
    setSaveState(operation.status);
    try {
      Object.values(pending.current).forEach(window.clearTimeout);
      pending.current = {};
      await queue.flush(programmeAnswerFlushEntries(state.form.questions, answers));
      if (!current(scope)) return;
      setSaveState(tracker.finishFlush(operation.token));
      await window.api.postWith(`/api/listening/tests/attempts/${state.attemptId}/submit`, {}, undefined, { signal: scope.controller.signal });
      if (!current(scope)) return;
      draftStore.current?.clear();
      window.location.assign(listeningProgrammeResultHref(state.form.programmeId, state.attemptId, params || undefined));
    } catch {
      if (!current(scope)) return;
      tracker.fail(operation.token);
      setSaveState('error');
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  async function controlOnce() {
    const scope = scopeRef.current;
    const element = audioRef.current;
    const generation = mediaGeneration.current;
    const mediaCurrent = () => current(scope) && audioRef.current === element && generation === mediaGeneration.current;
    if (state.status !== 'ready' || ['starting', 'done'].includes(onceState) || !element || !current(scope)) return;
    // Activity may restore the same node while an earlier claim is settling.
    const scopedAudio = { play: () => element.play(), pause: () => { if (mediaCurrent()) element.pause(); } };
    const acknowledgeOncePlayback = async () => {
      if (!mediaCurrent()) return false;
      const result = row(await window.api.postWith<unknown>(`/api/listening/tests/attempts/${state.attemptId}/playback-started`, { playback_claim_id: onceClaimId.current }, undefined, { signal: scope.controller.signal }));
      return mediaCurrent() && result.accepted === true;
    };
    if (onceState === 'playing') {
      element.pause();
      setOnceState('paused');
      return;
    }
    if (onceState === 'unconfirmed') {
      const result = await confirmProgrammeOncePlayback(scopedAudio, acknowledgeOncePlayback);
      if (!mediaCurrent()) return;
      setOnceState(result.state);
      setOnceMessage(result.message);
      return;
    }
    if (onceState === 'paused') {
      try {
        await element.play();
        if (!mediaCurrent()) return;
        setOnceMessage('');
        setOnceState('playing');
      } catch {
        if (!mediaCurrent()) return;
        setOnceMessage('Trình duyệt chưa phát được audio. Hãy thử lại.');
      }
      return;
    }
    setOnceState('starting');
    const result = await startProgrammeOncePlayback(scopedAudio, acknowledgeOncePlayback);
    if (!mediaCurrent()) return;
    setOnceState(result.state);
    setOnceMessage(result.message);
  }
  function replayQuestion(item: FeedbackItem) {
    const scope = scopeRef.current;
    const generation = mediaGeneration.current;
    if (state.status !== 'ready' || state.form.replayPolicy !== 'allowed' || !active || !playbackUrl || !current(scope)) return;
    setAudioError('');
    replayController.current?.dispose();
    const controller = createProgrammeReplayController(() => audioRef.current);
    replayController.current = controller;
    void controller.replay(state.form.sourceDay && audioVariant !== 'original' ? { start: 0, end: null } : item.audio_window).then((started) => {
      if (current(scope) && generation === mediaGeneration.current && replayController.current === controller && !started) setAudioError('Không phát được đoạn nghe. Bạn có thể thử lại hoặc dùng audio toàn bài.');
    });
  }

  async function retryAudio() {
    const scope = scopeRef.current;
    if (state.status !== 'ready' || !state.form.sourceDay || !current(scope) || audioRetrying) return;
    const day = state.form.sourceDay;
    setAudioRetrying(true);
    try {
      const response = await window.api.getWith<SourceAudio>(`/api/listening/source-collections/80-days/days/${day}/audio`, undefined, { signal: scope.controller.signal });
      if (!current(scope) || response.day !== day || !Array.isArray(response.variants)) return;
      setState((value) => value.status === 'ready' ? { ...value, form: { ...value.form, audioVariants: response.variants, questionClips: response.question_clips, audioLoadError: false } } : value);
      setAudioVariant(response.variants.some((variant) => variant.variant_id === 'original') ? 'original' : 'kokoro-v1');
      setAudioError('');
    } catch { if (current(scope)) setAudioError('Chưa tải được audio. Hãy thử lại.'); }
    finally { if (current(scope)) setAudioRetrying(false); }
  }

  if (state.status === 'loading') return <Container className="programme-runner programme-state shell" role="status">Đang chuẩn bị bài nghe…</Container>;
  if (state.status === 'error') return <Container className="programme-runner programme-state shell is-error" role="alert"><p>{state.message}</p><a href="/listening">Về trang Luyện nghe</a></Container>;
  const lessonHref = state.form.programmeId === 'ielts-80-days-listening'
    ? programmeLessonPath(state.form.programmeId, state.form.lessonId, state.form.sourceDay)
    : listeningProgrammeLessonHref(state.form.programmeId, state.form.lessonId, params || undefined);
  return <Container className={`programme-runner shell${state.form.sourceDay ? ' is-source-practice' : ''}`}>
    {state.form.sourceDay ? <link rel="stylesheet" href="/css/listening-source-collection.css" /> : null}
    <header className="programme-runner__header">{!embedded ? <a href={lessonHref}>← Bài học</a> : null}<div><p>Luyện nghe theo nhịp của bạn</p><h1>{state.form.title}</h1><span>Nghe, thử trả lời và sửa lại. Đây không phải bài tính band IELTS.</span></div><span>{answeredCount}/{state.form.questions.length} câu đã thử{supplements?.length ? ` · ${supplements.length} câu tự luyện lưu trên thiết bị` : ''}</span></header>
    <section className="programme-learning-controls" aria-label="Tùy chọn luyện nghe">
      <div><span>Cách luyện</span><div className="programme-segmented" role="group" aria-label="Cách luyện"><button type="button" aria-pressed={mode === 'continuous'} onClick={() => chooseMode('continuous')}>Làm liền mạch</button><button type="button" aria-pressed={mode === 'guided'} onClick={() => chooseMode('guided')}>Luyện từng bước</button></div></div>
      <div><span>Ngôn ngữ câu hỏi</span>{languages.length ? <div className="programme-segmented" role="group" aria-label="Ngôn ngữ câu hỏi"><button type="button" aria-pressed={activeLanguage === 'vi'} onClick={() => chooseLanguage('vi')}>Tiếng Việt</button><button type="button" aria-pressed={activeLanguage === 'en'} onClick={() => chooseLanguage('en')}>English</button></div> : <p className="programme-language-note">Đang hiển thị bản gốc; bản dịch được biên tập dần theo bài.</p>}{bilingualWritten ? <p className="programme-language-note">Đổi ngôn ngữ chỉ đổi câu hỏi, không đổi cách đối chiếu đáp án. Với câu điền, hãy ghi từ hoặc cụm từ nghe được trong audio.</p> : null}</div>
    </section>
    {!state.form.guidanceAvailable ? <p className="programme-guidance-unavailable" role="status">Đối chiếu từng câu tạm thời chưa sẵn sàng. Bạn vẫn có thể nghe, trả lời và hoàn thành bài.</p> : null}
    <div className="programme-learning-workspace">
      <aside className="programme-audio" aria-label="Audio và tiến độ bài nghe">
        <h2>Nghe và khám phá</h2>
        {state.form.sourceDay ? <label>Phiên bản audio <select className="source-audio-select" value={audioVariant} onChange={(event) => setAudioVariant(event.target.value)}><option value="kokoro-v1">Bản luyện nghe</option>{state.form.audioUrl || state.form.audioVariants?.some((variant) => variant.variant_id === 'original') ? <option value="original">Bản ghi gốc</option> : null}</select></label> : null}
        {state.form.sourceDay && (!playbackUrl || state.form.audioLoadError || audioError) ? <><p role="alert">{state.form.audioLoadError ? `Chưa tải được danh sách audio.${state.form.audioUrl ? ' Bạn có thể chọn Bản ghi gốc hoặc tải lại.' : ' Hãy tải lại audio.'}` : 'Bản audio này chưa sẵn sàng để phát.'}</p><button type="button" onClick={() => void retryAudio()} disabled={audioRetrying}>{audioRetrying ? 'Đang tải audio…' : 'Tải lại audio'}</button></> : null}
        {state.form.replayPolicy === 'once' ? <><audio ref={bindAudio} src={active ? playbackUrl || undefined : undefined} preload="metadata" onEnded={(event) => { if (current(scopeRef.current) && audioRef.current === event.currentTarget) setOnceState('done'); }} onError={(event) => { if (current(scopeRef.current) && audioRef.current === event.currentTarget) setAudioError('Không tải được audio. Hãy thử lại sau.'); }} /><button type="button" onClick={() => void controlOnce()} disabled={onceState === 'starting' || onceState === 'done'}>{onceState === 'ready' ? '▶ Bắt đầu lượt nghe duy nhất' : onceState === 'starting' ? 'Đang bắt đầu…' : onceState === 'playing' ? 'Tạm dừng' : onceState === 'paused' ? 'Tiếp tục nghe' : onceState === 'unconfirmed' ? 'Xác nhận lượt nghe' : 'Đã sử dụng lượt nghe'}</button>{onceMessage ? <p role="status">{onceMessage}</p> : null}</> : <audio ref={bindAudio} src={active ? playbackUrl || undefined : undefined} controls preload="metadata" onPlay={(event) => pauseOtherListeningAudio(event.currentTarget)} onError={(event) => { if (current(scopeRef.current) && audioRef.current === event.currentTarget) setAudioError('Không tải được audio. Hãy thử lại sau.'); }} />}
        {audioError ? <p role="alert">{audioError}</p> : null}
        <p>{state.form.replayPolicy === 'once' ? 'Bài này chỉ cho phép bắt đầu audio một lần trong lượt làm hiện tại. Chuyển cách luyện không tạo lượt nghe mới.' : state.form.audioGranularity === 'whole_day' ? 'Audio toàn buổi. Bạn có thể nghe và lặp đoạn của từng câu bên dưới.' : 'Bạn có thể nghe lại toàn bài trong lúc làm hoặc sửa câu trả lời.'}</p>
        <div className="programme-learning-progress"><strong>Đường nghe</strong><span>{answeredCount}/{state.form.questions.length} câu đã thử · {Object.keys(feedback).length} câu đã đối chiếu</span><ol aria-label="Tiến độ các câu hỏi">{groups.map((group, index) => <li key={group.key} data-current={mode === 'guided' && index === selectedGroup} data-answered={group.questions.every((question) => !!answers[question.q_num]?.trim())} data-revealed={group.questions.every((question) => !question.supplement && !!feedback[question.q_num])}><button type="button" onClick={() => { chooseMode('guided'); moveToGroup(index); }} aria-label={`Đến câu ${questionLabel(group.questions[0])}${feedback[group.questions[0].q_num] ? ', đã đối chiếu' : ''}`}>{questionLabel(group.questions[0])}</button></li>)}</ol></div>
      </aside>
      <section className="programme-learning-stage" aria-label="Câu hỏi luyện nghe">
        <div className="programme-learning-stage__header"><h2 tabIndex={-1} ref={groupHeadingRef}>{mode === 'guided' ? `Tập trung vào câu ${questionLabel(visibleQuestions[0])}${visibleQuestions.length > 1 ? '–' + questionLabel(visibleQuestions.at(-1)) : ''}` : 'Nghe và trả lời theo mạch'}</h2><p>{mode === 'guided' ? `${state.form.sourceBlocks.length ? 'Khối' : 'Câu'} ${selectedGroup + 1}/${groups.length}` : 'Trả lời từng câu, đối chiếu ngay và sửa khi cần.'}</p></div>
        <div className="programme-questions">
      {visibleGroups.map((group) => <section className="programme-source-group" key={group.key}>{(sourceBlocks || state.form.sourceBlocks).filter((block) => block.block_id === group.sourceBlockId).map((block) => <ListeningSourceBlock key={block.block_id} block={block} showQuestions={false} />)}{group.questions.map((sourceQuestion) => { const clip = state.form.questionClips?.find((clip) => clip.item_id === sourceQuestion.source_item_id); if (sourceQuestion.supplement) return <ListeningSourceSupplement key={`${sourceQuestion.source_item_id}:${audioVariant}`} question={sourceQuestion.supplement} manifest={manifest || ''} clip={clip} active={active} reload={() => void retryAudio()} />; const question = languages.length ? displayQuestion(sourceQuestion, activeLanguage) as Question : sourceQuestion; const optionLanguage = languages.length ? displayOptionLanguage(sourceQuestion, activeLanguage) : undefined; const item = feedback[question.q_num]; const feedbackFields = feedbackResponseFields(sourceQuestion, item); const referenceAnswer = question.response_type === 'multi_gap_completion' ? displaySourceReferenceAnswer(item?.explanation?.answer, feedbackFields) : item?.expected?.join(' · ') || item?.reference_answers?.join(' · ') || item?.answer_sentence || item?.core_info; const revealing = revealStatus[question.q_num] === 'revealing'; return <article className="programme-question" key={question.q_num}>
        <span className="programme-question__number">{questionLabel(question)}</span><div className="programme-question__body"><p lang={languages.length ? activeLanguage : undefined}>{question.prompt}</p>
        {state.form.sourceDay ? <ListeningQuestionAudio key={`${question.source_item_id}:${audioVariant}:${clip?.url}`} clip={clip} active={active} reload={() => void retryAudio()} /> : null}
        {question.visual_url && state.form.programmeId !== 'ielts-80-days-listening' ? <figure className="programme-question-visual"><div className="programme-question-visual__viewport" role="region" aria-label={`Sơ đồ câu ${question.q_num}, có thể cuộn ngang`} tabIndex={0}><img src={question.visual_url} alt={question.visual_accessibility || 'Sơ đồ cho câu hỏi'} lang={languages.length ? activeLanguage : undefined} /></div><figcaption>Trên màn hình nhỏ, vuốt ngang hoặc dùng phím mũi tên để xem toàn bộ sơ đồ.</figcaption></figure> : null}
        {['single_choice', 'map_label'].includes(question.response_type) ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="radio" name={`programme-${testId}-q-${question.q_num}`} checked={answers[question.q_num] === key} disabled={submitting || revealing} onChange={() => update(question.q_num, key, true)} /><span lang={optionLanguage}>{!question.source_block_id || /^[A-Za-z]$/.test(key) ? <strong>{key}</strong> : null}{label}</span></label>)}</div> : null}
        {question.response_type === 'multiple_choice' ? <div className="programme-options">{Object.entries(question.options).map(([key, label]) => <label key={key}><input type="checkbox" checked={(answers[question.q_num] || '').split(',').map((value) => value.trim()).includes(key)} disabled={submitting || revealing} onChange={() => toggleMultiple(question, key)} /><span lang={optionLanguage}>{!question.source_block_id || /^[A-Za-z]$/.test(key) ? <strong>{key}</strong> : null}{label}</span></label>)}</div> : null}
        {question.response_type === 'multi_gap_completion' ? <fieldset className="source-multiple-gaps"><legend>Điền từng chỗ trống của câu {questionLabel(question)}</legend>{question.fields?.map((field) => <label key={field.field_id}>{field.prompt}{field.word_limit ? <small>Không quá {field.word_limit} từ cho chỗ trống này.</small> : null}<input value={readSourceGapAnswers(answers[question.q_num])[field.field_id] || ''} disabled={submitting || revealing} onChange={(event) => { const next = { ...readSourceGapAnswers(answers[question.q_num]), [field.field_id]: event.target.value }; update(question.q_num, writeSourceGapAnswers(next)); }} onBlur={() => { if (pending.current[question.q_num]) window.clearTimeout(pending.current[question.q_num]); delete pending.current[question.q_num]; void save(question.q_num, answers[question.q_num] || ''); }} /></label>)}</fieldset> : null}
        {['short_answer', 'written', 'open_rubric'].includes(question.response_type) ? <textarea rows={question.response_type === 'open_rubric' ? 5 : 2} value={answers[question.q_num] || ''} disabled={submitting || revealing} onChange={(event) => update(question.q_num, event.target.value)} onBlur={(event) => { if (pending.current[question.q_num]) window.clearTimeout(pending.current[question.q_num]); delete pending.current[question.q_num]; void save(question.q_num, event.target.value); }} placeholder="Nhập câu trả lời của bạn" /> : null}
        <div className="programme-question-feedback-action"><button type="button" disabled={!!item || !state.form.guidanceAvailable || !answers[question.q_num]?.trim() || revealing || submitting || revealStatus[question.q_num] === 'unavailable'} onClick={() => void reveal(question.q_num)}>{item ? 'Đã đối chiếu câu này' : revealing ? 'Đang đối chiếu…' : 'Đối chiếu câu này'}</button>{revealStatus[question.q_num] === 'error' ? <p role="alert">Chưa đối chiếu được. Câu trả lời của bạn vẫn còn; hãy thử lại.</p> : null}{revealStatus[question.q_num] === 'unavailable' ? <p role="alert">Lượt luyện hoặc câu hỏi này không còn cho phép đối chiếu. <a href="/listening">Về thư viện nghe</a></p> : null}</div>
        {item ? <section className="programme-question-feedback" aria-label={`Đối chiếu câu ${question.q_num}`}>
          <div className="programme-question-feedback__status"><span>Nhìn lại câu vừa nghe</span><strong>{item.state === 'checked' ? item.correct ? 'Bạn nghe đúng từ lần đầu' : 'Đây là chỗ đáng nghe lại' : 'Tự đối chiếu với gợi ý'}</strong></div>
          <div className="programme-question-feedback__sequence"><div><span>Câu trả lời đầu</span><p>{displaySourceAnswer(item.first_answer, question.response_type, feedbackFields)}</p></div><div><span>Tham chiếu</span><p>{referenceAnswer || 'Xem gợi ý bên dưới'}</p></div><div><span>Bản sửa hiện tại</span><p>{answers[question.q_num] !== item.first_answer ? displaySourceAnswer(answers[question.q_num], question.response_type, feedbackFields) : 'Bạn có thể sửa câu trả lời phía trên'}</p></div></div>
          {!item.explanation && (item.rationale || item.self_review_rationale) ? <p className="programme-question-feedback__rationale">{item.rationale || item.self_review_rationale}</p> : null}
          {item.explanation ? <ListeningSourceExplanation explanation={item.explanation} reviewStatus={item.review_status} provenance={item.answer_provenance} fields={feedbackFields} showSourceReferences={!state.form.sourceDay} /> : null}
          {item.required_facts?.length ? <div className="programme-question-feedback__facts"><span>Ý cần nghe được</span><ul>{item.required_facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div> : null}
          {item.optional_facts?.length ? <p className="programme-question-feedback__rationale">Ý bổ sung: {item.optional_facts.join(' · ')}</p> : null}
          {item.audio_window?.start != null && state.form.replayPolicy === 'allowed' ? <button className="programme-question-feedback__replay" type="button" onClick={() => replayQuestion(item)}>▶ {state.form.sourceDay && audioVariant !== 'original' || item.audio_granularity === 'whole_day' ? 'Nghe toàn ngày' : item.audio_granularity === 'whole_part' ? 'Nghe lại phần này' : 'Nghe lại đoạn này'}</button> : null}
        </section> : null}
        </div>
      </article>; })}</section>)}
        </div>
        {mode === 'guided' ? <nav className="programme-step-actions" aria-label="Chuyển câu hỏi"><button type="button" disabled={selectedGroup === 0} onClick={() => moveToGroup(selectedGroup - 1)}>Câu trước</button><span>Có thể quay lại và sửa câu trả lời bất cứ lúc nào.</span><button type="button" disabled={selectedGroup >= groups.length - 1} onClick={() => moveToGroup(selectedGroup + 1)}>Câu tiếp theo</button></nav> : null}
      </section>
    </div>
    <footer className="programme-submit"><span aria-live="polite">{saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : saveState === 'error' ? 'Có câu chưa lưu được — hãy thử lại' : 'Câu trả lời được tự động lưu'}{Object.keys(feedback).length ? ' · Lượt học có hỗ trợ' : ''}</span><button type="button" onClick={() => void submit()} disabled={submitting || Object.values(revealStatus).includes('revealing')}>{submitting ? 'Đang hoàn thành…' : 'Hoàn thành và xem lại'}</button></footer>
  </Container>;
}
