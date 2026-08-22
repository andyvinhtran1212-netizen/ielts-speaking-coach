'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  createListeningSaveCoordinator,
  isPracticeListeningTest,
  listeningAnswersFromRows,
  listeningDictationHref,
  listeningInlineTokens,
  listeningLibraryHref,
  listeningQuestions,
  listeningResumeOffsetSeconds,
  listeningReviewHref,
  listeningTableCellLines,
  listeningTestParams,
  normalizeListeningResume,
  normalizeListeningTest,
} from '@/lib/listening-test-controller.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type ListeningPhase = 'loading' | 'error' | 'prestart' | 'inprogress' | 'submitting' | 'results' | 'sealed';
type AnswerMap = Map<number, string>;
type SaveMap = Map<number, 'retrying' | 'failed'>;
type Attempt = { attempt_id: string; started_at: string; answers?: any[] };
type ListeningTest = any;

function withQuery(path: string, pairs: Array<[string, string | null]>) {
  const query = new URLSearchParams();
  for (const [key, value] of pairs) if (value) query.set(key, value);
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function questionsForSection(section: any) {
  return (section?.exercises || []).flatMap((exercise: any) => {
    const payload = exercise?.payload || {};
    return Array.isArray(payload.questions) ? payload.questions : (Array.isArray(payload.items) ? payload.items : []);
  });
}

function questionRange(section: any) {
  const nums = questionsForSection(section).map((question: any) => Number(question.q_num)).filter(Number.isFinite);
  if (!nums.length) return 'Questions';
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return low === high ? `Question ${low}` : `Questions ${low}–${high}`;
}

function optionValue(option: any) {
  if (typeof option === 'string') return option;
  return String(option?.letter ?? option?.label ?? option?.value ?? '');
}

function optionText(option: any) {
  if (typeof option === 'string') return option;
  return String(option?.text ?? option?.label ?? option?.letter ?? '');
}

function InlineText({ text, gap }: { text: any; gap?: ReactNode }) {
  return <>{listeningInlineTokens(text, { insertGap: gap !== undefined }).map((token: any, index: number) => {
    let content = token.type === 'gap' ? gap : token.text;
    if (token.emphasis === 'strong' || token.emphasis === 'strong-em') content = <strong>{content}</strong>;
    if (token.emphasis === 'em' || token.emphasis === 'strong-em') content = <em>{content}</em>;
    return <Fragment key={index}>{content}</Fragment>;
  })}</>;
}

function GapInput({ qNum, value, onAnswer, ariaLabel }: {
  qNum: number; value: string; onAnswer(qNum: number, value: string): void; ariaLabel?: string;
}) {
  return <input
    className="ft-q-input ielts-gap-input"
    data-q-num={qNum}
    aria-label={ariaLabel || `Answer ${qNum}`}
    autoComplete="off"
    spellCheck={false}
    value={value}
    onChange={(event) => onAnswer(qNum, event.target.value)}
  />;
}

function GapWithNumber({ qNum, value, onAnswer, prefix = '', suffix = '' }: {
  qNum: number; value: string; onAnswer(qNum: number, value: string): void; prefix?: string; suffix?: string;
}) {
  return <span className="listening-next-gap">
    {prefix ? <span><InlineText text={prefix} /> </span> : null}
    <span className="ielts-question-num">{qNum}</span>
    <GapInput qNum={qNum} value={value} onAnswer={onAnswer} />
    {suffix ? <span> <InlineText text={suffix} /></span> : null}
  </span>;
}

function Segment({ segment, answers, onAnswer }: { segment: any; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  if (segment == null) return null;
  if (typeof segment !== 'object') return <InlineText text={String(segment)} />;
  if (segment.q_num == null) return <InlineText text={String(segment.text || '')} />;
  const qNum = Number(segment.q_num);
  return <GapWithNumber qNum={qNum} value={answers.get(qNum) || ''} onAnswer={onAnswer} prefix={segment.prefix || ''} suffix={segment.suffix || ''} />;
}

function FormTemplate({ template, answers, onAnswer }: { template: any; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  const rows = Array.isArray(template?.rows) ? template.rows : [];
  return <div className="ielts-form-container">
    {template?.heading ? <div className="ielts-form-heading"><InlineText text={template.heading} /></div> : null}
    <div className="ielts-form-grid">{rows.map((row: any, index: number) => <div className="ielts-form-row" key={index}>
      {row.label ? <span className="ielts-form-label"><InlineText text={row.label} />:</span> : null}
      {row.example != null ? <span className="ielts-form-example"><InlineText text={row.example} /> (Example)</span>
        : Array.isArray(row.segments) ? row.segments.map((segment: any, part: number) => <Segment key={part} segment={segment} answers={answers} onAnswer={onAnswer} />)
          : row.q_num != null ? <GapWithNumber qNum={Number(row.q_num)} value={answers.get(Number(row.q_num)) || ''} onAnswer={onAnswer} prefix={row.prefix || ''} suffix={row.suffix || ''} />
            : <span><InlineText text={row.text || ''} /></span>}
    </div>)}</div>
  </div>;
}

function TableTemplate({ template, answers, onAnswer }: { template: any; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  const headers = Array.isArray(template?.headers) ? template.headers : [];
  const rows = Array.isArray(template?.rows) ? template.rows : [];
  return <div className="ielts-table-container">
    {template?.heading ? <div className="ielts-table-heading"><InlineText text={template.heading} /></div> : null}
    <table className="ielts-table"><thead><tr>{headers.map((header: any, index: number) => <th key={index}><InlineText text={String(header ?? '')} /></th>)}</tr></thead>
      <tbody>{rows.map((row: any[], rowIndex: number) => <tr key={rowIndex}>{(row || []).map((cell: any, cellIndex: number) => <td key={cellIndex}>
        {Array.isArray(cell) ? listeningTableCellLines(cell).map((line: any[], lineIndex: number) => <div className="ielts-table-line" key={lineIndex}>
          {line.map((segment, part) => <Fragment key={part}>{part ? ' ' : null}<Segment segment={segment} answers={answers} onAnswer={onAnswer} /></Fragment>)}
        </div>)
          : <Segment segment={cell} answers={answers} onAnswer={onAnswer} />}
      </td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function NotesTemplate({ template, answers, onAnswer }: { template: any; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  const groups = Array.isArray(template?.groups) ? template.groups : [];
  return <div className="ielts-notes-container">
    {template?.heading ? <div className="ielts-notes-heading"><InlineText text={template.heading} /></div> : null}
    {groups.map((group: any, index: number) => <div className="ielts-notes-group" key={index}>
      {group.heading ? <div className="ielts-notes-group-heading"><InlineText text={group.heading} /></div> : null}
      <ul className="ielts-notes-list">{(group.items || []).map((item: any, itemIndex: number) => <li key={itemIndex}>
        {item?.q_num != null ? <GapWithNumber qNum={Number(item.q_num)} value={answers.get(Number(item.q_num)) || ''} onAnswer={onAnswer} prefix={item.prefix || ''} suffix={item.suffix || ''} /> : <InlineText text={String(item?.text || '')} />}
      </li>)}</ul>
    </div>)}
  </div>;
}

function SummaryTemplate({ template, questions, answers, onAnswer }: {
  template: any; questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  const paragraph = String(template?.paragraph || '');
  const pieces = paragraph.split(/(\{\{Q\d+\}\})/);
  if (!paragraph) return <QuestionRows questions={questions} answers={answers} onAnswer={onAnswer} />;
  return <div className="ielts-summary-paragraph">{pieces.map((piece, index) => {
    const match = /^\{\{Q(\d+)\}\}$/.exec(piece);
    if (!match) return <span key={index}><InlineText text={piece} /></span>;
    const qNum = Number(match[1]);
    return <GapWithNumber key={index} qNum={qNum} value={answers.get(qNum) || ''} onAnswer={onAnswer} />;
  })}</div>;
}

function SentenceTemplate({ template, questions, answers, onAnswer }: {
  template: any; questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  const sentences = Array.isArray(template?.sentences) ? template.sentences : [];
  if (!sentences.length) return <QuestionRows questions={questions} answers={answers} onAnswer={onAnswer} />;
  return <>{sentences.map((sentence: any) => {
    const qNum = Number(sentence.q_num);
    return <div className="ielts-sentence-row" key={qNum}><GapWithNumber qNum={qNum} value={answers.get(qNum) || ''} onAnswer={onAnswer} prefix={sentence.prefix || ''} suffix={sentence.suffix || ''} /></div>;
  })}</>;
}

function QuestionRows({ questions, answers, onAnswer }: { questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  return <>{questions.map((question) => {
    const qNum = Number(question.q_num);
    const prompt = String(question.prompt || '');
    return <div className="ielts-short-row" id={`q-${qNum}`} key={qNum}>
      <span className="ielts-question-num">{qNum}</span><span className="ielts-gap-prompt">
        <InlineText text={prompt} gap={<GapInput qNum={qNum} value={answers.get(qNum) || ''} onAnswer={onAnswer} />} />
      </span>
    </div>;
  })}</>;
}

function McqTemplate({ questions, answers, onAnswer }: { questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void }) {
  return <>{questions.map((question) => {
    const qNum = Number(question.q_num);
    const options = Array.isArray(question.options) ? question.options : [];
    if (!options.length) return <QuestionRows key={qNum} questions={[question]} answers={answers} onAnswer={onAnswer} />;
    return <div className="ielts-mcq-question" id={`q-${qNum}`} key={qNum}>
      <div className="ielts-mcq-stem"><span className="ielts-question-num">{qNum}</span><InlineText text={question.prompt || ''} /></div>
      <div className="ielts-mcq-options">{options.map((option: any) => {
        const value = optionValue(option);
        return <label className="ielts-mcq-option" key={value}>
          <input className="ft-q-input" type="radio" name={`q-${qNum}`} value={value} checked={answers.get(qNum) === value} onChange={() => onAnswer(qNum, value)} />
          <strong>{value}</strong><span className="ielts-mcq-option-text"><InlineText text={optionText(option)} /></span>
        </label>;
      })}</div>
    </div>;
  })}</>;
}

function SelectTemplate({ payload, questions, answers, onAnswer, plan }: {
  payload: any; questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void; plan?: boolean;
}) {
  const metadata = payload?.metadata || {};
  const bank = Array.isArray(metadata.match_options) ? metadata.match_options : [];
  const letters = Array.isArray(metadata.letter_options) && metadata.letter_options.length
    ? metadata.letter_options.map(String)
    : bank.length ? bank.map(optionValue) : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const image = payload?.map_svg
    ? `data:image/svg+xml;utf8,${encodeURIComponent(String(payload.map_svg))}`
    : payload?.map_image_url || '';
  return <div className={plan ? 'ielts-plan-container' : 'ielts-matching'}>
    {plan ? <div className="ielts-plan-image">{image ? <img className="ielts-map-rendered" src={image} alt="Floor plan map" /> : <p className="ielts-notice">Hình map chưa được tạo cho exercise này.</p>}</div> : null}
    {!plan && bank.length ? <div className="ielts-match-bank"><ul className="ielts-match-bank__list">{bank.map((item: any) => <li key={optionValue(item)}><strong>{optionValue(item)}</strong> <InlineText text={optionText(item)} /></li>)}</ul></div> : null}
    <div className={plan ? 'ielts-plan-labels' : 'ielts-match-rows'}>{questions.map((question) => {
      const qNum = Number(question.q_num);
      return <div className={plan ? 'ielts-plan-row' : 'ielts-match-row'} id={`q-${qNum}`} key={qNum}>
        <span className="ielts-question-num">{qNum}</span><span><InlineText text={question.prompt || ''} /></span>
        <select className="ft-q-input ielts-gap-input" aria-label={`Answer ${qNum}`} value={answers.get(qNum) || ''} onChange={(event) => onAnswer(qNum, event.target.value)}>
          <option value="">—</option>{letters.map((letter: string) => <option value={letter} key={letter}>{letter}</option>)}
        </select>
      </div>;
    })}</div>
  </div>;
}

function MultiSelectTemplate({ payload, questions, answers, onAnswer }: {
  payload: any; questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  const options = Array.isArray(payload?.metadata?.match_options) ? payload.metadata.match_options : [];
  const slots = questions.map((question) => Number(question.q_num));
  const choose = Number(payload?.metadata?.choose || slots.length || 2);
  const selected = slots.map((slot) => answers.get(slot)).filter(Boolean) as string[];
  return <div className="ielts-mc-group" role="group" aria-label={`Answers ${slots.join(' to ')}`}>
    {options.map((option: any) => {
      const value = optionValue(option);
      const checked = selected.includes(value);
      return <label className="ielts-mc-opt" key={value}>
        <input type="checkbox" value={value} checked={checked} disabled={!checked && selected.length >= choose} onChange={(event) => {
          const next = event.target.checked ? [...selected, value] : selected.filter((item) => item !== value);
          slots.forEach((slot, index) => onAnswer(slot, next[index] || ''));
        }} />
        <span><strong>{value}</strong> <InlineText text={optionText(option)} /></span>
      </label>;
    })}
  </div>;
}

function Exercise({ exercise, answers, saveStates, onAnswer }: {
  exercise: any; answers: AnswerMap; saveStates: SaveMap; onAnswer(q: number, v: string): void;
}) {
  const payload = exercise?.payload || {};
  const questions = Array.isArray(payload.questions) ? payload.questions : (Array.isArray(payload.items) ? payload.items : []);
  const kind = String(payload.template_kind || payload.variant || exercise?.variant || exercise?.exercise_type || '');
  const template = payload.template || {};
  const first = Number(questions[0]?.q_num || 0);
  const last = Number(questions.at(-1)?.q_num || first);
  let content: ReactNode;
  if (kind === 'form_completion' && Array.isArray(template.rows)) content = <FormTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'table_completion' && Array.isArray(template.rows)) content = <TableTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'notes_completion' && Array.isArray(template.groups)) content = <NotesTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'summary_completion') content = <SummaryTemplate template={template} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'sentence_completion') content = <SentenceTemplate template={template} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'mcq_3option') content = <McqTemplate questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'mcq_multi') content = <MultiSelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'matching') content = <SelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (['mcq_letter_label', 'plan_label'].includes(kind)) content = <SelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} plan />;
  else content = <QuestionRows questions={questions} answers={answers} onAnswer={onAnswer} />;
  const affected = questions.map((question: any) => Number(question.q_num)).filter((qNum: number) => saveStates.has(qNum));
  return <section className="ielts-question-block" data-template-kind={kind}>
    {questions.length ? <div className="ielts-block-header">{first === last ? `Question ${first}` : `Questions ${first}–${last}`}</div> : null}
    {payload.instruction || payload.instructions ? <div className="ielts-instruction"><p><InlineText text={payload.instruction || payload.instructions} /></p></div> : null}
    {content}
    {affected.length ? <small className="listening-next-exercise-save" role="status">Câu {affected.join(', ')} chưa lưu xong.</small> : null}
  </section>;
}

function ResultView({ result, attempt, test, from, sittingId }: {
  result: any; attempt: Attempt | null; test: ListeningTest; from: string | null; sittingId: string | null;
}) {
  const rows = Array.isArray(result?.per_question) ? result.per_question : [];
  return <main className="listening-next-shell listening-next-result">
    <section className="ft-result">
      <p className="eyebrow">KẾT QUẢ LISTENING</p><h1>{test.title}</h1>
      <div className="listening-next-score"><strong>{result?.score ?? '—'}/{result?.max_score ?? rows.length}</strong><span>Band {result?.band_estimate == null ? 'Dưới 4' : Number(result.band_estimate).toFixed(1)}</span></div>
      <div className="ft-section-breakdown">{Object.entries(result?.section_breakdown || {}).map(([key, value]: [string, any]) => <div className="ft-section-cell" key={key}>{key.toUpperCase()}<br /><strong>{value?.correct || 0}/{value?.total || 0}</strong></div>)}</div>
      <div className="listening-next-result-table">{rows.map((row: any) => <div className={`ft-per-q-row ${row.correct ? 'correct' : 'wrong'}`} key={row.q_num}><span className="ft-per-q-num">{row.q_num}</span><span>{row.user_answer || '(bỏ trống)'}</span><span>→ {row.expected || ''}</span></div>)}</div>
      <div className="ft-result-actions">
        {attempt ? <a className="ft-control-btn" href={listeningReviewHref(attempt.attempt_id, from)}>Xem chữa bài chi tiết →</a> : null}
        <a className="ft-control-btn ghost" href={listeningDictationHref(test.id)}>Luyện chép chính tả</a>
        <a className="ft-control-btn ghost" href={listeningLibraryHref(from, sittingId)}>← Quay lại</a>
      </div>
    </section>
  </main>;
}

export function ListeningTestSession() {
  const { status, user } = useAuth();
  const [params, setParams] = useState<ReturnType<typeof listeningTestParams> | null>(null);
  const [phase, setPhase] = useState<ListeningPhase>('loading');
  const [error, setError] = useState('');
  const [testData, setTestData] = useState<ListeningTest | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>(() => new Map());
  const answersRef = useRef<AnswerMap>(answers);
  const [saveStates, setSaveStates] = useState<SaveMap>(() => new Map());
  const [activeSection, setActiveSection] = useState(1);
  const [result, setResult] = useState<any>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [audioRetrying, setAudioRetrying] = useState(false);
  const [audioReloadKey, setAudioReloadKey] = useState(0);
  const [resumeOffset, setResumeOffset] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const coordinatorRef = useRef<any>(null);
  const collectionFrozenRef = useRef(false);
  const bootKeyRef = useRef<string | null>(null);
  const autoEnteredMockRef = useRef(false);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => {
    try { setParams(listeningTestParams(window.location.search)); }
    catch { setError('Không có mã bài Listening hợp lệ.'); setPhase('error'); }
  }, []);

  const resumePath = useCallback((input = params) => {
    if (!input) return '';
    return withQuery(`/api/listening/tests/${encodeURIComponent(input.testId)}/attempts/in-progress`, [
      ['sitting_id', input.sittingId], ['class_item', input.classItem],
    ]);
  }, [params]);

  const boot = useCallback(async () => {
    if (!params) return;
    const ready = await whenGlobalReady(() => !!window.api?.get, 'window.api (Listening test)');
    if (!ready) throw new Error('Không thể kết nối lớp dữ liệu.');
    const [testPayload, resumePayload] = await Promise.all([
      window.api.get(`/api/listening/tests/${encodeURIComponent(params.testId)}`),
      window.api.get(resumePath(params)),
    ]);
    const normalizedTest = normalizeListeningTest(testPayload);
    const normalizedAttempt = normalizeListeningResume(resumePayload);
    const firstSection = Number(normalizedTest.sections[0]?.section_num || 1);
    setTestData(normalizedTest);
    setActiveSection(firstSection);
    if (normalizedAttempt) {
      const restored = listeningAnswersFromRows(normalizedAttempt.answers);
      answersRef.current = restored;
      setAnswers(new Map(restored));
      setAttempt(normalizedAttempt);
      setResumeAvailable(true);
    } else {
      answersRef.current = new Map(); setAnswers(new Map()); setAttempt(null); setResumeAvailable(false);
    }
    setPhase('prestart');
  }, [params, resumePath]);

  const bootWithRecovery = useCallback(async () => {
    setPhase('loading'); setError('');
    try { await boot(); }
    catch (caught: any) { setError(`Không tải được bài Listening. ${caught?.message || ''}`); setPhase('error'); }
  }, [boot]);

  useEffect(() => {
    if (!params || status === 'initial-loading') return;
    if (status === 'signed-out') { window.location.replace('/login'); return; }
    if (status !== 'signed-in' || !user?.id) return;
    const key = `${params.testId}:${params.classItem || ''}:${params.sittingId || ''}:${user.id}`;
    if (bootKeyRef.current === key) return;
    bootKeyRef.current = key;
    void bootWithRecovery();
  }, [bootWithRecovery, params, status, user?.id]);

  const saveAnswer = useCallback(async (qNum: number, value: string, options: { keepalive?: boolean }) => {
    if (!attempt) return null;
    return window.api.patchWith(
      `/api/listening/tests/attempts/${encodeURIComponent(attempt.attempt_id)}/answers`,
      { q_num: qNum, user_answer: value }, undefined, { keepalive: !!options.keepalive },
    );
  }, [attempt]);

  useEffect(() => {
    coordinatorRef.current?.dispose?.();
    if (!attempt || phase === 'results' || phase === 'sealed') return undefined;
    const coordinator = createListeningSaveCoordinator({ save: saveAnswer });
    coordinator.seed(answersRef.current);
    const unsubscribe = coordinator.subscribe((snapshot: SaveMap) => setSaveStates(new Map(snapshot)));
    coordinatorRef.current = coordinator;
    const flushPage = () => { void coordinator.flush({ keepalive: true }); };
    // A hidden tab is still alive: reuse/await the interactive chain instead of
    // duplicating its writes. Only a real pagehide needs the unload keepalive.
    const flushHidden = () => { if (document.visibilityState === 'hidden') void coordinator.flush(); };
    const retryOnline = () => coordinator.retryFailed();
    window.addEventListener('pagehide', flushPage);
    window.addEventListener('online', retryOnline);
    document.addEventListener('visibilitychange', flushHidden);
    return () => {
      flushPage(); unsubscribe(); coordinator.dispose();
      window.removeEventListener('pagehide', flushPage);
      window.removeEventListener('online', retryOnline);
      document.removeEventListener('visibilitychange', flushHidden);
    };
  }, [attempt?.attempt_id, phase === 'results' || phase === 'sealed', saveAnswer]);

  const resolveAudioOffset = useCallback(async (nextAttempt: Attempt, nextTest: ListeningTest | null) => {
    const hook = (window as any).MockHook;
    if (params?.sittingId && typeof hook?.sectionElapsedSeconds === 'function') {
      return hook.sectionElapsedSeconds('listening');
    }
    if (nextTest && !isPracticeListeningTest(nextTest)) {
      return listeningResumeOffsetSeconds(nextAttempt.started_at);
    }
    return null;
  }, [params?.sittingId]);

  const enterAttempt = useCallback(async (nextAttempt: Attempt, restored: AnswerMap, attach = true) => {
    const hook = (window as any).MockHook;
    if (attach && params?.sittingId && typeof hook?.attach === 'function') {
      await hook.attach('listening', nextAttempt.attempt_id);
    }
    const offset = await resolveAudioOffset(nextAttempt, testData);
    answersRef.current = restored;
    setAnswers(new Map(restored)); setAttempt(nextAttempt); setResumeAvailable(false);
    setResumeOffset(Number.isFinite(offset) ? Math.max(0, Number(offset)) : null);
    setPhase('inprogress');
  }, [params?.sittingId, resolveAudioOffset, testData]);

  const resume = useCallback(() => {
    if (!attempt) return;
    void enterAttempt(attempt, answersRef.current).catch((caught: any) => {
      setError(`Không tiếp tục được bài Listening. ${caught?.message || ''}`); setPhase('error');
    });
  }, [attempt, enterAttempt]);

  const startFresh = useCallback(async () => {
    if (!params) return;
    setPhase('loading');
    try {
      const started: any = await window.api.post(
        withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}/attempts`, [['class_item', params.classItem]]), {},
      );
      const hook = (window as any).MockHook;
      if (params.sittingId && typeof hook?.attach === 'function') await hook.attach('listening', started.attempt_id);
      const canonical = normalizeListeningResume(await window.api.get(resumePath(params)));
      if (!canonical || canonical.attempt_id !== String(started.attempt_id)) throw new Error('Không xác nhận được attempt vừa tạo.');
      await enterAttempt(canonical, new Map(), false);
    } catch (caught: any) { setError(`Không bắt đầu được bài Listening. ${caught?.message || ''}`); setPhase('error'); }
  }, [enterAttempt, params, resumePath]);

  useEffect(() => {
    if (phase !== 'prestart' || !params?.mockEmbed || autoEnteredMockRef.current) return;
    autoEnteredMockRef.current = true;
    if (resumeAvailable) resume(); else void startFresh();
  }, [params?.mockEmbed, phase, resume, resumeAvailable, startFresh]);

  const updateAnswer = useCallback((qNum: number, value: string) => {
    if (collectionFrozenRef.current) return;
    const next = new Map(answersRef.current);
    if (value) next.set(qNum, value); else next.delete(qNum);
    answersRef.current = next; setAnswers(next); setSubmitBlocked('');
    coordinatorRef.current?.update(qNum, value);
  }, []);

  const submit = useCallback(async () => {
    if (!attempt || ['submitting', 'results', 'sealed'].includes(phase)) return;
    setSubmitOpen(false); setSubmitBlocked(''); setPhase('submitting');
    const clean = await coordinatorRef.current?.flush?.();
    if (!clean) {
      setPhase('inprogress');
      setSubmitBlocked('Vẫn còn câu chưa lưu được lên máy chủ. Hãy kiểm tra kết nối, bấm “Thử lại”, rồi nộp bài lại để tránh mất đáp án.');
      return;
    }
    try {
      const response = await window.api.post(`/api/listening/tests/attempts/${encodeURIComponent(attempt.attempt_id)}/submit`, {});
      audioRef.current?.pause();
      const hook = (window as any).MockHook;
      if (hook?.isSealedResponse?.(response)) {
        setPhase('sealed');
        if (!params?.mockEmbed) hook.showSealedAndReturn('listening');
        return;
      }
      setResult(response); setPhase('results');
    } catch (caught: any) { setError(`Không nộp được bài Listening. ${caught?.message || ''}`); setPhase('error'); }
  }, [attempt, params?.mockEmbed, phase]);

  useEffect(() => {
    if (!params?.mockEmbed) return undefined;
    const handler = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin
          || event.source !== window.parent
          || event.data?.type !== 'mock-flush') return;
      collectionFrozenRef.current = true;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.inert = true;
      let clean = false;
      try { clean = !!await coordinatorRef.current?.flush?.(); } catch {}
      const unsaved = clean
        ? 0
        : (coordinatorRef.current?.snapshot?.().size ?? saveStates.size);
      if (event.source) {
        (event.source as WindowProxy).postMessage(
          { type: 'mock-flushed', section: 'listening', unsaved },
          window.location.origin,
        );
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [params?.mockEmbed, saveStates.size]);

  const practice = !!testData && isPracticeListeningTest(testData);
  const startAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || (!practice && (playing || audio.ended || audioEnded))) return;
    const alreadyStarted = playbackStarted;
    try { await audio.play(); setPlaying(true); setPlaybackStarted(true); setAudioEnded(false); setAudioError(''); }
    catch {
      setPlaying(false);
      setAudioError(navigator.onLine
        ? 'Audio chưa phát được. Hãy tải lại đường dẫn audio rồi bấm Play; thời gian thi vẫn tiếp tục chạy.'
        : 'Đang mất mạng nên audio chưa phát được. Giữ nguyên tab; hệ thống sẽ tải lại khi có kết nối.');
      // A rejected first play may be retried. A rejected RESUME must retain the
      // single-shot latch so it can never become a restart-from-zero affordance.
      if (!practice && !alreadyStarted) setPlaybackStarted(false);
    }
  }, [audioEnded, playbackStarted, playing, practice]);
  const toggleAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void startAudio(); else { audio.pause(); setPlaying(false); }
  }, [startAudio]);

  const retryAudio = useCallback(async () => {
    if (!params || !attempt || audioRetrying) return;
    const mediaOffset = Number(audioRef.current?.currentTime);
    setAudioRetrying(true);
    try {
      const refreshed = normalizeListeningTest(await window.api.get(
        `/api/listening/tests/${encodeURIComponent(params.testId)}`,
      ));
      const offset = params.sittingId || !Number.isFinite(mediaOffset)
        ? await resolveAudioOffset(attempt, refreshed)
        : Math.max(0, mediaOffset);
      audioRef.current?.pause();
      setPlaying(false);
      setPlaybackStarted(false);
      setAudioEnded(false);
      setResumeOffset(Number.isFinite(offset) ? Math.max(0, Number(offset)) : null);
      setTestData(refreshed);
      setAudioReloadKey((value) => value + 1);
      setAudioError('');
    } catch (caught: any) {
      setAudioError(`Chưa tải lại được audio. ${caught?.message || 'Kiểm tra kết nối rồi thử lại.'}`);
    } finally {
      setAudioRetrying(false);
    }
  }, [attempt, audioRetrying, params, resolveAudioOffset]);

  useEffect(() => {
    if (!audioError) return undefined;
    const online = () => { void retryAudio(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [audioError, retryAudio]);

  const allQuestions = useMemo(() => listeningQuestions(testData), [testData]);
  const total = allQuestions.length;
  const sections = testData?.sections || [];
  const unsavedFailed = [...saveStates.values()].filter((state) => state === 'failed').length;
  const unsavedRetrying = saveStates.size - unsavedFailed;
  const backHref = listeningLibraryHref(params?.from, params?.sittingId);

  useEffect(() => {
    if (saveStates.size === 0) setSubmitBlocked('');
  }, [saveStates.size]);

  useEffect(() => {
    if (!testData?.cue_points?.length) return;
    let nextSection = activeSection;
    for (const cue of testData.cue_points) {
      if (cue?.type === 'section_start' && Number(cue.timestamp_seconds) <= currentTime + 0.5 && Number(cue.section_num) > nextSection) nextSection = Number(cue.section_num);
    }
    if (nextSection !== activeSection) setActiveSection(nextSection);
  }, [activeSection, currentTime, testData?.cue_points]);

  if (phase === 'results' && testData) return <ResultView result={result} attempt={attempt} test={testData} from={params?.from || null} sittingId={params?.sittingId || null} />;

  return <>
    <aver-chrome active="listening"></aver-chrome>
    <main className="listening-next-shell">
      {phase === 'loading' ? <div className="empty-state">Đang tải bài Listening…</div> : null}
      {phase === 'error' ? <section className="error-banner" role="alert"><p>{error}</p><div className="listening-next-actions"><button className="ft-control-btn" type="button" onClick={() => void bootWithRecovery()}>Thử lại</button><a className="ft-control-btn ghost" href={backHref}>← Quay lại</a></div></section> : null}
      {phase === 'prestart' && testData ? <section className="ft-prestart">
        <p className="eyebrow">{practice ? 'LISTENING PRACTICE' : 'FULL LISTENING TEST'}</p>
        <h1>{testData.title}</h1><p>{sections.length} phần · {total} câu</p>
        <div className="ft-rules"><ul><li>Mỗi câu trả lời được lưu vào máy chủ.</li><li>Refresh trang có thể tiếp tục đúng attempt đang mở.</li><li>{practice ? 'Bạn có thể tạm dừng, tua và nghe lại audio.' : 'Audio chỉ phát một lượt; không tua hoặc quay lại từ đầu.'}</li></ul></div>
        {resumeAvailable ? <p className="ft-resume-note">Bạn có bài đang làm dở với {answers.size} câu đã lưu. Tiếp tục để giữ attempt và mốc audio hiện tại.</p> : null}
        <div className="listening-next-actions"><a className="ft-control-btn ghost" href={backHref}>← Quay lại</a>
          {resumeAvailable ? <button className="ft-control-btn" type="button" onClick={resume}>Tiếp tục bài đang làm</button> : null}
          <button className="ft-control-btn ghost" id="btn-start" type="button" onClick={() => {
            if (!resumeAvailable) {
              const message = practice
                ? 'Bắt đầu luyện nghe? Bạn có thể tạm dừng, tua và nghe lại audio trước khi nộp bài.'
                : 'Bắt đầu test? Audio chỉ phát một lượt và không thể tua lại.';
              if (window.confirm(message)) void startFresh();
              return;
            }
            if (window.confirm('Bài đang làm sẽ bị bỏ và thay bằng attempt mới. Tiếp tục?')) void startFresh();
          }}>{resumeAvailable ? 'Bắt đầu lại từ đầu' : 'Bắt đầu test'}</button>
        </div>
      </section> : null}
      {['inprogress', 'submitting'].includes(phase) && testData ? <>
        <section className="ft-sticky" aria-label="Audio and progress">
          <div className="ft-sticky-row"><span className="ft-progress-text">Đã trả lời: <strong>{answers.size}</strong> / {total}</span><span className="ft-time">{formatTime(currentTime)} / {formatTime(duration)}</span></div>
          <div className={`ft-audio-bar${practice ? ' ft-audio-bar--seekable' : ''}`}><div className="ft-audio-fill" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }} /></div>
          {audioError ? <div className="ft-audio-error" role="alert"><span>{audioError}</span><button className="ft-control-btn ghost" type="button" onClick={() => void retryAudio()} disabled={audioRetrying}>{audioRetrying ? 'Đang tải lại…' : 'Tải lại audio'}</button></div> : null}
          <div className="ft-audio-controls">
            <button className="ft-control-btn" type="button" disabled={!practice && (playing || audioEnded)} onClick={practice ? toggleAudio : startAudio}>{playing ? (practice ? '⏸ Tạm dừng' : 'Đang phát') : !practice && audioEnded ? 'Đã phát xong' : !practice && playbackStarted ? '▶ Tiếp tục' : '▶ Play'}</button>
            {practice ? <input aria-label="Audio progress (kéo để tua)" type="range" min="0" max={Math.max(1, duration)} value={currentTime} onChange={(event) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setCurrentTime(next); }} /> : null}
            <label>Âm lượng <input aria-label="Âm lượng" type="range" min="0" max="100" defaultValue="100" onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value) / 100; }} /></label>
          </div>
          <audio
            key={`${testData.audio_url}:${audioReloadKey}`}
            ref={audioRef}
            src={testData.audio_url}
            preload="auto"
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget; setDuration(Number.isFinite(audio.duration) ? audio.duration : testData.audio_duration_seconds || 0);
              if (resumeOffset != null && !practice) { const target = Math.min(resumeOffset, Math.max(0, audio.duration - 0.25)); try { audio.currentTime = target; setCurrentTime(target); } catch {} }
              setAudioError(''); setAudioRetrying(false);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => { setPlaying(true); setAudioEnded(false); }} onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setAudioEnded(!practice); if (practice) setPlaybackStarted(false); }}
            onError={() => setAudioError(navigator.onLine
              ? 'Không tải được dữ liệu audio. Hãy tải lại đường dẫn audio; thời gian thi vẫn tiếp tục chạy.'
              : 'Đang mất mạng nên audio bị gián đoạn. Giữ nguyên tab; hệ thống sẽ tải lại khi có kết nối.')}
          />
        </section>
        <nav className="ielts-tabs" role="tablist" aria-label="Test sections">{sections.map((section: any) => {
          const sectionNum = Number(section.section_num); const count = questionsForSection(section).length;
          const answered = questionsForSection(section).filter((question: any) => answers.has(Number(question.q_num))).length;
          return <button className={`ielts-tab${sectionNum === activeSection ? ' active' : ''}`} role="tab" aria-selected={sectionNum === activeSection} type="button" key={sectionNum} onClick={() => setActiveSection(sectionNum)}><span className="tab-label">PART {sectionNum}</span><span className="tab-progress">{answered}/{count}</span></button>;
        })}</nav>
        <div className="ielts-test-paper">{sections.filter((section: any) => Number(section.section_num) === activeSection).map((section: any) => <section className="ielts-section" key={section.section_num}>
          <div className="ielts-section-label">PART {section.section_num}</div><h2 className="ielts-section-title">{questionRange(section)}</h2>
          {(section.exercises || []).map((exercise: any, index: number) => <Exercise key={exercise.id || index} exercise={exercise} answers={answers} saveStates={saveStates} onAnswer={updateAnswer} />)}
        </section>)}</div>
        <footer className="ielts-progress-tracker">
          <div className="ielts-progress-bar" role="navigation" aria-label="Câu hỏi">{allQuestions.map(({ sectionNum, question }: any) => {
            const qNum = Number(question.q_num);
            return <button className={`progress-square${answers.has(qNum) ? ' answered' : ''}${saveStates.has(qNum) ? ' is-unsaved' : ''}${saveStates.get(qNum) === 'failed' ? ' is-save-failed' : ''}`} type="button" key={qNum} onClick={() => { setActiveSection(sectionNum); requestAnimationFrame(() => document.getElementById(`q-${qNum}`)?.scrollIntoView({ block: 'center' })); }}>{qNum}</button>;
          })}</div>
          {saveStates.size ? <p className="ft-unsaved-note" role="status">{unsavedRetrying ? `Đang thử lưu lại ${unsavedRetrying} câu. ` : ''}{unsavedFailed ? `${unsavedFailed} câu chưa lưu được lên máy chủ.` : 'Đừng đóng tab tới khi cảnh báo biến mất.'}{unsavedFailed ? <button className="ft-unsaved-retry" type="button" onClick={() => coordinatorRef.current?.retryFailed?.()}>Thử lại</button> : null}</p> : null}
          {submitBlocked ? <p className="ft-nothing-saved" role="alert">{submitBlocked}</p> : null}
          <div className="listening-next-submit-row"><span>Đã trả lời <strong>{answers.size}</strong> / {total} câu</span>{!params?.mockEmbed ? <button className="btn-submit-final" id="btn-submit" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(true)}>{phase === 'submitting' ? 'Đang chấm…' : 'Nộp bài'}</button> : null}</div>
        </footer>
      </> : null}
      {phase === 'sealed' ? <section className="ft-prestart"><p>Đã thu bài Listening. Đang chờ kỳ thi chuyển bước tiếp theo…</p></section> : null}
    </main>
    {submitOpen ? <div className="listening-next-modal" role="dialog" aria-modal="true" aria-labelledby="listening-submit-title"><button className="listening-next-modal-backdrop" aria-label="Đóng" type="button" onClick={() => setSubmitOpen(false)} /><section className="listening-next-modal-panel"><h2 id="listening-submit-title">Nộp bài?</h2><p>{answers.size < total ? `Bạn còn ${total - answers.size}/${total} câu chưa trả lời.` : `Bạn đã trả lời tất cả ${total} câu.`}</p><div className="listening-next-actions"><button className="ft-control-btn ghost" type="button" onClick={() => setSubmitOpen(false)}>Quay lại làm tiếp</button><button className="ft-control-btn" type="button" onClick={() => void submit()}>Nộp bài</button></div></section></div> : null}
  </>;
}
