'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  answersFromRows,
  consecutiveReadingQuestionRuns,
  createReadingSaveCoordinator,
  normalizeReadingBoot,
  readingExamParams,
  readingLibraryHref,
  readingQuestionInstruction,
  readingRemainingSeconds,
  readingReviewHref,
} from '@/lib/reading-exam-controller.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type AnswerMap = Map<number, string>;
type SaveState = Map<number, 'retrying' | 'failed'>;
type ExamPhase = 'loading' | 'error' | 'prestart' | 'inprogress' | 'submitting' | 'results' | 'sealed';

type Passage = {
  id?: string;
  passage_order?: number;
  title?: string;
  body_markdown?: string;
};

type Option = { label?: string; text?: string } | string;
type Question = {
  q_num: number;
  passage_order?: number;
  question_type?: string;
  prompt?: string;
  payload?: {
    options?: Option[];
    image_url?: string;
    word_limit?: string;
    template?: {
      choose?: number;
      paragraph_labels?: string[];
      summary_text?: string;
    };
  };
};

type ReadingTest = {
  test_id: string;
  title: string;
  module?: string;
  time_limit_minutes: number;
  total_questions: number;
  passages: Passage[];
  questions: Question[];
};

type Attempt = {
  attempt_id: string;
  started_at: string;
  time_limit_minutes: number;
};

const TYPE_LABELS: Record<string, string> = {
  matching_headings: 'Matching Headings',
  true_false_not_given: 'True / False / Not Given',
  yes_no_not_given: 'Yes / No / Not Given',
  mcq_single: 'Multiple Choice',
  mcq_multi: 'Multiple Choice — choose more than one',
  sentence_completion: 'Sentence Completion',
  summary_completion: 'Summary Completion',
  notes_completion: 'Notes Completion',
  table_completion: 'Table Completion',
  form_completion: 'Form Completion',
  short_answer: 'Short Answer',
  matching_information: 'Matching Information',
  matching_features: 'Matching Features',
  matching_sentence_endings: 'Matching Sentence Endings',
  flow_chart_completion: 'Flow-chart Completion',
  diagram_label_completion: 'Diagram Labelling',
};

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  return `${String(mins).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function queryWithClassItem(path: string, classItem: string | null) {
  if (!classItem) return path;
  return `${path}${path.includes('?') ? '&' : '?'}class_item=${encodeURIComponent(classItem)}`;
}

function optionValue(option: Option) {
  if (typeof option === 'string') return option;
  return String(option.label ?? option.text ?? '');
}

function optionText(option: Option) {
  if (typeof option === 'string') return option;
  const label = String(option.label ?? '');
  const text = String(option.text ?? '');
  return label && text ? `${label}. ${text}` : label || text;
}

function questionOptions(question: Question) {
  return Array.isArray(question.payload?.options) ? question.payload!.options! : [];
}

function useRenderedMarkdown(markdown: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).renderMarkdown === 'function',
      'window.renderMarkdown (Reading exam)',
    ).then((ready) => {
      if (!disposed && ready) setHtml((window as any).renderMarkdown(markdown || '', { breaks: false }));
    });
    return () => { disposed = true; };
  }, [markdown]);
  return html;
}

function PassageView({ passage }: { passage: Passage | null }) {
  const html = useRenderedMarkdown(passage?.body_markdown || '');
  if (!passage) return null;
  return (
    <>
      <p className="exam-passage__part">Reading Passage {passage.passage_order || 1}</p>
      <h1 className="exam-passage__title">{passage.title || 'Reading passage'}</h1>
      {html ? (
        <div className="reading-next-passage-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="reading-next-passage-body">{passage.body_markdown || ''}</div>
      )}
    </>
  );
}

function InlineGap({ question, value, onChange }: {
  question: Question;
  value: string;
  onChange(value: string): void;
}) {
  const prompt = String(question.prompt || '');
  const match = /_{2,}/.exec(prompt);
  if (!match) return null;
  const before = prompt.slice(0, match.index);
  const after = prompt.slice(match.index + match[0].length);
  return (
    <p className="exam-q__prompt exam-q__prompt--inline">
      {before}
      <input
        aria-label={`Answer ${question.q_num}`}
        autoComplete="off"
        className="exam-q__gap exam-q__gap--inline reading-next-inline-gap"
        name={`q-${question.q_num}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {after}
    </p>
  );
}

function QuestionControl({ question, value, onChange }: {
  question: Question;
  value: string;
  onChange(value: string): void;
}) {
  const type = question.question_type || '';
  const options = questionOptions(question);
  const inline = /(?:sentence|summary|notes|table|form|short_answer|flow_chart|diagram_label)_completion|short_answer/.test(type)
    && /_{2,}/.test(String(question.prompt || ''))
    && !(type === 'summary_completion' && options.length);
  if (inline) return <InlineGap question={question} value={value} onChange={onChange} />;

  if (type === 'mcq_single') {
    return <div className="exam-q__options">{options.map((option) => {
      const answer = optionValue(option);
      return <label className="exam-q__option" key={answer}>
        <input type="radio" name={`q-${question.q_num}`} value={answer} checked={value === answer} onChange={() => onChange(answer)} />
        <span className="exam-q__option-text">{optionText(option)}</span>
      </label>;
    })}</div>;
  }

  if (type === 'mcq_multi') {
    const selected = new Set(value.split(',').filter(Boolean));
    const choose = Number(question.payload?.template?.choose || 0);
    return <div className="exam-q__options exam-q__options--multi" role="group" aria-label={`Answer ${question.q_num}`}>
      {options.map((option) => {
        const answer = optionValue(option);
        const checked = selected.has(answer);
        const locked = !checked && choose > 0 && selected.size >= choose;
        return <label className="exam-q__option exam-q__option--checkbox" key={answer}>
          <input
            type="checkbox"
            value={answer}
            checked={checked}
            disabled={locked}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(answer); else next.delete(answer);
              onChange([...next].join(','));
            }}
          />
          <span className="exam-q__option-text">{optionText(option)}</span>
        </label>;
      })}
    </div>;
  }

  let selectOptions: string[] | null = null;
  if (type === 'true_false_not_given') selectOptions = ['TRUE', 'FALSE', 'NOT GIVEN'];
  else if (type === 'yes_no_not_given') selectOptions = ['YES', 'NO', 'NOT GIVEN'];
  else if (['matching_headings', 'matching_features', 'matching_sentence_endings'].includes(type)
      || (type === 'summary_completion' && options.length)) {
    selectOptions = options.map(optionValue);
  } else if (type === 'matching_information') {
    const authored = question.payload?.template?.paragraph_labels;
    selectOptions = Array.isArray(authored) && authored.length
      ? authored.map(String)
      : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  }
  if (selectOptions) {
    return (
      <select className="exam-q__select" aria-label={`Answer ${question.q_num}`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">— Select —</option>
        {selectOptions.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    );
  }

  return (
    <input
      aria-label={`Answer ${question.q_num}`}
      autoComplete="off"
      className="exam-q__gap"
      name={`q-${question.q_num}`}
      placeholder="Type your answer…"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function QuestionCard({ question, answer, saveState, flagged, onAnswer, onFlag }: {
  question: Question;
  answer: string;
  saveState?: 'retrying' | 'failed';
  flagged: boolean;
  onAnswer(value: string): void;
  onFlag(): void;
}) {
  const options = questionOptions(question);
  const hasInlinePrompt = /_{2,}/.test(String(question.prompt || ''))
    && !(question.question_type === 'summary_completion' && options.length);
  return (
    <article
      className={`exam-q${answer ? ' is-answered' : ''}${saveState ? ' is-unsaved' : ''}`}
      data-q={question.q_num}
      id={`q-${question.q_num}`}
    >
      <span className="exam-q__num">{question.q_num}</span>
      <div className="exam-q__body">
        <p className="exam-q__type">{TYPE_LABELS[question.question_type || ''] || 'Question'}</p>
        {question.payload?.image_url ? <img className="exam-diagram-image" src={question.payload.image_url} alt={`Question ${question.q_num} diagram`} /> : null}
        {!hasInlinePrompt ? <p className="exam-q__prompt">{question.prompt || ''}</p> : null}
        <QuestionControl question={question} value={answer} onChange={onAnswer} />
        {saveState ? <small role="status">
          {saveState === 'retrying' ? 'Đang thử lưu lại…' : 'Chưa lưu được lên máy chủ.'}
        </small> : null}
      </div>
      <button className="exam-q__flag" type="button" aria-label={`Flag question ${question.q_num} for review`} aria-pressed={flagged} onClick={onFlag}>⚑</button>
    </article>
  );
}

const BANK_TITLES: Record<string, string> = {
  matching_headings: 'List of Headings',
  matching_features: 'List of Features',
  matching_sentence_endings: 'Sentence Endings',
  summary_completion: 'Word Bank',
};
const FLOWING_COMPLETION_TYPES = new Set([
  'sentence_completion', 'summary_completion', 'notes_completion', 'table_completion',
  'form_completion', 'flow_chart_completion', 'diagram_label_completion',
]);
const MONO_COMPLETION_TYPES = new Set(['table_completion', 'flow_chart_completion', 'diagram_label_completion']);
const STRUCTURED_COMPLETION_TYPES = new Set(['notes_completion', 'form_completion', 'sentence_completion']);

type QuestionRunProps = {
  run: Question[];
  part: number;
  answers: AnswerMap;
  saveStates: SaveState;
  flagged: Set<number>;
  onAnswer(qNum: number, value: string): void;
  onFlag(qNum: number): void;
};

function SaveHint({ state }: { state?: 'retrying' | 'failed' }) {
  if (!state) return null;
  return <small className="reading-next-gap-save" role="status">
    {state === 'retrying' ? 'Đang thử lưu lại…' : 'Chưa lưu được lên máy chủ.'}
  </small>;
}

function QuestionBank({ type, options }: { type: string; options: Option[] }) {
  const title = BANK_TITLES[type];
  if (!title || !options.length) return null;
  return <aside className="reading-next-question-bank" aria-label={title}>
    <p className="reading-next-question-bank__title">{title}</p>
    <ol>{options.map((option) => <li key={optionValue(option)}>{optionText(option)}</li>)}</ol>
  </aside>;
}

function InlineRunAnswer({ question, sharedOptions, answer, saveState, flagged, onAnswer, onFlag }: {
  question: Question;
  sharedOptions?: Option[];
  answer: string;
  saveState?: 'retrying' | 'failed';
  flagged: boolean;
  onAnswer(value: string): void;
  onFlag(): void;
}) {
  const controlQuestion = sharedOptions?.length
    ? { ...question, payload: { ...question.payload, options: sharedOptions } }
    : question;
  return <span
    className={`reading-next-flow-gap${answer ? ' is-answered' : ''}${saveState ? ' is-unsaved' : ''}`}
    data-q={question.q_num}
    id={`q-${question.q_num}`}
  >
    <span className="exam-summary__gnum">{question.q_num}</span>{' '}
    <QuestionControl question={controlQuestion} value={answer} onChange={onAnswer} />
    <button className="reading-next-flow-flag" type="button" aria-label={`Flag question ${question.q_num} for review`} aria-pressed={flagged} onClick={onFlag}>⚑</button>
    <SaveHint state={saveState} />
  </span>;
}

function FlowingCompletionRun({ run, answers, saveStates, flagged, onAnswer, onFlag }: Omit<QuestionRunProps, 'part'>) {
  const first = run[0];
  const type = String(first.question_type || '');
  const summary = String(first.payload?.template?.summary_text || '');
  const sharedOptions = questionOptions(first);
  const byNumber = new Map(run.map((question) => [question.q_num, question]));
  const renderTemplate = (source: string, keyPrefix: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    const marker = /\{\{\s*(\d{1,3})\s*\}\}/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(source)) !== null) {
      if (match.index > last) nodes.push(source.slice(last, match.index));
      const qNum = Number(match[1]);
      const question = byNumber.get(qNum);
      nodes.push(question ? <InlineRunAnswer
        key={`${keyPrefix}-${qNum}`}
        question={question}
        sharedOptions={sharedOptions}
        answer={answers.get(qNum) || ''}
        saveState={saveStates.get(qNum)}
        flagged={flagged.has(qNum)}
        onAnswer={(value) => onAnswer(qNum, value)}
        onFlag={() => onFlag(qNum)}
      /> : match[0]);
      last = match.index + match[0].length;
    }
    if (last < source.length) nodes.push(source.slice(last));
    return nodes;
  };

  if (MONO_COMPLETION_TYPES.has(type)) {
    return <div className="exam-gap-box exam-gap-box--summary" data-question-type={type}>
      <div className="exam-summary__mono">{renderTemplate(summary, 'mono')}</div>
    </div>;
  }
  if (STRUCTURED_COMPLETION_TYPES.has(type)) {
    const lines = summary.split('\n').map((line) => line.trim()).filter(Boolean);
    return <div className="exam-gap-box exam-gap-box--summary exam-gap-box--notes" data-question-type={type}>
      {lines.map((line, index) => {
        const bullet = /^[••\-*]\s+(.*)$/.exec(line);
        const className = bullet ? 'exam-note__bullet'
          : !line.includes('{{') ? (index === 0 ? 'exam-note__title' : 'exam-note__heading')
            : 'exam-note__line';
        return <div className={className} key={`${index}-${line}`}>{renderTemplate(bullet?.[1] || line, `line-${index}`)}</div>;
      })}
    </div>;
  }
  return <div className="exam-gap-box exam-gap-box--summary" data-question-type={type}>
    <p className="exam-summary__prose">{renderTemplate(summary, 'prose')}</p>
  </div>;
}

function DiagramImageRun({ run, answers, saveStates, flagged, onAnswer, onFlag }: Omit<QuestionRunProps, 'part'>) {
  const first = run[0];
  const type = String(first.question_type || '');
  return <div className="exam-diagram-container" data-question-type={type}>
    <img
      className="exam-diagram-image"
      src={first.payload?.image_url}
      alt={`${type === 'flow_chart_completion' ? 'Flow chart' : 'Labeled diagram'} for questions ${first.q_num}–${run.at(-1)?.q_num}`}
    />
    <ol className="exam-diagram-rows">{run.map((question) => <li
      className={`exam-diagram-row${saveStates.has(question.q_num) ? ' is-unsaved' : ''}`}
      id={`q-${question.q_num}`}
      key={question.q_num}
    >
      <span className="exam-diagram-row__num">{question.q_num}</span>
      <span className="exam-diagram-row__prompt">{question.prompt || ''}</span>
      <input
        aria-label={`Answer ${question.q_num}`}
        autoComplete="off"
        className="exam-diagram-row__input"
        name={`q-${question.q_num}`}
        value={answers.get(question.q_num) || ''}
        onChange={(event) => onAnswer(question.q_num, event.target.value)}
      />
      <button className="reading-next-flow-flag" type="button" aria-label={`Flag question ${question.q_num} for review`} aria-pressed={flagged.has(question.q_num)} onClick={() => onFlag(question.q_num)}>⚑</button>
      <SaveHint state={saveStates.get(question.q_num)} />
    </li>)}</ol>
  </div>;
}

function QuestionRun({ run, part, answers, saveStates, flagged, onAnswer, onFlag }: QuestionRunProps) {
  const first = run[0];
  const type = String(first.question_type || '');
  const options = questionOptions(first);
  const hasBank = !!BANK_TITLES[type] && (type !== 'summary_completion' || options.length > 0);
  const hasImageVariant = ['diagram_label_completion', 'flow_chart_completion'].includes(type)
    && !!first.payload?.image_url;
  const hasFlowingTemplate = FLOWING_COMPLETION_TYPES.has(type)
    && typeof first.payload?.template?.summary_text === 'string';
  return <section className="exam-questions__group" data-question-type={type}>
    <div className="exam-questions__instructions exam-questions__instructions--type" data-question-type={type}>
      {readingQuestionInstruction(run, part)}
    </div>
    {hasBank ? <QuestionBank type={type} options={options} /> : null}
    {hasImageVariant ? <DiagramImageRun run={run} answers={answers} saveStates={saveStates} flagged={flagged} onAnswer={onAnswer} onFlag={onFlag} />
      : hasFlowingTemplate ? <FlowingCompletionRun run={run} answers={answers} saveStates={saveStates} flagged={flagged} onAnswer={onAnswer} onFlag={onFlag} />
        : run.map((question) => <QuestionCard
          key={question.q_num}
          question={question}
          answer={answers.get(question.q_num) || ''}
          saveState={saveStates.get(question.q_num)}
          flagged={flagged.has(question.q_num)}
          onAnswer={(value) => onAnswer(question.q_num, value)}
          onFlag={() => onFlag(question.q_num)}
        />)}
  </section>;
}

function ResultView({ result, attemptId, anonId, from, sittingId }: {
  result: any;
  attemptId: string | null;
  anonId: string | null;
  from: string | null;
  sittingId: string | null;
}) {
  const rows = Array.isArray(result?.per_question) ? result.per_question : [];
  return (
    <main className="exam-state-shell exam-state-shell--results reading-next-state">
      <div className="exam-card exam-card--results">
        <h1 className="exam-card__title">Kết quả</h1>
        <div className="exam-results-band-row">
          <div className="exam-results-score">{result?.score ?? '—'}/{result?.max_score ?? rows.length}</div>
          <div className="exam-results-band">Band {result?.band_estimate == null ? '—' : Number(result.band_estimate).toFixed(1)}</div>
        </div>
        <table className="reading-next-result-table">
          <thead><tr><th>Câu</th><th>Bài làm</th><th>Kết quả</th></tr></thead>
          <tbody>{rows.map((row: any) => (
            <tr key={row.q_num}>
              <td>{row.q_num}</td>
              <td>{row.user_answer || '—'}</td>
              <td className={row.correct ? 'is-correct' : 'is-wrong'}>{row.correct ? 'Đúng' : 'Chưa đúng'}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="reading-next-results-actions">
          {attemptId ? <a className="exam-btn exam-btn--primary" href={readingReviewHref(attemptId, { anonId, from, sittingId })}>Xem chữa bài chi tiết →</a> : null}
          <a className="exam-btn" href={readingLibraryHref(from, sittingId)}>← Quay lại kho đề</a>
        </div>
      </div>
    </main>
  );
}

export function ReadingExamSession() {
  const { status, user } = useAuth();
  const [params, setParams] = useState<ReturnType<typeof readingExamParams> | null>(null);
  const [phase, setPhase] = useState<ExamPhase>('loading');
  const [error, setError] = useState('');
  const [test, setTest] = useState<ReadingTest | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>(() => new Map());
  const answersRef = useRef<AnswerMap>(answers);
  const [saveStates, setSaveStates] = useState<SaveState>(() => new Map());
  const [currentPart, setCurrentPart] = useState(1);
  const [flagged, setFlagged] = useState<Set<number>>(() => new Set());
  const [remaining, setRemaining] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [displaySize, setDisplaySize] = useState('medium');
  const [displayTheme, setDisplayTheme] = useState('default');
  const coordinatorRef = useRef<any>(null);
  const ownerRef = useRef<string | null>(null);
  const bootKeyRef = useRef<string | null>(null);
  const autoSubmittedRef = useRef(false);
  const autoEnteredMockRef = useRef(false);

  useEffect(() => { answersRef.current = answers; }, [answers]);

  useEffect(() => {
    try {
      const parsed = readingExamParams(window.location.search);
      setParams(parsed);
      setDisplaySize(localStorage.getItem('ielts-text-size') || 'medium');
      setDisplayTheme(localStorage.getItem('ielts-exam-theme') || 'default');
    } catch {
      setError('Không có mã đề thi hợp lệ.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    document.body.dataset.textSize = displaySize;
    document.body.dataset.examTheme = displayTheme;
    try {
      localStorage.setItem('ielts-text-size', displaySize);
      localStorage.setItem('ielts-exam-theme', displayTheme);
    } catch {}
  }, [displaySize, displayTheme]);

  const anonCapability = useCallback(() => {
    if (!params?.share) return undefined;
    try {
      return localStorage.getItem(`reading-anon:${params.share}`) || undefined;
    } catch { return undefined; }
  }, [params?.share]);

  const anonHeaders = useCallback(() => {
    const value = anonCapability();
    return value ? { 'X-Reading-Anon': value } : undefined;
  }, [anonCapability]);

  const passwordHeaders = useCallback(() => {
    if (!params?.testId) return undefined;
    try {
      const value = sessionStorage.getItem(`reading-pw:${params.testId}`);
      return value ? { 'X-Reading-Password': value } : undefined;
    } catch { return undefined; }
  }, [params?.testId]);

  const boot = useCallback(async () => {
    if (!params) return;
    const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (Reading exam)');
    if (!ready) throw new Error('Không thể kết nối lớp dữ liệu.');
    const path = params.share
      ? `/api/reading/test/share/${encodeURIComponent(params.share)}/boot`
      : queryWithClassItem(`/api/reading/test/${encodeURIComponent(params.testId!)}/boot`, params.classItem);
    const payload = await window.api.getWith<any>(
      path,
      params.share ? anonHeaders() : passwordHeaders(),
      params.share ? { noRedirect: true } : undefined,
    );
    const normalized = normalizeReadingBoot(payload, params.testId) as { test: ReadingTest; inProgress: Attempt & { answers: any[] } | null };
    setTest(normalized.test);
    setCurrentPart(Number(normalized.test.passages[0]?.passage_order || 1));
    if (normalized.inProgress) {
      const restored = answersFromRows(normalized.inProgress.answers);
      answersRef.current = restored;
      setAnswers(new Map(restored));
      setAttempt(normalized.inProgress);
      setResumeAvailable(true);
    } else {
      answersRef.current = new Map();
      setAnswers(new Map());
      setAttempt(null);
      setResumeAvailable(false);
    }
    setPhase('prestart');
  }, [anonHeaders, params, passwordHeaders]);

  const bootWithRecovery = useCallback(async () => {
    if (!params) return;
    setError('');
    setPhase('loading');
    let caught: any = null;
    try {
      await boot();
      return;
    } catch (error) {
      caught = error;
    }
    if (!params.share && caught?.status === 403) {
      const supplied = window.prompt('🔒 Bài thi này đang khoá. Nhập mật khẩu để vào:');
      if (supplied?.trim()) {
        try { sessionStorage.setItem(`reading-pw:${params.testId}`, supplied.trim()); } catch {}
        try {
          await boot();
          return;
        } catch (retryError) {
          caught = retryError;
        }
      }
    }
    setError(params.share && [403, 404].includes(caught?.status)
      ? 'Liên kết chia sẻ đã hết hạn hoặc không hợp lệ.'
      : `Không tải được bài thi. ${caught?.message || ''}`);
    setPhase('error');
  }, [boot, params]);

  useEffect(() => {
    if (!params || status === 'initial-loading') return;
    if (!params.share && status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (!params.share && status === 'signed-in' && user?.id) {
      if (ownerRef.current && ownerRef.current !== user.id) {
        window.location.reload();
        return;
      }
      ownerRef.current = user.id;
    }
    if (!params.share && status !== 'signed-in') return;
    // Shared attempts are owned by the anonymous capability, not the current
    // Supabase account. Keep their boot identity stable across cross-tab auth
    // changes so an active answer map cannot be replaced by a stale re-boot.
    const ownerKey = params.share ? 'share-capability' : user?.id || 'anon';
    const key = `${params.share || params.testId}:${params.classItem || ''}:${ownerKey}`;
    if (bootKeyRef.current === key) return;
    bootKeyRef.current = key;
    void bootWithRecovery();
  }, [bootWithRecovery, params, status, user?.id]);

  const saveAnswer = useCallback(async (qNum: number, value: string, options: { keepalive?: boolean }) => {
    if (!attempt) return null;
    const path = `/api/reading/test/attempts/${encodeURIComponent(attempt.attempt_id)}/answers`;
    return window.api.patchWith(
      path,
      { q_num: qNum, user_answer: value },
      params?.share ? anonHeaders() : undefined,
      { noRedirect: !!params?.share, keepalive: !!options.keepalive },
    );
  }, [anonHeaders, attempt, params?.share]);

  useEffect(() => {
    coordinatorRef.current?.dispose?.();
    if (!attempt || phase === 'results' || phase === 'sealed') return undefined;
    const coordinator = createReadingSaveCoordinator({ save: saveAnswer });
    coordinator.seed(answersRef.current);
    const unsubscribe = coordinator.subscribe((snapshot: SaveState) => setSaveStates(new Map(snapshot)));
    coordinatorRef.current = coordinator;
    const flushPage = () => { void coordinator.flush({ keepalive: true }); };
    const flushHidden = () => { if (document.visibilityState === 'hidden') flushPage(); };
    const retryOnline = () => coordinator.retryFailed();
    window.addEventListener('pagehide', flushPage);
    window.addEventListener('online', retryOnline);
    document.addEventListener('visibilitychange', flushHidden);
    return () => {
      flushPage();
      unsubscribe();
      coordinator.dispose();
      window.removeEventListener('pagehide', flushPage);
      window.removeEventListener('online', retryOnline);
      document.removeEventListener('visibilitychange', flushHidden);
    };
  }, [attempt?.attempt_id, phase === 'results' || phase === 'sealed', saveAnswer]);

  const enterAttempt = useCallback(async (nextAttempt: Attempt, restored: AnswerMap) => {
    const hook = (window as any).MockHook;
    if (params?.sittingId && typeof hook?.attach === 'function') {
      await hook.attach('reading', nextAttempt.attempt_id);
    }
    answersRef.current = restored;
    setAnswers(new Map(restored));
    setAttempt(nextAttempt);
    setResumeAvailable(false);
    setRemaining(readingRemainingSeconds(nextAttempt.started_at, nextAttempt.time_limit_minutes));
    setPhase('inprogress');
  }, [params?.sittingId]);

  const resume = useCallback(() => {
    if (!attempt) return;
    void enterAttempt(attempt, answersRef.current).catch((caught: any) => {
      setError(`Không thể tiếp tục bài thi. ${caught?.message || ''}`);
      setPhase('error');
    });
  }, [attempt, enterAttempt]);

  const startFresh = useCallback(async () => {
    if (!params || !test) return;
    setPhase('loading');
    try {
      let response: any;
      if (params.share) {
        response = await window.api.postWith(
          `/api/reading/test/share/${encodeURIComponent(params.share)}/attempts`,
          null,
          anonHeaders(),
          { noRedirect: true },
        );
        if (response?.anon_id) {
          try { localStorage.setItem(`reading-anon:${params.share}`, response.anon_id); } catch {}
        }
      } else {
        response = await window.api.postWith(
          queryWithClassItem(`/api/reading/test/${encodeURIComponent(test.test_id)}/attempts`, params.classItem),
          null,
          passwordHeaders(),
        );
      }
      const nextAttempt = {
        attempt_id: String(response.attempt_id),
        started_at: String(response.started_at),
        time_limit_minutes: Number(response.time_limit_minutes || test.time_limit_minutes),
      };
      await enterAttempt(nextAttempt, new Map());
    } catch (caught: any) {
      setError(`Không bắt đầu được bài thi. ${caught?.message || ''}`);
      setPhase('error');
    }
  }, [anonHeaders, enterAttempt, params, passwordHeaders, test]);

  useEffect(() => {
    if (phase !== 'prestart' || !params?.mockEmbed || autoEnteredMockRef.current) return;
    autoEnteredMockRef.current = true;
    if (resumeAvailable) resume(); else void startFresh();
  }, [params?.mockEmbed, phase, resume, resumeAvailable, startFresh]);

  const updateAnswer = useCallback((qNum: number, value: string) => {
    const next = new Map(answersRef.current);
    if (value) next.set(qNum, value); else next.delete(qNum);
    answersRef.current = next;
    setAnswers(next);
    coordinatorRef.current?.update(qNum, value);
  }, []);

  const toggleFlag = useCallback((qNum: number) => {
    setFlagged((previous) => {
      const next = new Set(previous);
      if (next.has(qNum)) next.delete(qNum); else next.add(qNum);
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    if (!attempt || phase === 'submitting' || phase === 'results' || phase === 'sealed') return;
    setSubmitOpen(false);
    setPhase('submitting');
    try {
      await coordinatorRef.current?.flush?.();
      const body = { answers: [...answersRef.current].map(([q_num, user_answer]) => ({ q_num, user_answer })) };
      const path = `/api/reading/test/attempts/${encodeURIComponent(attempt.attempt_id)}/submit`;
      const response = params?.share
        ? await window.api.postWith(path, body, anonHeaders(), { noRedirect: true })
        : await window.api.post(path, body);
      const hook = (window as any).MockHook;
      if (hook?.isSealedResponse?.(response)) {
        setPhase('sealed');
        if (!params?.mockEmbed) hook.showSealedAndReturn('reading');
        return;
      }
      setResult(response);
      setPhase('results');
    } catch (caught: any) {
      setError(`Không nộp được bài. ${caught?.message || ''}`);
      setPhase('error');
    }
  }, [anonHeaders, attempt, params?.mockEmbed, params?.share, phase]);

  useEffect(() => {
    if (phase !== 'inprogress' || !attempt || params?.mockEmbed) return undefined;
    const tick = () => {
      const next = readingRemainingSeconds(attempt.started_at, attempt.time_limit_minutes);
      setRemaining(next);
      if (next === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        void submit();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [attempt, params?.mockEmbed, phase, submit]);

  const passages = test?.passages || [];
  const currentPassage = passages.find((passage) => Number(passage.passage_order || 1) === currentPart) || passages[0] || null;
  const questions = (test?.questions || []).filter((question) => Number(question.passage_order || 1) === currentPart);
  const questionRuns = consecutiveReadingQuestionRuns(questions) as Question[][];
  const unsavedFailed = [...saveStates.values()].filter((state) => state === 'failed').length;
  const unsavedRetrying = saveStates.size - unsavedFailed;
  const total = test?.total_questions || test?.questions.length || 0;
  const backHref = readingLibraryHref(params?.from, params?.sittingId);

  if (phase === 'results') return <ResultView
    result={result}
    attemptId={attempt?.attempt_id || null}
    anonId={anonCapability() || null}
    from={params?.from || null}
    sittingId={params?.sittingId || null}
  />;

  return (
    <>
      <a className="vh" href="#exam-questions">Skip to test content</a>
      <header className="exam-topbar" role="banner">
        <div className="exam-topbar__left">
          <div className="exam-topbar__candidate">Candidate <b>{user?.email || (params?.share ? 'Guest' : '—')}</b></div>
          <div className="exam-topbar__section">{test?.title || 'Reading Test'}</div>
        </div>
        <div className="exam-timer-wrap" hidden={!['inprogress', 'submitting'].includes(phase) || !!params?.mockEmbed}>
          <div className="exam-timer" data-state={remaining <= 300 ? 'critical' : remaining <= 600 ? 'warning' : 'normal'} role="timer" aria-live="off">{formatTime(remaining)}</div>
          <div className="exam-timer__label">time remaining</div>
        </div>
        <div className="exam-topbar__right">
          <label className="exam-tool">Text
            <select value={displaySize} onChange={(event) => setDisplaySize(event.target.value)}>
              <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
            </select>
          </label>
          <label className="exam-tool">Theme
            <select value={displayTheme} onChange={(event) => setDisplayTheme(event.target.value)}>
              <option value="default">Default</option><option value="cream">Cream</option><option value="dark">Dark</option><option value="yellow-on-blue">Yellow / blue</option>
            </select>
          </label>
        </div>
      </header>

      {phase === 'loading' ? <main className="exam-state-shell reading-next-state"><p className="exam-state-msg">Đang tải bài thi…</p></main> : null}
      {phase === 'error' ? <main className="exam-state-shell reading-next-state">
        <p className="exam-state-msg exam-state-msg--error" role="alert">{error}</p>
        <div className="reading-next-error-actions"><button className="exam-btn exam-btn--primary" type="button" onClick={() => void bootWithRecovery()}>Thử lại</button><a className="exam-btn" href={backHref}>← Quay lại kho đề</a></div>
      </main> : null}
      {phase === 'prestart' && test ? <main className="exam-state-shell reading-next-state">
        <div className="exam-card">
          <h1 className="exam-card__title">{test.title}</h1>
          <div className="exam-card__meta">{test.passages.length} đoạn · {total} câu · {test.time_limit_minutes} phút</div>
          <div className="exam-rules"><h3>Trước khi bắt đầu</h3><ul><li>Đồng hồ chạy liên tục sau khi bắt đầu.</li><li>Mỗi câu trả lời được lưu vào máy chủ.</li><li>Refresh trang có thể tiếp tục attempt đang mở.</li><li>Khi hết giờ, hệ thống tự nộp bài.</li></ul></div>
          <div className="reading-next-prestart-actions">
            <a className="exam-btn" href={backHref}>← Quay lại</a>
            {resumeAvailable ? <button className="exam-btn exam-btn--primary" type="button" onClick={resume}>Tiếp tục bài đang làm</button> : null}
            <button className="exam-btn" type="button" onClick={() => {
              if (!resumeAvailable || window.confirm('Bài đang làm sẽ bị hủy và thay bằng attempt mới. Tiếp tục?')) void startFresh();
            }}>{resumeAvailable ? 'Bắt đầu lại từ đầu' : 'Bắt đầu bài thi'}</button>
          </div>
        </div>
      </main> : null}
      {['inprogress', 'submitting'].includes(phase) && test ? <>
        <main className="exam-split reading-next-state" id="reading-next-player">
          <section className="exam-passage" aria-label="Reading passage"><PassageView passage={currentPassage} /></section>
          <div className="exam-divider" role="separator" aria-orientation="vertical" aria-label="Reading panels" />
          <section className="exam-questions" id="exam-questions" aria-label="Questions">
            <div className="exam-questions__part-heading"><strong>Part {currentPart}</strong>{questions.length ? ` — Questions ${questions[0].q_num}–${questions.at(-1)?.q_num}` : ''}</div>
            <div className="reading-next-question-group">{questionRuns.map((run) => <QuestionRun
              key={`${run[0].question_type || 'question'}-${run[0].q_num}`}
              run={run}
              part={currentPart}
              answers={answers}
              saveStates={saveStates}
              flagged={flagged}
              onAnswer={updateAnswer}
              onFlag={toggleFlag}
            />)}</div>
          </section>
        </main>
        <footer className="exam-palette" role="navigation" aria-label="Question palette">
          <div className="exam-palette__grid" role="group" aria-label={`Questions 1 to ${total}`}>
            {(test.questions || []).map((question) => <button
              className={`exam-palette__q${answers.has(question.q_num) ? ' is-answered' : ''}${flagged.has(question.q_num) ? ' is-flagged' : ''}${saveStates.has(question.q_num) ? ' is-unsaved' : ''}`}
              data-q={question.q_num}
              key={question.q_num}
              type="button"
              onClick={() => {
                setCurrentPart(Number(question.passage_order || 1));
                requestAnimationFrame(() => document.getElementById(`q-${question.q_num}`)?.scrollIntoView({ block: 'center' }));
              }}
            >{question.q_num}</button>)}
          </div>
          {saveStates.size ? <p className="reading-next-save-banner" role="status">
            {unsavedRetrying ? `Đang thử lưu lại ${unsavedRetrying} câu. ` : ''}
            {unsavedFailed ? `${unsavedFailed} câu chưa lưu được lên máy chủ.` : 'Đừng đóng tab tới khi cảnh báo biến mất.'}
            {unsavedFailed ? <button type="button" onClick={() => coordinatorRef.current?.retryFailed?.()}>Thử lại</button> : null}
          </p> : null}
          <div className="exam-palette__actions">
            <div className="exam-palette__nav" role="group" aria-label="Previous or next passage">
              <button className="exam-palette__nav-btn" type="button" disabled={currentPart <= Number(passages[0]?.passage_order || 1)} onClick={() => setCurrentPart((part) => part - 1)}>← Part</button>
              <button className="exam-palette__nav-btn" type="button" disabled={currentPart >= Number(passages.at(-1)?.passage_order || currentPart)} onClick={() => setCurrentPart((part) => part + 1)}>Part →</button>
            </div>
            {!params?.mockEmbed ? <button className="exam-btn exam-btn--primary" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(true)}>{phase === 'submitting' ? 'Đang nộp…' : 'Submit'}</button> : null}
          </div>
        </footer>
      </> : null}
      {phase === 'sealed' ? <main className="exam-state-shell reading-next-state"><p className="exam-state-msg">Đã thu bài Reading. Đang chờ kỳ thi chuyển bước tiếp theo…</p></main> : null}

      {submitOpen ? <div className="exam-modal" role="dialog" aria-modal="true" aria-labelledby="reading-next-submit-title">
        <div className="exam-modal__backdrop" onClick={() => setSubmitOpen(false)} />
        <div className="exam-modal__panel reading-next-submit-panel">
          <h2 id="reading-next-submit-title">Nộp bài?</h2>
          <p>{answers.size < total ? `Bạn còn ${total - answers.size}/${total} câu chưa trả lời.` : `Bạn đã trả lời tất cả ${total} câu.`}</p>
          <div className="exam-modal__actions"><button className="exam-btn" type="button" onClick={() => setSubmitOpen(false)}>Quay lại làm tiếp</button><button className="exam-btn exam-btn--primary" type="button" onClick={() => void submit()}>Nộp bài</button></div>
        </div>
      </div> : null}
    </>
  );
}
