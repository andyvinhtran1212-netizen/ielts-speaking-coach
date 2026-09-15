'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSpeakingLadders, readingSupportLines } from '@/lib/advanced-vocabulary-model.mjs';

type Json = Record<string, any>;
type Stage = 'vocabulary' | 'practice_1' | 'practice_2' | 'reading' | 'controlled_rewrite' | 'listening' | 'writing' | 'speaking';

const STAGES: { id: Stage; short: string; label: string }[] = [
  { id: 'vocabulary', short: '01', label: 'Từ vựng' },
  { id: 'practice_1', short: '02', label: 'Luyện nhận diện' },
  { id: 'practice_2', short: '03', label: 'Luyện vận dụng' },
  { id: 'reading', short: '04', label: 'Reading' },
  { id: 'controlled_rewrite', short: '05', label: 'Controlled rewrite' },
  { id: 'listening', short: '06', label: 'Listening' },
  { id: 'writing', short: '07', label: 'Writing Insight' },
  { id: 'speaking', short: '08', label: 'Speaking Lab' },
];

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Có lỗi xảy ra. Hãy thử lại.';
}

function Blocks({ blocks }: { blocks: Json[] | undefined }) {
  if (!blocks?.length) return null;
  return <div className="avx-blocks">{blocks.map((block, index) => {
    const key = `${block.source_index ?? index}-${block.type}`;
    if (block.type === 'heading') return <h4 key={key}>{block.text}</h4>;
    if (block.type === 'list_item') return <div className="avx-list-item" key={key}>• <span>{block.text}</span></div>;
    if (block.type === 'table') return (
      <div className="avx-table-wrap" key={key}><table><tbody>
        {(block.rows || []).map((row: string[], rowIndex: number) => (
          <tr key={rowIndex}>{row.map((cell, cellIndex) => cellIndex === 0
            ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>
        ))}
      </tbody></table></div>
    );
    return <p key={key}>{block.text}</p>;
  })}</div>;
}

function BlockSections({ sections }: { sections: Json[] | undefined }) {
  return <>{(sections || []).map((section, index) => (
    <section className="avx-reference-section" key={`${section.heading || index}`}>
      {section.heading && <h4>{section.heading}</h4>}
      <Blocks blocks={section.blocks || [section]} />
    </section>
  ))}</>;
}

function AudioButton({ src, label }: { src?: string | null; label: string }) {
  const play = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (src) void new Audio(src).play();
  };
  return <button type="button" className="fcs-audio" onClick={play} disabled={!src} aria-label={label}>▶<span>{label}</span></button>;
}

function InlineText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>)}</>;
}

function VocabularyStage({ data, onDone }: { data: Json; onDone: (ids: string[]) => Promise<void> }) {
  const words = data.lesson.vocabulary as Json[];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(
    (data.progress.stages || []).find((row: Json) => row.stage === 'vocabulary')?.evidence?.seen_lexeme_ids || [],
  ));
  const [busy, setBusy] = useState(false);
  const word = words[index];

  useEffect(() => {
    if (!word?.lexeme_id) return;
    setSeen((current) => current.has(word.lexeme_id) ? current : new Set(current).add(word.lexeme_id));
  }, [word?.lexeme_id]);

  const move = (delta: number) => {
    setIndex((current) => Math.max(0, Math.min(words.length - 1, current + delta)));
    setFlipped(false);
  };
  const finish = async () => {
    setBusy(true);
    try { await onDone(words.map((row) => row.lexeme_id)); } finally { setBusy(false); }
  };

  return <div className="avx-vocab-stage">
    <div className="fcs-progress">
      <div><span>Thẻ {index + 1} / {words.length}</span><strong>{seen.size}/{words.length} đã xem</strong></div>
      <div className="fcs-progress__track"><span style={{ width: `${((index + 1) / words.length) * 100}%` }} /></div>
    </div>
    <div className="fcs-stage">
      <div className={`fcs-card ${flipped ? 'is-flipped' : ''}`}>
        <article className="fcs-face fcs-face--front">
          <div className="fcs-card__topline"><span className="fcs-pill">{word.level}</span><span className="fcs-memory">{word.part_of_speech}</span></div>
          <div className="fcs-word"><p>{word.headword}</p><span>{word.pronunciation}</span><AudioButton src={word.audio_headword} label="Nghe từ" /></div>
          <p className="fcs-flip-hint"><span>↻</span> Nhấn vào thẻ để xem nghĩa và cách dùng</p>
        </article>
        <article className="fcs-face fcs-face--back">
          <div className="fcs-back-head"><div><h2>{word.headword}</h2><span>{word.pronunciation}</span></div><AudioButton src={word.audio_headword} label="Nghe" /></div>
          <p className="fcs-definition fcs-definition--primary">{word.definition_vi}</p>
          <p className="fcs-definition">{word.definition_en}</p>
          <div className="fcs-example"><div><span>Ví dụ trong ngữ cảnh</span><AudioButton src={word.audio_example} label="Nghe ví dụ" /></div><p>{word.example}</p></div>
          <div className="fcs-relation"><span>Collocations</span><div>{(word.collocations || []).map((value: string) => <span className="fcs-chip" key={value}>{value}</span>)}</div></div>
          <div className="fcs-callout fcs-callout--memory"><span>↗</span><p>{word.memory_hook}</p></div>
          {word.common_error && <div className="fcs-callout fcs-callout--warning"><span>!</span><p>{word.common_error}</p></div>}
        </article>
      </div>
    </div>
    <div className="avx-card-actions">
      <button className="av-button av-button-secondary" type="button" onClick={() => move(-1)} disabled={index === 0}>← Trước</button>
      <button className="av-button av-button-secondary" type="button" onClick={() => setFlipped((value) => !value)}>↻ Lật thẻ</button>
      {index < words.length - 1
        ? <button className="av-button av-button-primary" type="button" onClick={() => move(1)}>Tiếp →</button>
        : <button className="av-button av-button-primary" type="button" disabled={seen.size < words.length || busy} onClick={() => void finish()}>{busy ? 'Đang lưu…' : 'Hoàn tất thẻ từ'}</button>}
    </div>
  </div>;
}

function QuestionInput({ question, value, onChange, disabled }: { question: Json; value: any; onChange: (value: any) => void; disabled?: boolean }) {
  if (question.input === 'syllable' && question.segments?.length) return <div className="avx-options avx-options--inline">{question.segments.map((segment: string, index: number) => <label key={`${index}-${segment}`}><input type="radio" disabled={disabled} checked={value === index} onChange={() => onChange(index)} /> <span>{segment}</span></label>)}</div>;
  if (/T\/F\/NG/i.test(question.question_type || '')) return <div className="avx-options avx-options--inline">{['TRUE', 'FALSE', 'NOT GIVEN'].map((option) => <label key={option}><input type="radio" disabled={disabled} checked={value === option} onChange={() => onChange(option)} /> <span>{option}</span></label>)}</div>;
  if (/Y\/N\/NG/i.test(question.question_type || '')) return <div className="avx-options avx-options--inline">{['YES', 'NO', 'NOT GIVEN'].map((option) => <label key={option}><input type="radio" disabled={disabled} checked={value === option} onChange={() => onChange(option)} /> <span>{option}</span></label>)}</div>;
  if (question.options?.length) return <div className="avx-options">{question.options.map((option: any, index: number) => {
    const text = typeof option === 'string' ? option : `${option.letter ? `${option.letter}. ` : ''}${option.text}`;
    const answer = typeof option === 'string' ? index : (option.letter || index);
    return <label key={`${answer}-${text}`}><input type="radio" disabled={disabled} checked={String(value) === String(answer)} onChange={() => onChange(answer)} /> <span>{text}</span></label>;
  })}</div>;
  if (question.input === 'boolean' || question.type === 'boolean') return <div className="avx-options avx-options--inline">{[[true, 'Đúng'], [false, 'Sai']].map(([answer, label]) => <label key={String(answer)}><input type="radio" disabled={disabled} checked={value === answer} onChange={() => onChange(answer)} /> <span>{label as string}</span></label>)}</div>;
  return <input className="av-input" disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder="Nhập câu trả lời" />;
}

function PracticeStage({ stage, data, onAnswer, onDone }: { stage: 'practice_1' | 'practice_2'; data: Json; onAnswer: (qid: string, answer: any, responseTimeMs: number) => Promise<Json>; onDone: () => void }) {
  const questions = data.lesson.practice[stage] as Json[];
  const prior = new Map((data.progress.answers || []).filter((row: Json) => row.stage === stage).map((row: Json) => [row.qid, row]));
  const firstOpen = questions.findIndex((row) => !prior.has(row.item_id));
  const [index, setIndex] = useState(Math.max(0, firstOpen));
  const [answer, setAnswer] = useState<any>('');
  const [feedback, setFeedback] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  const question = questions[index];
  const doneCount = prior.size + (feedback && !prior.has(feedback.qid) ? 1 : 0);
  const submit = async () => {
    if (answer === '' || answer == null) return;
    setBusy(true);
    try { setFeedback(await onAnswer(question.item_id, answer, Date.now() - started.current)); } finally { setBusy(false); }
  };
  const next = () => {
    if (index >= questions.length - 1) { onDone(); return; }
    started.current = Date.now(); setIndex((value) => value + 1); setAnswer(''); setFeedback(null);
  };
  if (firstOpen === -1 && !feedback) return <div className="avx-question-card"><div className="avx-complete-callout"><strong>Đã hoàn tất phần này</strong><p>Cả {questions.length} lượt trả lời đã được lưu. Bạn có thể tiếp tục mà không phải nộp lại.</p></div><button className="av-button av-button-primary avx-wide" type="button" onClick={onDone}>Sang phần tiếp theo →</button></div>;
  return <div className="avx-question-card">
    <div className="avx-question-meta"><span>{stage === 'practice_1' ? 'Nhận diện' : 'Vận dụng'}</span><strong>{Math.min(doneCount + 1, questions.length)} / {questions.length}</strong></div>
    <div className="avx-meter"><span style={{ width: `${(doneCount / questions.length) * 100}%` }} /></div>
    <p className="avx-kicker">{question.headword} · {question.skill}</p>
    <h3><InlineText text={question.prompt} /></h3>
    {question.audio_url && <AudioButton src={question.audio_url} label="Nghe từ" />}
    <QuestionInput question={question} value={answer} onChange={setAnswer} disabled={!!feedback || busy} />
    {feedback && <div className={`avx-feedback ${feedback.is_correct ? 'is-correct' : 'is-wrong'}`}><strong>{feedback.is_correct ? 'Chính xác' : 'Chưa chính xác'}</strong><p>{feedback.explanation}</p>{feedback.note && <p><b>Lưu ý:</b> {feedback.note}</p>}</div>}
    <div className="avx-submit-row">{feedback
      ? <button className="av-button av-button-primary" type="button" onClick={next}>{index === questions.length - 1 ? 'Sang phần tiếp theo' : 'Câu tiếp theo →'}</button>
      : <button className="av-button av-button-primary" type="button" disabled={busy || answer === ''} onClick={() => void submit()}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>}</div>
  </div>;
}

function ReadingStage({ content, completed, saved, onSubmit, onContinue }: { content: Json; completed: boolean; saved?: Json; onSubmit: (answers: Json, seconds: number) => Promise<Json>; onContinue: () => void }) {
  const [answers, setAnswers] = useState<Json>(() => Object.fromEntries((saved?.review?.answer_results || []).map((row: Json) => [String(row.id), row.submitted_answer])));
  const [result, setResult] = useState<Json | null>(() => saved?.review || null);
  const [busy, setBusy] = useState(false);
  const [mobilePane, setMobilePane] = useState<'passage' | 'questions'>('passage');
  const started = useRef(Date.now());
  const groups = useMemo(() => {
    const output: { type: string; questions: Json[] }[] = [];
    for (const question of content.questions || []) {
      const type = question.question_type || 'Questions';
      const current = output[output.length - 1];
      if (!current || current.type !== type) output.push({ type, questions: [question] });
      else current.questions.push(question);
    }
    return output;
  }, [content.questions]);
  const submit = async () => { setBusy(true); try { setResult(await onSubmit(answers, Math.round((Date.now() - started.current) / 1000))); } finally { setBusy(false); } };
  return <><div className="avx-reading-mobile-tabs" role="tablist" aria-label="Chọn vùng Reading"><button id="avx-reading-tab-passage" role="tab" aria-controls="avx-reading-panel-passage" aria-selected={mobilePane === 'passage'} className={mobilePane === 'passage' ? 'is-active' : ''} type="button" onClick={() => setMobilePane('passage')}>Bài đọc</button><button id="avx-reading-tab-questions" role="tab" aria-controls="avx-reading-panel-questions" aria-selected={mobilePane === 'questions'} className={mobilePane === 'questions' ? 'is-active' : ''} type="button" onClick={() => setMobilePane('questions')}>Câu hỏi · {Object.keys(answers).length}/{content.questions?.length || 0}</button></div><div className="avx-reading-workspace">
    <article id="avx-reading-panel-passage" role="tabpanel" aria-labelledby="avx-reading-tab-passage" className={`avx-reading-pane avx-reading-passage ${mobilePane === 'passage' ? 'is-mobile-active' : ''}`}><div className="avx-pane-head"><span>Passage</span><strong>{content.title}</strong></div>{(content.passages || []).map((paragraph: Json) => <section key={paragraph.paragraph}><b>{paragraph.paragraph}</b><p>{paragraph.text}</p></section>)}</article>
    <aside id="avx-reading-panel-questions" role="tabpanel" aria-labelledby="avx-reading-tab-questions" className={`avx-reading-pane avx-reading-questions ${mobilePane === 'questions' ? 'is-mobile-active' : ''}`}><div className="avx-pane-head"><span>Questions</span><strong>{Object.keys(answers).length}/{content.questions?.length || 0}</strong></div>
      {completed && !result ? <div className="avx-complete-callout"><strong>Reading đã được lưu</strong><p>{saved ? `${saved.correct}/${saved.total} câu đúng. ` : ''}Bài đã nộp được giữ nguyên; bạn không cần làm lại khi mở xem.</p></div> : <><div className="avx-question-material">{readingSupportLines(content).map((line: string, index: number) => <p key={index}>{line}</p>)}</div>
      {groups.map((group, groupIndex) => { const sharedStem = group.questions.length > 1 && group.questions.every((question) => question.stem === group.questions[0].stem) ? group.questions[0].stem : null; return <section className="avx-reading-group" key={`${groupIndex}-${group.type}`}><header><span>{group.type}</span><b>Câu {group.questions[0].question_number}–{group.questions[group.questions.length - 1].question_number}</b></header>{sharedStem && <p className="avx-reading-shared-stem">{sharedStem}</p>}{group.questions.map((question: Json) => { const qid = String(question.question_number); const checked = result?.answer_results?.find((row: Json) => row.id === qid); const solution = result?.answers?.find((row: Json) => row.id === qid); return <div className="avx-reading-question" key={qid}><p><b>Câu {qid}</b>{!sharedStem && <>. {question.stem}</>}</p><QuestionInput question={question} value={answers[qid]} disabled={!!result} onChange={(value) => setAnswers((current) => ({ ...current, [qid]: value }))} />{checked && <div className={`avx-mini-result ${checked.is_correct ? 'is-correct' : 'is-wrong'}`}>{checked.is_correct ? 'Đúng' : `Đáp án: ${solution?.answer}`}{solution?.evidence && <p>{solution.evidence}</p>}</div>}</div>; })}</section>; })}</>}
      {!completed && !result && <button className="av-button av-button-primary avx-wide" type="button" disabled={busy || Object.keys(answers).length < content.questions.length} onClick={() => void submit()}>{busy ? 'Đang chấm…' : 'Hoàn tất Reading'}</button>}
      {completed && !result && <button className="av-button av-button-primary avx-wide" type="button" onClick={onContinue}>Tiếp tục sang Controlled rewrite →</button>}
      {result && <button className="av-button av-button-primary avx-wide" type="button" onClick={onContinue}>Tiếp tục sang Controlled rewrite →</button>}
    </aside>
  </div></>;
}

function ListeningStage({ content, completed, saved, onSubmit, onRetry, onContinue }: { content: Json; completed: boolean; saved?: Json; onSubmit: (answers: Json, seconds: number) => Promise<Json>; onRetry: (answers: Json) => Promise<Json>; onContinue: () => void }) {
  const [answers, setAnswers] = useState<Json>({});
  const [retryAnswers, setRetryAnswers] = useState<Json>({});
  const [result, setResult] = useState<Json | null>(() => saved?.review || (content.initial_attempt ? ({ ...content.initial_attempt, requires_guided_retry: true, assignment: { completed: false } }) : null));
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const evidenceStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio && evidenceStopRef.current) audio.removeEventListener('timeupdate', evidenceStopRef.current);
    };
  }, []);
  const replayEvidence = (solution: Json) => {
    const audio = audioRef.current;
    const start = Number(solution?.timing?.answer_span?.start);
    const end = Number(solution?.timing?.answer_span?.end);
    if (!audio || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (evidenceStopRef.current) audio.removeEventListener('timeupdate', evidenceStopRef.current);
    const stopAtEnd = () => {
      if (audio.currentTime < end) return;
      audio.pause();
      audio.removeEventListener('timeupdate', stopAtEnd);
      evidenceStopRef.current = null;
    };
    evidenceStopRef.current = stopAtEnd;
    audio.addEventListener('timeupdate', stopAtEnd);
    audio.currentTime = start;
    void audio.play();
  };
  const submit = async () => { setBusy(true); try { setResult(await onSubmit(answers, Math.round((Date.now() - started.current) / 1000))); } finally { setBusy(false); } };
  const retry = async () => { setBusy(true); try { setResult(await onRetry(retryAnswers)); } finally { setBusy(false); } };
  const retrying = Boolean(result?.requires_guided_retry && !result?.answers);
  const wrongIds = (result?.answer_results || []).filter((row: Json) => !row.is_correct).map((row: Json) => String(row.id));
  return <div className="avx-listening-layout">
    <div className="avx-audio-dock"><div><span>Academic listening</span><strong>{content.title}</strong></div><audio ref={audioRef} controls preload="metadata" src={content.audio_url} /></div>
    {(content.sections || []).filter((section: Json) => section.figure_url).map((section: Json) => <figure className="avx-listening-figure" key={section.section_id || section.figure_url}><img src={section.figure_url} alt={`Sơ đồ cho ${section.context || 'bài nghe'}`} /><figcaption>Xem sơ đồ trong khi nghe và dùng các nhãn trên hình cho câu map labelling.</figcaption></figure>)}
    {completed && !result ? <div className="avx-complete-callout"><strong>Listening đã được lưu</strong><p>{saved ? `${saved.correct}/${saved.total} câu đúng. ` : ''}Bạn vẫn có thể nghe lại audio, nhưng bài đã nộp không bị ghi đè.</p></div> : <div className="avx-listening-questions">{(content.questions || []).map((question: Json) => { const qid = String(question.question_number); const checked = result?.answer_results?.find((row: Json) => row.id === qid); const initialChecked = result?.initial_answer_results?.find((row: Json) => row.id === qid); const solution = result?.answers?.find((row: Json) => row.id === qid); const needsRetry = retrying && checked && !checked.is_correct; const shownAnswer = needsRetry ? retryAnswers[qid] : checked?.submitted_answer ?? answers[qid]; const initialChoice = initialChecked?.submitted_answer ?? checked?.submitted_answer; const distractorRationale = !retrying && initialChecked && !initialChecked.is_correct ? solution?.distractor_rationales?.[initialChoice] : null; const answerSpan = solution?.timing?.answer_span; return <section className="avx-question-card avx-question-card--compact" key={qid}><p className="avx-kicker">Câu {qid} · {question.question_type}</p><h3>{question.stem}</h3><QuestionInput question={question} value={shownAnswer} disabled={Boolean(result) && !needsRetry} onChange={(value) => needsRetry ? setRetryAnswers((current) => ({ ...current, [qid]: value })) : setAnswers((current) => ({ ...current, [qid]: value }))} />{checked && <div className={`avx-mini-result ${checked.is_correct ? 'is-correct' : 'is-wrong'}`}>{checked.is_correct ? 'Đúng' : retrying ? 'Chưa đúng — nghe lại và sửa câu này trước khi xem đáp án.' : `Đáp án: ${solution?.answer}`}{!retrying && solution?.evidence && <p>{solution.evidence}</p>}{distractorRationale && <p className="avx-distractor-rationale"><strong>Vì sao lựa chọn ban đầu chưa đúng:</strong> {distractorRationale}</p>}{!retrying && answerSpan && <button className="av-button av-button-secondary avx-evidence-replay" type="button" onClick={() => replayEvidence(solution)}>Nghe đoạn evidence · {Number(answerSpan.start).toFixed(1)}–{Number(answerSpan.end).toFixed(1)}s</button>}</div>}</section>; })}</div>}
    {!completed && !result && <button className="av-button av-button-primary avx-wide" type="button" disabled={busy || Object.keys(answers).length < content.questions.length} onClick={() => void submit()}>{busy ? 'Đang chấm…' : 'Hoàn tất Listening'}</button>}
    {retrying && <div className="avx-boundary-note"><strong>Guided retry</strong><p>Nghe lại và sửa đủ {wrongIds.length} câu chưa đúng. Đáp án và evidence chỉ hiện sau bước này.</p><button className="av-button av-button-primary avx-wide" type="button" disabled={busy || wrongIds.some((qid: string) => retryAnswers[qid] == null || retryAnswers[qid] === '')} onClick={() => void retry()}>{busy ? 'Đang lưu bước sửa…' : 'Hoàn tất sửa và xem đáp án'}</button></div>}
    {result?.assignment?.completed && <div className="avx-complete-callout"><strong>Đã hoàn tất bài học</strong><p>Kết quả được lưu theo từng tương tác; bài này không có điểm tổng mặc định.</p></div>}
    {(completed || result?.assignment?.completed) && <button className="av-button av-button-primary avx-wide" type="button" onClick={onContinue}>Xem Writing Insight →</button>}
  </div>;
}

function ControlledRewriteStage({ activity, completed, onReveal, onContinue }: { activity: Json; completed: boolean; onReveal: (ids: string[]) => Promise<Json>; onContinue: () => void }) {
  const prompts = (activity.content?.prompts || []) as Json[];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [solutions, setSolutions] = useState<Json[] | null>(activity.content?.solutions || null);
  const [busy, setBusy] = useState(false);
  const attempted = prompts.filter((row) => drafts[row.item_id]?.trim()).map((row) => row.item_id);
  const reveal = async () => {
    setBusy(true);
    try {
      const result = await onReveal(attempted);
      setSolutions(result.solutions || []);
    } finally { setBusy(false); }
  };
  return <div className="avx-reference-card avx-rewrite-card">
    <div className="avx-boundary-note"><strong>Self-check — không nộp bài viết</strong><p>Câu trả lời chỉ nằm trên thiết bị này. Hệ thống chỉ lưu việc bạn đã thử đủ 20 câu trước khi mở đáp án tham khảo.</p></div>
    <div className="avx-rewrite-list">{prompts.map((row, index) => <label className="avx-rewrite-item" key={row.item_id}><span>{index + 1}/{prompts.length}</span><strong>{row.prompt.replace(/^\d+\.\s*/, '')}</strong>{!completed && !solutions && <input className="av-input" value={drafts[row.item_id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [row.item_id]: event.target.value }))} placeholder="Viết lại câu bằng từ/cấu trúc gợi ý" />}</label>)}</div>
    {!solutions && <button className="av-button av-button-primary avx-wide" type="button" disabled={busy || attempted.length < prompts.length} onClick={() => void reveal()}>{busy ? 'Đang mở đáp án…' : `Đối chiếu đáp án (${attempted.length}/${prompts.length})`}</button>}
    {solutions && <><details open><summary>Đáp án và phân tích tham khảo</summary><Blocks blocks={solutions} /></details><button className="av-button av-button-primary avx-wide" type="button" onClick={onContinue}>Tiếp tục sang Listening →</button></>}
  </div>;
}

function WritingStage({ activity }: { activity: Json }) {
  const [tab, setTab] = useState<'task_1' | 'task_2'>('task_1');
  const content = activity.content || {};
  const task = content.tasks?.[tab] || {};
  const illustration = (task.illustrations || []).find((value: string) => value?.endsWith('.svg')) || task.illustrations?.[0];
  return <div className="avx-reference-card">
    <div className="avx-boundary-note"><strong>Nội dung tham khảo — không phải nơi nộp bài</strong><p>Giáo viên cần giao một Writing assignment riêng thì bài viết mới được nộp và chấm.</p></div>
    <div className="avx-tabs" role="group" aria-label="Chọn Writing task"><button type="button" aria-pressed={tab === 'task_1'} className={tab === 'task_1' ? 'is-active' : ''} onClick={() => setTab('task_1')}>Writing Task 1</button><button type="button" aria-pressed={tab === 'task_2'} className={tab === 'task_2' ? 'is-active' : ''} onClick={() => setTab('task_2')}>Writing Task 2</button></div>
    <h3>{task.title || (tab === 'task_1' ? 'Task 1' : 'Task 2')}</h3>
    <Blocks blocks={task.prompt} />
    {illustration && <img className="avx-writing-chart" src={illustration} alt="Biểu đồ của đề Writing Task 1" />}
    <details open><summary>Phân tích đề</summary><BlockSections sections={task.prompt_analysis} /></details>
    <details open><summary>Ý tưởng để tham khảo</summary><BlockSections sections={tab === 'task_2' ? task.idea_sections : content.idea_map} /></details>
    <details><summary>Dàn bài gợi ý</summary><BlockSections sections={task.outline} /></details>
    {(task.model_answers || []).map((model: Json) => <details key={model.band}><summary>Bài tham khảo Band {model.band}</summary><Blocks blocks={model.blocks} /></details>)}
    {!!task.band_comparison?.length && <details><summary>Phân tích khác biệt Band 7 → 8</summary><Blocks blocks={task.band_comparison} /></details>}
  </div>;
}

function SpeakingStage({ activity }: { activity: Json }) {
  const blocks = activity.content?.blocks || [];
  const examples = buildSpeakingLadders(blocks) as Json[];
  return <div className="avx-reference-card">
    <div className="avx-boundary-note"><strong>Luyện nói riêng — không chấm mặc định</strong><p>Nói tự nhiên trước, sau đó đối chiếu cách nâng cấp. Band 8 là phần mở rộng, không phải điều kiện hoàn tất.</p></div>
    <ol className="avx-speaking-flow"><li>Chọn một tình huống</li><li>Nói bằng cách của bạn</li><li>Đối chiếu thang nâng cấp</li></ol>
    <div className="avx-ladders">{examples.map((example, index) => <article key={`${index}-${example.title}`}><h3>{example.title}</h3>{example.bands.map((row: Json) => <div className={`avx-band avx-band--${row.band.replace(/\D/g, '')}`} key={row.band}><strong>{row.band}</strong><p>{row.text}</p>{row.technique && <span>{row.technique}</span>}</div>)}</article>)}</div>
    <details className="avx-speaking-source"><summary>Cue card, model answer và nội dung luyện nói đầy đủ</summary><Blocks blocks={blocks} /></details>
  </div>;
}

export function AdvancedVocabularyLesson() {
  const [data, setData] = useState<Json | null>(null);
  const [stage, setStage] = useState<Stage>('vocabulary');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const bank = params.get('bank'); const item = params.get('item');
    if (!bank || !item) { setError('Liên kết bài học thiếu bank hoặc item.'); setPhase('error'); return; }
    try {
      const payload = await window.api.get<Json>(`/api/advanced-vocab/lessons/${encodeURIComponent(bank)}?item=${encodeURIComponent(item)}`);
      setData(payload);
      const done = new Set(payload.progress.completed_stages || []);
      setStage((STAGES.find((candidate) => !done.has(candidate.id) && !['writing', 'speaking'].includes(candidate.id))?.id || 'writing') as Stage);
      setPhase('ready');
    } catch (cause) { setError(errorText(cause)); setPhase('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: Json) => {
    try { setError(''); return await window.api.post<Json>(path, body); }
    catch (cause) { setError(errorText(cause)); throw cause; }
  };
  const completed = useMemo(() => new Set(data?.progress?.completed_stages || []), [data]);
  const isUnlocked = (id: Stage) => {
    if (id === 'vocabulary') return true;
    if (id === 'practice_1') return completed.has('vocabulary');
    if (id === 'practice_2') return completed.has('practice_1');
    if (id === 'reading') return completed.has('practice_2');
    if (id === 'controlled_rewrite') return completed.has('reading');
    if (id === 'listening') return completed.has('controlled_rewrite');
    return completed.has('listening');
  };
  const mergeProgress = (progress: Json) => setData((current) => current ? ({ ...current, progress }) : current);

  if (phase === 'loading') return <main id="aver-main-content" className="shell avx-shell"><div className="avx-state is-loading" role="status" aria-live="polite"><span aria-hidden="true" /> <p>Đang mở bài học…</p></div></main>;
  if (phase === 'error' || !data) return <main id="aver-main-content" className="shell avx-shell"><div className="avx-state"><h1>Chưa mở được bài học</h1><p>{error}</p><a className="av-button av-button-secondary" href="/my-class">Quay lại lớp học</a></div></main>;

  const base = { bank_id: data.bank.id, item_id: data.assignment.item_id };
  return <main id="aver-main-content" className="shell avx-shell">
    <header className="avx-hero"><div><p className="avx-eyebrow">{data.lesson.lesson_id} · Self-paced lesson</p><h1>{data.lesson.title}</h1><p>Hoàn tất từng hoạt động theo thứ tự. Reading và Listening được lưu riêng; không có điểm tổng mặc định.</p></div><a href="/my-class" className="av-button av-button-tertiary">← Lớp của tôi</a></header>
    <nav className="avx-stage-nav" aria-label="Các phần của bài học">{STAGES.map((item) => { const unlocked = isUnlocked(item.id); return <button key={item.id} type="button" aria-current={stage === item.id ? 'step' : undefined} className={`${stage === item.id ? 'is-active' : ''} ${completed.has(item.id) ? 'is-done' : ''}`} disabled={!unlocked} onClick={() => setStage(item.id)}><span>{completed.has(item.id) ? '✓' : item.short}</span><b>{item.label}</b></button>; })}</nav>
    {error && <div className="avx-inline-error" role="alert">{error}</div>}
    <div className="avx-section-head"><p>{STAGES.find((item) => item.id === stage)?.short}</p><div><span>Lesson stage</span><h2>{STAGES.find((item) => item.id === stage)?.label}</h2></div></div>
    {stage === 'vocabulary' && <VocabularyStage data={data} onDone={async (ids) => { const progress = await post('/api/advanced-vocab/vocabulary/complete', { ...base, seen_lexeme_ids: ids }); mergeProgress(progress); setStage('practice_1'); }} />}
    {stage === 'practice_1' && <PracticeStage stage="practice_1" data={data} onAnswer={async (qid, answer, response_time_ms) => { const response = await post('/api/advanced-vocab/practice/answer', { ...base, stage: 'practice_1', qid, answer, response_time_ms }); mergeProgress(response.progress); return response; }} onDone={() => setStage('practice_2')} />}
    {stage === 'practice_2' && <PracticeStage stage="practice_2" data={data} onAnswer={async (qid, answer, response_time_ms) => { const response = await post('/api/advanced-vocab/practice/answer', { ...base, stage: 'practice_2', qid, answer, response_time_ms }); mergeProgress(response.progress); return response; }} onDone={() => setStage('reading')} />}
    {stage === 'reading' && <ReadingStage content={data.lesson.activities.reading} completed={completed.has('reading')} saved={(data.progress.sections || []).find((row: Json) => row.section === 'reading')} onSubmit={async (answers, duration_sec) => { const response = await post('/api/advanced-vocab/reading', { ...base, answers, duration_sec }); setData((current) => current ? ({ ...current, progress: { ...current.progress, completed_stages: Array.from(new Set([...(current.progress.completed_stages || []), 'reading'])) } }) : current); return response; }} onContinue={() => setStage('controlled_rewrite')} />}
    {stage === 'controlled_rewrite' && <ControlledRewriteStage activity={data.lesson.activities.controlled_rewrite} completed={completed.has('controlled_rewrite')} onReveal={async (attempted_item_ids) => { const response = await post('/api/advanced-vocab/controlled-rewrite/complete', { ...base, attempted_item_ids }); mergeProgress(response.progress); return response; }} onContinue={() => setStage('listening')} />}
    {stage === 'listening' && <ListeningStage content={data.lesson.activities.listening} completed={completed.has('listening')} saved={(data.progress.sections || []).find((row: Json) => row.section === 'listening')} onSubmit={async (answers, duration_sec) => { const response = await post('/api/advanced-vocab/listening', { ...base, answers, duration_sec }); if (response.progress) mergeProgress(response.progress); return response; }} onRetry={async (answers) => { const response = await post('/api/advanced-vocab/listening/guided-retry', { ...base, answers }); if (response.progress) mergeProgress(response.progress); return response; }} onContinue={() => setStage('writing')} />}
    {stage === 'writing' && <WritingStage activity={data.lesson.activities.writing} />}
    {stage === 'speaking' && <SpeakingStage activity={data.lesson.activities.speaking} />}
  </main>;
}
