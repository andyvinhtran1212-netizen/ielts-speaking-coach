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
  listeningRendererHref,
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
type Attempt = { attempt_id: string; started_at: string; answers?: any[]; renderer_affinity?: 'legacy' | 'next' | null };
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
  return <span className="listening-next-gap" id={`q-${qNum}`} data-q-num={qNum}>
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
          <input className="ft-q-input" data-q-num={qNum} type="radio" name={`q-${qNum}`} value={value} checked={answers.get(qNum) === value} onChange={() => onAnswer(qNum, value)} />
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
        <select className="ft-q-input ielts-gap-input" data-q-num={qNum} aria-label={`Answer ${qNum}`} value={answers.get(qNum) || ''} onChange={(event) => onAnswer(qNum, event.target.value)}>
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
  return <div className="ielts-mc-group" id={slots[0] ? `q-${slots[0]}` : undefined} data-q-group={slots.join(' ')} role="group" aria-label={`Answers ${slots.join(' to ')}`}>
    {options.map((option: any) => {
      const value = optionValue(option);
      const checked = selected.includes(value);
      return <label className="ielts-mc-opt" key={value}>
        <input type="checkbox" data-q-num={slots[0]} value={value} checked={checked} disabled={!checked && selected.length >= choose} onChange={(event) => {
          const next = event.target.checked ? [...selected, value] : selected.filter((item) => item !== value);
          slots.forEach((slot, index) => onAnswer(slot, next[index] || ''));
        }} />
        <span><strong>{value}</strong> <InlineText text={optionText(option)} /></span>
      </label>;
    })}
  </div>;
}

function MatchingMatrixTemplate({ payload, questions, answers, onAnswer }: {
  payload: any; questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  const bank = Array.isArray(payload?.metadata?.match_options) ? payload.metadata.match_options : [];
  if (!bank.length) return <SelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
  return <div className="listening-next-match-layout">
    <div className="listening-next-match-table-wrap"><table className="listening-next-match-table">
      <thead><tr><th scope="col">Item</th>{bank.map((option: any) => <th scope="col" key={optionValue(option)}>{optionValue(option)}</th>)}</tr></thead>
      <tbody>{questions.map((question) => {
        const qNum = Number(question.q_num);
        return <tr id={`q-${qNum}`} key={qNum} className={answers.has(qNum) ? 'is-answered' : ''}>
          <th scope="row"><span className="ielts-question-num">{qNum}</span><InlineText text={question.prompt || ''} /></th>
          {bank.map((option: any) => {
            const value = optionValue(option);
            return <td key={value}><label aria-label={`Question ${qNum}: ${value}`}><input data-q-num={qNum} type="radio" name={`q-${qNum}`} value={value} checked={answers.get(qNum) === value} onChange={() => onAnswer(qNum, value)} /></label></td>;
          })}
        </tr>;
      })}</tbody>
    </table></div>
    <aside className="listening-next-match-bank" aria-label="Matching options"><strong>Options</strong><ul>{bank.map((option: any) => <li key={optionValue(option)}><b>{optionValue(option)}</b> <InlineText text={optionText(option)} /></li>)}</ul></aside>
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
  else if (kind === 'matching') content = <MatchingMatrixTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
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
  const maxScore = Number(result?.max_score ?? rows.length) || rows.length;
  const score = Number.isFinite(Number(result?.score)) ? Number(result.score) : rows.filter((row: any) => row.correct).length;
  const answered = rows.filter((row: any) => String(row.user_answer ?? '').trim()).length;
  const needsReview = Math.max(0, maxScore - score);
  const accuracy = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const sections = Object.entries(result?.section_breakdown || {});
  return <main className="exam-result-shell listening-next-result">
    <section className="exam-result-page" aria-labelledby="listening-result-title">
      <header className="exam-result-heading"><div><p className="exam-result-eyebrow">LISTENING · FULL TEST COMPLETE</p><h1 id="listening-result-title">Kết quả bài thi</h1><p>{test.title}</p></div><span className="exam-result-status">Đã nộp bài</span></header>

      <section className="exam-result-hero" aria-label="Tổng quan kết quả">
        <div className="exam-result-band"><span>Estimated band</span><strong>{result?.band_estimate == null ? '<4.0' : Number(result.band_estimate).toFixed(1)}</strong><small>Kết quả luyện tập</small></div>
        <div className="exam-result-metrics">
          <div><span>Đúng</span><strong>{score}<small>/{maxScore}</small></strong></div>
          <div><span>Tỉ lệ chính xác</span><strong>{accuracy}<small>%</small></strong></div>
          <div><span>Đã trả lời</span><strong>{answered}<small>/{maxScore}</small></strong></div>
          <div><span>Cần nghe lại</span><strong>{needsReview}</strong></div>
        </div>
      </section>

      {sections.length ? <section className="exam-result-parts" aria-labelledby="listening-result-parts"><div className="exam-result-section-heading"><div><p>SECTION BREAKDOWN</p><h2 id="listening-result-parts">Kết quả theo từng phần</h2></div></div><div className="exam-result-part-grid">{sections.map(([key, value]: [string, any], index) => {
        const total = Number(value?.total || 0);
        const correct = Number(value?.correct || 0);
        const sectionNumber = Number(String(key).match(/\d+/)?.[0]) || index + 1;
        return <div className="exam-result-part" key={key}><div><span>Part {sectionNumber}</span><strong>{correct}/{total}</strong></div><div className="exam-result-progress" aria-label={`Part ${sectionNumber}: đúng ${correct} trên ${total}`}><span style={{ width: `${total ? Math.round((correct / total) * 100) : 0}%` }} /></div></div>;
      })}</div></section> : null}

      <section className="exam-result-review-card" aria-labelledby="listening-result-review-title"><div className="exam-result-section-heading"><div><p>QUESTION MAP</p><h2 id="listening-result-review-title">Tổng quan {maxScore} câu</h2></div><div className="exam-result-legend" aria-label="Chú thích"><span className="is-correct" />Đúng <span className="is-wrong" />Cần nghe lại <span className="is-empty" />Bỏ trống</div></div><div className="exam-result-question-map">{rows.map((row: any) => {
        const empty = !String(row.user_answer ?? '').trim();
        return <span className={empty ? 'is-empty' : row.correct ? 'is-correct' : 'is-wrong'} aria-label={`Câu ${row.q_num}: ${empty ? 'bỏ trống' : row.correct ? 'đúng' : 'cần nghe lại'}`} key={row.q_num}>{row.q_num}</span>;
      })}</div></section>

      <section className="exam-result-next-step"><div><p className="exam-result-eyebrow">BƯỚC TIẾP THEO</p><h2>{needsReview ? `Nghe lại ${needsReview} câu chưa đúng` : 'Xem lại transcript và bẫy nghe'}</h2><p>Mở đúng đoạn audio, đối chiếu transcript và phân tích paraphrase theo từng câu.</p></div><div className="exam-result-actions">{attempt ? <a className="ft-control-btn" href={listeningReviewHref(attempt.attempt_id, from)}>Vào chữa bài <span aria-hidden="true">→</span></a> : null}<a className="ft-control-btn ghost" href={listeningDictationHref(test.id)}>Luyện chép chính tả</a><a className="ft-control-btn ghost" href={listeningLibraryHref(from, sittingId)}>Về kho đề</a></div></section>
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
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [reviewQuestions, setReviewQuestions] = useState<Set<number>>(() => new Set());
  const [audioPromptOpen, setAudioPromptOpen] = useState(false);
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

  const claimNextRenderer = useCallback(async (attemptId: string) => {
    const claimed: any = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/renderer-affinity`,
      { renderer_affinity: 'next' },
    );
    const canonical = String(claimed?.renderer_affinity || '');
    if (!['legacy', 'next'].includes(canonical)) throw new Error('Renderer của attempt không hợp lệ.');
    if (canonical !== 'next') {
      window.location.replace(listeningRendererHref(canonical, window.location.search));
      return null;
    }
    return canonical as 'next';
  }, []);

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
    const firstQuestion = Number(listeningQuestions(normalizedTest)[0]?.question?.q_num || 0);
    setTestData(normalizedTest);
    setActiveSection(firstSection);
    setCurrentQuestion(firstQuestion || null);
    if (normalizedAttempt) {
      const affinity = await claimNextRenderer(normalizedAttempt.attempt_id);
      if (!affinity) return;
      const ownedAttempt = { ...normalizedAttempt, renderer_affinity: affinity };
      const restored = listeningAnswersFromRows(ownedAttempt.answers);
      answersRef.current = restored;
      setAnswers(new Map(restored));
      setAttempt(ownedAttempt);
      setResumeAvailable(true);
    } else {
      answersRef.current = new Map(); setAnswers(new Map()); setAttempt(null); setResumeAvailable(false);
    }
    setPhase('prestart');
  }, [claimNextRenderer, params, resumePath]);

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
    const firstQuestion = Number(listeningQuestions(testData)[0]?.question?.q_num || 0);
    setCurrentQuestion(firstQuestion || null);
    setAudioPromptOpen(!!testData && !isPracticeListeningTest(testData) && !params?.mockEmbed);
    setPhase('inprogress');
  }, [params?.mockEmbed, params?.sittingId, resolveAudioOffset, testData]);

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
        withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}/attempts`, [['class_item', params.classItem]]),
        { renderer_affinity_protocol: 'claim-v1' },
      );
      const affinity = await claimNextRenderer(String(started.attempt_id));
      if (!affinity) return;
      const hook = (window as any).MockHook;
      if (params.sittingId && typeof hook?.attach === 'function') await hook.attach('listening', started.attempt_id);
      const canonical = normalizeListeningResume(await window.api.get(resumePath(params)));
      if (!canonical || canonical.attempt_id !== String(started.attempt_id)) throw new Error('Không xác nhận được attempt vừa tạo.');
      const ownedAttempt = { ...canonical, renderer_affinity: affinity };
      await enterAttempt(ownedAttempt, new Map(), false);
    } catch (caught: any) { setError(`Không bắt đầu được bài Listening. ${caught?.message || ''}`); setPhase('error'); }
  }, [claimNextRenderer, enterAttempt, params, resumePath]);

  useEffect(() => {
    if (phase !== 'prestart' || !params?.mockEmbed || autoEnteredMockRef.current) return;
    autoEnteredMockRef.current = true;
    if (resumeAvailable) resume(); else void startFresh();
  }, [params?.mockEmbed, phase, resume, resumeAvailable, startFresh]);

  const updateAnswer = useCallback((qNum: number, value: string) => {
    if (collectionFrozenRef.current) return;
    const next = new Map(answersRef.current);
    if (value) next.set(qNum, value); else next.delete(qNum);
    answersRef.current = next; setAnswers(next); setCurrentQuestion(qNum); setSubmitBlocked('');
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
    try {
      await audio.play();
      setPlaying(true); setPlaybackStarted(true); setAudioEnded(false);
      setAudioPromptOpen(false); setAudioError('');
    }
    catch {
      setPlaying(false);
      setAudioPromptOpen(false);
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
      setAudioPromptOpen(!isPracticeListeningTest(refreshed) && !params.mockEmbed);
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

  const jumpToQuestion = useCallback((qNum: number) => {
    const target = allQuestions.find(({ question }: any) => Number(question.q_num) === qNum);
    if (!target) return;
    setCurrentQuestion(qNum);
    setActiveSection(Number(target.sectionNum));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const targetElement = document.getElementById(`q-${qNum}`) || document.querySelector<HTMLElement>(`[data-q-group~="${qNum}"]`);
      targetElement?.scrollIntoView({ block: 'center' });
    }));
  }, [allQuestions]);

  const moveQuestion = useCallback((direction: -1 | 1) => {
    if (!allQuestions.length) return;
    const index = Math.max(0, allQuestions.findIndex(({ question }: any) => Number(question.q_num) === currentQuestion));
    const target = allQuestions[Math.min(allQuestions.length - 1, Math.max(0, index + direction))];
    if (target) jumpToQuestion(Number(target.question.q_num));
  }, [allQuestions, currentQuestion, jumpToQuestion]);

  useEffect(() => {
    if (saveStates.size === 0) setSubmitBlocked('');
  }, [saveStates.size]);

  useEffect(() => {
    if (!testData?.cue_points?.length) return;
    let nextSection = activeSection;
    for (const cue of testData.cue_points) {
      if (cue?.type === 'section_start' && Number(cue.timestamp_seconds) <= currentTime + 0.5 && Number(cue.section_num) > nextSection) nextSection = Number(cue.section_num);
    }
    if (nextSection !== activeSection) {
      setActiveSection(nextSection);
      const firstQuestion = allQuestions.find(({ sectionNum }: any) => Number(sectionNum) === nextSection);
      const qNum = Number(firstQuestion?.question?.q_num || 0);
      if (qNum) setCurrentQuestion(qNum);
    }
  }, [activeSection, allQuestions, currentTime, testData?.cue_points]);

  useEffect(() => {
    const testing = ['inprogress', 'submitting'].includes(phase);
    document.body.classList.toggle('listening-next-testing', testing);
    return () => document.body.classList.remove('listening-next-testing');
  }, [phase]);

  if (phase === 'results' && testData) return <ResultView result={result} attempt={attempt} test={testData} from={params?.from || null} sittingId={params?.sittingId || null} />;

  const activeSectionData = sections.find((section: any) => Number(section.section_num) === activeSection);
  const activeSectionQuestions = questionsForSection(activeSectionData);

  return <>
    <a className="vh" href="#listening-paper">Skip to test content</a>
    <header className="exam-topbar listening-next-topbar" role="banner">
      <div className="exam-topbar__left">
        <div className="exam-topbar__candidate">Aver Learning <b>{user?.email || 'Candidate'}</b></div>
        <div className="exam-topbar__section">IELTS Listening Practice · {testData?.title || 'Listening Test'}</div>
      </div>
      <div className="listening-next-audio-state" aria-live="polite" hidden={!['inprogress', 'submitting'].includes(phase)}>
        <strong>{practice ? (playing ? 'Practice audio playing' : 'Practice audio ready') : audioEnded ? 'Audio has ended' : playing ? 'Audio is Playing' : playbackStarted ? 'Audio paused' : 'Audio ready'}</strong>
        {practice ? <span>{formatTime(currentTime)} / {formatTime(duration)}</span> : <span>{playing ? 'Do not close this page' : 'Listening test'}</span>}
      </div>
      <div className="exam-topbar__right"><span className="listening-next-topbar-progress">{answers.size}/{total || '—'} answered</span></div>
    </header>
    <main className={`listening-next-shell${['inprogress', 'submitting'].includes(phase) ? ' is-testing' : ''}`}>
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
            if (!resumeAvailable) { void startFresh(); return; }
            if (window.confirm('Bài đang làm sẽ bị bỏ và thay bằng attempt mới. Tiếp tục?')) void startFresh();
          }}>{resumeAvailable ? 'Bắt đầu lại từ đầu' : 'Bắt đầu test'}</button>
        </div>
      </section> : null}
      {['inprogress', 'submitting'].includes(phase) && testData ? <>
        <section className="listening-next-part-strip" aria-label={`Part ${activeSection}`}>
          <strong>Part {activeSection}</strong><span>{activeSectionQuestions.length ? `Listen and answer questions ${activeSectionQuestions[0]?.q_num}–${activeSectionQuestions.at(-1)?.q_num}.` : 'Listen and answer the questions.'}</span>
        </section>
        <section className={`ft-sticky listening-next-player${practice ? ' is-practice' : ' is-full-test'}`} aria-label="Audio controls">
          {practice ? <>
            <div className="ft-sticky-row"><span className="ft-progress-text">Practice audio</span><span className="ft-time">{formatTime(currentTime)} / {formatTime(duration)}</span></div>
            <div className="ft-audio-bar ft-audio-bar--seekable"><div className="ft-audio-fill" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }} /></div>
          </> : <div className="listening-next-full-audio-copy"><span className="listening-next-headphones" aria-hidden="true">◉</span><span><strong>{audioEnded ? 'Audio has ended' : playing ? 'Audio is Playing' : playbackStarted ? 'Audio paused by the browser' : 'Audio ready'}</strong><small>{audioEnded ? 'Continue answering before you submit.' : 'The recording cannot be rewound or restarted.'}</small></span></div>}
          {audioError ? <div className="ft-audio-error" role="alert"><span>{audioError}</span><button className="ft-control-btn ghost" type="button" onClick={() => void retryAudio()} disabled={audioRetrying}>{audioRetrying ? 'Đang tải lại…' : 'Tải lại audio'}</button></div> : null}
          <div className="ft-audio-controls">
            {practice ? <><button className="ft-control-btn" type="button" onClick={toggleAudio}>{playing ? '⏸ Tạm dừng' : '▶ Play'}</button><input aria-label="Audio progress (kéo để tua)" type="range" min="0" max={Math.max(1, duration)} value={currentTime} onChange={(event) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setCurrentTime(next); }} /></>
              : playbackStarted && !playing && !audioEnded ? <button className="ft-control-btn" type="button" onClick={startAudio}>▶ Tiếp tục</button> : null}
            <label>Volume <input aria-label="Âm lượng" type="range" min="0" max="100" defaultValue="100" onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value) / 100; }} /></label>
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
        <div className="ielts-test-paper" id="listening-paper" onFocusCapture={(event) => {
          const target = (event.target as HTMLElement).closest<HTMLElement>('[data-q-num]');
          const qNum = Number(target?.dataset.qNum || 0);
          if (qNum) setCurrentQuestion(qNum);
        }}>{sections.filter((section: any) => Number(section.section_num) === activeSection).map((section: any) => <section className="ielts-section" key={section.section_num}>
          <div className="ielts-section-label">PART {section.section_num}</div><h2 className="ielts-section-title">{questionRange(section)}</h2>
          {(section.exercises || []).map((exercise: any, index: number) => <Exercise key={exercise.id || index} exercise={exercise} answers={answers} saveStates={saveStates} onAnswer={updateAnswer} />)}
        </section>)}</div>
        <footer className="listening-next-palette" role="navigation" aria-label="Question palette">
          <div className="listening-next-palette-groups">{sections.map((section: any) => {
            const sectionNum = Number(section.section_num);
            const sectionQuestions = questionsForSection(section);
            return <div className={`listening-next-palette-group${sectionNum === activeSection ? ' is-active' : ''}`} key={sectionNum}>
              <button className="listening-next-palette-label" type="button" onClick={() => { setActiveSection(sectionNum); const first = Number(sectionQuestions[0]?.q_num || 0); if (first) setCurrentQuestion(first); }}>Part {sectionNum}</button>
              <div>{sectionQuestions.map((question: any) => {
                const qNum = Number(question.q_num);
                return <button className={`progress-square${answers.has(qNum) ? ' answered' : ''}${qNum === currentQuestion ? ' current' : ''}${reviewQuestions.has(qNum) ? ' is-review' : ''}${saveStates.has(qNum) ? ' is-unsaved' : ''}${saveStates.get(qNum) === 'failed' ? ' is-save-failed' : ''}`} type="button" key={qNum} aria-label={`Question ${qNum}${answers.has(qNum) ? ', answered' : ', unanswered'}${reviewQuestions.has(qNum) ? ', marked for review' : ''}`} onClick={() => jumpToQuestion(qNum)}>{qNum}</button>;
              })}</div>
            </div>;
          })}</div>
          {saveStates.size ? <p className="ft-unsaved-note" role="status">{unsavedRetrying ? `Đang thử lưu lại ${unsavedRetrying} câu. ` : ''}{unsavedFailed ? `${unsavedFailed} câu chưa lưu được lên máy chủ.` : 'Đừng đóng tab tới khi cảnh báo biến mất.'}{unsavedFailed ? <button className="ft-unsaved-retry" type="button" onClick={() => coordinatorRef.current?.retryFailed?.()}>Thử lại</button> : null}</p> : null}
          {submitBlocked ? <p className="ft-nothing-saved" role="alert">{submitBlocked}</p> : null}
          <div className="listening-next-submit-row"><button className="listening-next-nav-btn" type="button" disabled={currentQuestion === Number(allQuestions[0]?.question?.q_num)} onClick={() => moveQuestion(-1)}>‹ Previous</button><label className="listening-next-review"><input type="checkbox" checked={currentQuestion != null && reviewQuestions.has(currentQuestion)} disabled={currentQuestion == null} onChange={() => { if (currentQuestion == null) return; setReviewQuestions((previous) => { const next = new Set(previous); if (next.has(currentQuestion)) next.delete(currentQuestion); else next.add(currentQuestion); return next; }); }} /> Review</label><button className="listening-next-nav-btn" type="button" disabled={currentQuestion === Number(allQuestions.at(-1)?.question?.q_num)} onClick={() => moveQuestion(1)}>Next ›</button>{!params?.mockEmbed ? <button className="btn-submit-final" id="btn-submit" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(true)}>{phase === 'submitting' ? 'Đang chấm…' : 'Submit answers'}</button> : null}</div>
        </footer>
      </> : null}
      {phase === 'sealed' ? <section className="ft-prestart"><p>Đã thu bài Listening. Đang chờ kỳ thi chuyển bước tiếp theo…</p></section> : null}
    </main>
    {audioPromptOpen ? <div className="listening-next-modal listening-next-audio-prompt" role="dialog" aria-modal="true" aria-labelledby="listening-audio-title"><div className="listening-next-modal-backdrop" /><section className="listening-next-modal-panel"><div className="listening-next-audio-icon" aria-hidden="true">◉</div><h2 id="listening-audio-title">Check your headphones</h2><p>When you press Play, the recording starts immediately. You cannot pause, rewind or play it again.</p><button className="ft-control-btn" type="button" autoFocus onClick={() => void startAudio()}>▶ Play</button></section></div> : null}
    {submitOpen ? <div className="listening-next-modal" role="dialog" aria-modal="true" aria-labelledby="listening-submit-title"><button className="listening-next-modal-backdrop" aria-label="Đóng" type="button" onClick={() => setSubmitOpen(false)} /><section className="listening-next-modal-panel"><h2 id="listening-submit-title">Nộp bài?</h2><p>{answers.size < total ? `Bạn còn ${total - answers.size}/${total} câu chưa trả lời.` : `Bạn đã trả lời tất cả ${total} câu.`}</p><div className="listening-next-actions"><button className="ft-control-btn ghost" type="button" onClick={() => setSubmitOpen(false)}>Quay lại làm tiếp</button><button className="ft-control-btn" type="button" onClick={() => void submit()}>Nộp bài</button></div></section></div> : null}
  </>;
}
