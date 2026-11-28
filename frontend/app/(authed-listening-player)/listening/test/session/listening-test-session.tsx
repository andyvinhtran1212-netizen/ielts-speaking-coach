'use client';

import { useListeningDrillPlayback } from '@/lib/listening-drill-playback';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { coreOperationRequest } from '@/lib/core-operation-intent.mjs';
import { noteTemplateTree } from '@/lib/note-template-tree.mjs';
import { examResultNextStepTitle, examResultOutcomes } from '@/lib/exam-result-outcomes.mjs';
import {
  createListeningSaveCoordinator,
  isPracticeListeningTest,
  listeningAudioPolicy,
  listeningSubmitOutcome,
  listeningAnswersFromRows,
  listeningDictationHref,
  listeningInlineTokens,
  listeningInstructionParts,
  listeningKeepChangeAnswer,
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
import { MockPostTestCapture } from '@/components/mock-post-test-capture';
import { useAttemptReviewFlags } from '@/lib/use-attempt-review-flags';
import { AttemptReviewFlagStatus } from '@/components/attempt-review-flag-status';
import { leaveForParent } from '@/lib/redirect-notice-model.mjs';
import { examRoomEnabled } from '@/lib/exam-room/flags.mjs';
import {
  clearForeignLocalCopies, clearLocalCopy, localCopyExpiry, planLocalCopyReplay, readLocalCopy,
  removeAckedFromCopy, writeLocalCopy,
} from '@/lib/exam-room/local-copy.mjs';
import type { ExamRoomSession } from '@/components/exam-room/types';
import { ListeningTestRoom, type ListeningRoomSubmit } from './listening-test-room';

type ListeningPhase = 'loading' | 'error' | 'prestart' | 'inprogress' | 'submitting' | 'capture' | 'results' | 'sealed';
type AnswerMap = Map<number, string>;
type SaveMap = Map<number, 'pending' | 'retrying' | 'failed'>;
type Attempt = { attempt_id: string; started_at: string; answers?: any[]; renderer_affinity?: 'legacy' | 'next' | null; attempt_purpose?: string | null; mock_sitting_id?: string | null };
type ListeningTest = any;

function withQuery(path: string, pairs: Array<[string, string | null]>) {
  const query = new URLSearchParams();
  for (const [key, value] of pairs) if (value) query.set(key, value);
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

// EXAMLISTENT-0070 FR-014: the on-device copy before "Sign in again".
function roomStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
const ROOM_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;
const ROOM_ABANDON_MESSAGES: Record<string, string> = {
  not_self_selected: 'This attempt belongs to an assignment or a test session and cannot be abandoned.',
  resume_expired: 'This attempt has expired and can no longer be changed.',
  attempt_changed: 'This attempt changed in another tab. Reload the page, then try again.',
};

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
  const items = (rows: any[]): ReactNode => <ul className="ielts-notes-list">{rows.map((item: any, index: number) => <li key={index}>
    {item?.q_num != null ? <GapWithNumber qNum={Number(item.q_num)} value={answers.get(Number(item.q_num)) || ''} onAnswer={onAnswer} prefix={item.prefix || ''} suffix={item.suffix || ''} /> : <InlineText text={String(item?.text || '')} />}
    {Array.isArray(item?.items) && item.items.length ? items(item.items) : null}
  </li>)}</ul>;
  return <div className="ielts-notes-container">
    {template?.heading ? <div className="ielts-notes-heading"><InlineText text={template.heading} /></div> : null}
    {groups.map((group: any, index: number) => {
      const headingSegments = Array.isArray(group.heading_segments) && group.heading_segments.length ? group.heading_segments : null;
      return <div className="ielts-notes-group" key={index}>
      {headingSegments || group.heading ? <div className="ielts-notes-group-heading">
        {headingSegments ? headingSegments.map((segment: any, part: number) => <Fragment key={part}>{part ? ' ' : null}<Segment segment={segment} answers={answers} onAnswer={onAnswer} /></Fragment>) : <InlineText text={group.heading} />}
      </div> : null}
      {items(noteTemplateTree(group.items || []))}
    </div>; })}
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
  const authoredHeading = typeof payload?.template?.heading === 'string' ? payload.template.heading.trim() : '';
  const first = Number(questions[0]?.q_num || 0);
  const last = Number(questions.at(-1)?.q_num || first);
  const imageAlt = authoredHeading || `Map or plan for questions ${first}${first === last ? '' : ` to ${last}`}`;
  return <div className={plan ? 'ielts-plan-container' : 'ielts-matching'}>
    {plan ? <div className="ielts-plan-image">{image ? <img className="ielts-map-rendered" src={image} alt={imageAlt} /> : <p className="ielts-notice">The map for this exercise is unavailable.</p>}</div> : null}
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

function FlowChartTemplate({ payload, answers, onAnswer }: {
  payload: any; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  const template = payload.template;
  const bank = Array.isArray(payload?.metadata?.match_options) ? payload.metadata.match_options : [];
  const letters = bank.map(optionValue);
  return <div className="listening-next-flow-chart">
    {bank.length ? <aside className="listening-next-match-bank" aria-label="Flow chart options"><strong>Options</strong><ul>{bank.map((option: any) => <li key={optionValue(option)}><b>{optionValue(option)}</b> <InlineText text={optionText(option)} /></li>)}</ul></aside> : null}
    {template.heading ? <h3><InlineText text={template.heading} /></h3> : null}
    <ol className="listening-next-flow-steps" aria-label="Flow chart stages">{template.steps.map((step: any, index: number) => {
      const qNum = Number(step.q_num);
      return <li key={qNum || index}>
        {step.q_num != null ? <div className="listening-next-flow-step" id={`q-${qNum}`}>
          <span className="ielts-question-num">{qNum}</span>
          <InlineText text={step.prefix || ''} />
          {bank.length ? <select className="ft-q-input ielts-gap-input" data-q-num={qNum} aria-label={`Answer ${qNum}`} value={answers.get(qNum) || ''} onChange={(event) => onAnswer(qNum, event.target.value)}>
            <option value="">—</option>{letters.map((letter: string) => <option key={letter} value={letter}>{letter}</option>)}
          </select> : <GapInput qNum={qNum} value={answers.get(qNum) || ''} onAnswer={onAnswer} />}
          <InlineText text={step.suffix || ''} />
        </div> : <div className="listening-next-flow-step"><InlineText text={step.text || ''} /></div>}
        {index < template.steps.length - 1 ? <span className="listening-next-flow-arrow" aria-hidden="true">↓</span> : null}
      </li>;
    })}</ol>
  </div>;
}

function KeepChangeTemplate({ questions, answers, onAnswer }: {
  questions: any[]; answers: AnswerMap; onAnswer(q: number, v: string): void;
}) {
  return <div className="listening-keep-change">{questions.map((question) => {
    const qNum = Number(question.q_num);
    const answer = listeningKeepChangeAnswer(answers.get(qNum));
    return <fieldset key={qNum} id={`q-${qNum}`} data-q-num={qNum}>
      <legend><span className="ielts-question-num">{qNum}</span> <InlineText text={question.printed_value ?? question.prompt} /></legend>
      <div className="listening-keep-change-choices">{['KEEP', 'CHANGE'].map((choice) => <label key={choice}>
        <input type="radio" name={`keep-change-${qNum}`} value={choice} checked={answer.choice === choice}
          aria-label={`${choice} — Question ${qNum}`}
          onChange={() => onAnswer(qNum, choice === 'KEEP' ? 'KEEP' : 'CHANGE: ')} /> {choice}
      </label>)}</div>
      <label htmlFor={`keep-change-text-${qNum}`}>Corrected value — Question {qNum}</label>
      <input type="text" id={`keep-change-text-${qNum}`} className="ft-q-input" data-q-num={qNum}
        autoComplete="off" spellCheck={false} disabled={answer.choice !== 'CHANGE'} required={answer.choice === 'CHANGE'}
        value={answer.text} onChange={(event) => onAnswer(qNum, `CHANGE: ${event.target.value}`)} />
    </fieldset>;
  })}</div>;
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
  if (kind === 'keep_change') content = <KeepChangeTemplate questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'form_completion' && Array.isArray(template.rows)) content = <FormTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'table_completion' && Array.isArray(template.rows)) content = <TableTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'notes_completion' && Array.isArray(template.groups)) content = <NotesTemplate template={template} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'summary_completion') content = <SummaryTemplate template={template} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'sentence_completion') content = <SentenceTemplate template={template} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'flow_chart_completion' && payload.metadata?.flow_direction === 'top_to_bottom' && Array.isArray(template.steps) && template.steps.length) content = <FlowChartTemplate payload={payload} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'mcq_3option') content = <McqTemplate questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'mcq_multi') content = <MultiSelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (kind === 'matching') content = <MatchingMatrixTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} />;
  else if (['mcq_letter_label', 'plan_label'].includes(kind)) content = <SelectTemplate payload={payload} questions={questions} answers={answers} onAnswer={onAnswer} plan />;
  else content = <QuestionRows questions={questions} answers={answers} onAnswer={onAnswer} />;
  const affected = questions.map((question: any) => Number(question.q_num)).filter((qNum: number) => saveStates.has(qNum));
  const supportingVisual = !['mcq_letter_label', 'plan_label'].includes(kind)
    ? String(payload.map_image_url || '')
    : '';
  const supportingVisualAlt = kind === 'flow_chart_completion'
    ? `Flow chart for questions ${first}${first === last ? '' : ` to ${last}`}`
    : `Visual for questions ${first}${first === last ? '' : ` to ${last}`}`;
  const instructionParts = listeningInstructionParts(payload.instruction || payload.instructions);
  return <section className="ielts-question-block" data-template-kind={kind}>
    {questions.length ? <div className="ielts-block-header">{first === last ? `Question ${first}` : `Questions ${first}–${last}`}</div> : null}
    {instructionParts.length ? <div className="ielts-instruction">{instructionParts.map((part: any, index: number) => <p className={part.role ? `is-${part.role}` : undefined} key={index}><InlineText text={part.text} /></p>)}</div> : null}
    {supportingVisual ? <figure className="listening-next-supporting-visual"><img className="ielts-map-rendered" src={supportingVisual} alt={supportingVisualAlt} /></figure> : null}
    {content}
    {affected.length ? <small className="listening-next-exercise-save" role="status">Questions {affected.join(', ')} have not finished saving.</small> : null}
  </section>;
}

export function ResultView({ result, attempt, test, from, sittingId, classItem }: {
  result: any; attempt: Attempt | null; test: ListeningTest; from: string | null; sittingId: string | null; classItem?: string | null;
}) {
  const drill = classItem ? test.skill_drill_homework : null;
  const drillDictationHref = drill?.sections?.length
    ? listeningDictationHref(test.id, classItem) : null;
  const rows = Array.isArray(result?.per_question) ? result.per_question : [];
  const scoredRows = rows.filter((row: any) => !row.self_check);
  const maxScore = Number(result?.max_score ?? scoredRows.length);
  const score = Number.isFinite(Number(result?.score)) ? Number(result.score) : rows.filter((row: any) => row.correct).length;
  const selfCheckCount = Number(result?.self_check_count ?? rows.filter((row: any) => row.self_check).length);
  const selfCheckOnly = result?.score_mode === 'self_check_only' || (rows.length > 0 && maxScore === 0);
  const mixed = result?.score_mode === 'mixed' || (maxScore > 0 && selfCheckCount > 0);
  const bandLabel = selfCheckOnly ? 'Không chấm điểm' : mixed ? `Không quy đổi band · ${selfCheckCount} câu tự đối chiếu` : maxScore !== 40 ? 'Không quy đổi band' : result?.band_estimate == null ? '<4.0' : Number(result.band_estimate).toFixed(1);
  const outcomes = examResultOutcomes(scoredRows);
  const accuracy = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const fullTest = !isPracticeListeningTest(test) && maxScore === 40;
  const textBandLabel = selfCheckOnly || mixed || maxScore !== 40;
  const sections = Object.entries(result?.section_breakdown || {}).filter(([, value]: [string, any]) => Number(value?.total || 0) > 0);
  return <main className="exam-result-shell listening-next-result">
    <section className="exam-result-page" aria-labelledby="listening-result-title">
      <header className="exam-result-heading"><div><p className="exam-result-eyebrow">{fullTest ? 'LISTENING · FULL TEST COMPLETE' : 'LISTENING · TEST COMPLETE'}</p><h1 id="listening-result-title">Test results</h1><p>{test.title}</p></div><span className="exam-result-status">{drill?.dictation_required ? "Đã nộp phần nghe · Còn chép chính tả" : "Submitted"}</span></header>

      <section className="exam-result-hero" aria-label="Results overview">
        <div className="exam-result-band"><span>Estimated band</span><strong className={textBandLabel ? 'listening-next-band-label' : undefined}>{bandLabel}</strong><small>Practice result</small></div>
        {selfCheckOnly ? <p>Đã hoàn thành · {selfCheckCount} câu tự đối chiếu</p> : <div className="exam-result-metrics">
          <div><span>Correct</span><strong>{score}<small>/{maxScore}</small></strong></div>
          <div><span>Accuracy</span><strong>{maxScore === 0 ? '—' : <>{accuracy}<small>%</small></>}</strong></div>
          <div><span>Incorrect</span><strong>{outcomes.incorrect}</strong></div>
          <div><span>Unanswered</span><strong>{outcomes.unanswered}</strong></div>
        </div>}
      </section>

      {!selfCheckOnly && sections.length ? <section className="exam-result-parts" aria-labelledby="listening-result-parts"><div className="exam-result-section-heading"><div><p>SECTION BREAKDOWN</p><h2 id="listening-result-parts">Results by part</h2></div></div><div className="exam-result-part-grid">{sections.map(([key, value]: [string, any], index) => {
        const total = Number(value?.total || 0);
        const correct = Number(value?.correct || 0);
        const sectionNumber = Number(String(key).match(/\d+/)?.[0]) || index + 1;
        return <div className="exam-result-part" key={key}><div><span>Part {sectionNumber}</span><strong>{correct}/{total}</strong></div><div className="exam-result-progress" aria-label={`Part ${sectionNumber}: ${correct} correct out of ${total}`}><span style={{ width: `${total ? Math.round((correct / total) * 100) : 0}%` }} /></div></div>;
      })}</div></section> : null}

      <section className="exam-result-review-card" aria-labelledby="listening-result-review-title"><div className="exam-result-section-heading"><div><p>QUESTION MAP</p><h2 id="listening-result-review-title">Overview of {rows.length} questions</h2></div>{!selfCheckOnly && <div className="exam-result-legend" aria-label="Legend"><span className="is-correct" />Correct <span className="is-wrong" />Incorrect <span className="is-empty" />Unanswered</div>}</div><div className="exam-result-question-map">{rows.map((row: any) => {
        if (row.self_check) return <span aria-label={`Question ${row.q_num}: Tự đối chiếu`} key={row.q_num}>{row.q_num}</span>;
        const empty = !String(row.user_answer ?? '').trim();
        return <span className={empty ? 'is-empty' : row.correct ? 'is-correct' : 'is-wrong'} aria-label={`Question ${row.q_num}: ${empty ? 'unanswered' : row.correct ? 'correct' : 'incorrect'}`} key={row.q_num}>{row.q_num}</span>;
      })}</div></section>

      <section className="exam-result-next-step"><div><p className="exam-result-eyebrow">NEXT STEP</p><h2>{selfCheckOnly ? 'Đối chiếu đáp án' : examResultNextStepTitle(outcomes, 'Review the transcript and explanations')}</h2><p>Replay the relevant audio and compare the transcript and explanations for each question.</p></div><div className="exam-result-actions">{attempt ? <a className="ft-control-btn" href={listeningReviewHref(attempt.attempt_id, from)}>{selfCheckOnly ? 'Đối chiếu đáp án' : 'Review answers'} <span aria-hidden="true">→</span></a> : null}{drillDictationHref ? <a className="ft-control-btn" href={drillDictationHref}>{drill.dictation_required ? 'Làm phần chép chính tả bắt buộc' : 'Chép chính tả (tùy chọn)'}</a> : !classItem && !drill && <a className="ft-control-btn ghost" href={listeningDictationHref(test.id)}>Dictation practice</a>}<a className="ft-control-btn ghost" href={listeningLibraryHref(from, sittingId)}>Back to tests</a></div></section>
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
  const [admissionRequired, setAdmissionRequired] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>(() => new Map());
  const answersRef = useRef<AnswerMap>(answers);
  const [saveStates, setSaveStates] = useState<SaveMap>(() => new Map());
  const [activeSection, setActiveSection] = useState(1);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [previewFlags, setPreviewFlags] = useState<Set<number>>(() => new Set());
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
  // EXAMLISTENT-0070 FR-001: read once with the link; flag off keeps every
  // request and the DOM of the existing player.
  const [examRoom, setExamRoom] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [roomSession, setRoomSession] = useState<ExamRoomSession>('active');
  const [roomSubmit, setRoomSubmit] = useState<{ outcome: ListeningRoomSubmit['outcome']; message: string | null }>({ outcome: 'idle', message: null });
  const [roomNotice, setRoomNotice] = useState('');
  const ackedRef = useRef<Map<number, string>>(new Map());
  const replayRef = useRef<Array<{ q: string; value: string; server: string }>>([]);
  const ackedForRef = useRef<string | null>(null);
  const canWriteRef = useRef(true);
  const roomRetryRef = useRef<{ timer?: ReturnType<typeof setTimeout>; online?: () => void }>({});
  const drillPlayback = useListeningDrillPlayback(
    testData?.skill_drill_homework ? attempt?.attempt_id : undefined,
    'listening', ['inprogress', 'submitting'].includes(phase), () => audioRef.current,
    `${testData?.audio_url || ''}:${audioReloadKey}`,
  );
  const coordinatorRef = useRef<any>(null);
  const collectionFrozenRef = useRef(false);
  const bootKeyRef = useRef<string | null>(null);
  const autoEnteredMockRef = useRef(false);
  const audioDialogRef = useRef<HTMLElement>(null);
  const audioPlayRef = useRef<HTMLButtonElement>(null);
  const submitDialogRef = useRef<HTMLElement>(null);
  const submitCancelRef = useRef<HTMLButtonElement>(null);

  useDialogFocus({ open: audioPromptOpen && !examRoom, busy: true, onClose: () => {}, dialogRef: audioDialogRef, initialFocusRef: audioPlayRef });
  useDialogFocus({ open: submitOpen && !examRoom, busy: phase === 'submitting', onClose: () => setSubmitOpen(false), dialogRef: submitDialogRef, initialFocusRef: submitCancelRef });

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => {
    try { setExamRoom(examRoomEnabled('listening')); setParams(listeningTestParams(window.location.search)); }
    // G02-T11: no valid test in the link → back to Listening with a notice.
    catch { leaveForParent('/listening'); }
  }, []);

  const flagApi = useAttemptReviewFlags({
    attemptId: attempt?.attempt_id, domain: 'listening', ownerScope: user?.id || '',
    enabled: !!attempt && status === 'signed-in' && !['results', 'sealed', 'capture'].includes(phase),
  });
  const reviewQuestions = params?.adminPreview ? previewFlags : flagApi.flagged;
  const toggleFlag = useCallback((qNum: number) => {
    if (collectionFrozenRef.current || phase !== 'inprogress') return;
    if (params?.adminPreview) setPreviewFlags((previous) => {
      const next = new Set(previous);
      if (next.has(qNum)) next.delete(qNum); else next.add(qNum);
      return next;
    });
    else flagApi.toggle(qNum);
  }, [flagApi.toggle, params?.adminPreview, phase]);

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
    if (!['legacy', 'next'].includes(canonical)) throw new Error('This attempt cannot be displayed.');
    if (canonical !== 'next') {
      window.location.replace(listeningRendererHref(canonical, window.location.search));
      return null;
    }
    return canonical as 'next';
  }, []);

  const boot = useCallback(async () => {
    if (!params) return;
    const ready = await whenGlobalReady(() => !!window.api?.get, 'window.api (Listening test)');
    if (!ready) throw new Error('Unable to connect. Please try again.');
    const [testPayload, resumePayload] = params.adminPreview
      ? [await window.api.get(`/admin/listening/tests/${encodeURIComponent(params.testId)}/player-preview`), null]
      : await Promise.all([
        window.api.get(withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}`, [
          ['class_item', params.classItem], ['sitting_id', params.sittingId],
        ])),
        window.api.get(resumePath(params)),
      ]);
    const normalizedTest = normalizeListeningTest(testPayload);
    const normalizedAttempt = normalizeListeningResume(resumePayload);
    const firstSection = Number(normalizedTest.sections[0]?.section_num || 1);
    const firstQuestion = Number(listeningQuestions(normalizedTest)[0]?.question?.q_num || 0);
    setTestData(normalizedTest);
    setActiveSection(firstSection);
    setCurrentQuestion(firstQuestion || null);
    if (params.adminPreview) {
      answersRef.current = new Map(); setAnswers(new Map()); setAttempt(null); setResumeAvailable(false);
      setAudioPromptOpen(!isPracticeListeningTest(normalizedTest));
      setPhase('inprogress');
      return;
    }
    if (normalizedAttempt) {
      const affinity = await claimNextRenderer(normalizedAttempt.attempt_id);
      if (!affinity) return;
      const ownedAttempt = { ...normalizedAttempt, renderer_affinity: affinity };
      const restored = listeningAnswersFromRows(ownedAttempt.answers);
      replayRef.current = [];
      if (examRoom && user?.id) {
        // FR-014: re-send an answer from the on-device copy only while the server
        // still holds the value it last acked for it (compared by value).
        const storage = roomStorage();
        clearForeignLocalCopies(storage, user.id);
        const scope = { surface: 'listening', ownerKey: user.id, attemptKey: ownedAttempt.attempt_id };
        const plan = planLocalCopyReplay(readLocalCopy(storage, scope), {
          open: true, answers: Object.fromEntries([...restored].map(([q, value]) => [String(q), { value }])),
        });
        if (plan.drop.length) removeAckedFromCopy(storage, { ...scope, entries: plan.drop });
        // Listening answers are strings; anything else in a copy is not ours to send.
        const resend = plan.resend.filter((entry) => typeof entry.value === 'string') as Array<{ q: string; value: string }>;
        replayRef.current = resend.map(({ q, value }) => ({ q, value, server: restored.get(Number(q)) || '' }));
        for (const { q, value } of resend) { if (value) restored.set(Number(q), value); else restored.delete(Number(q)); }
      }
      answersRef.current = restored;
      setAnswers(new Map(restored));
      setAttempt(ownedAttempt);
      setResumeAvailable(true);
    } else {
      answersRef.current = new Map(); setAnswers(new Map()); setAttempt(null); setResumeAvailable(false);
    }
    setAdmissionRequired(false);
    setPhase('prestart');
  }, [claimNextRenderer, examRoom, params, resumePath, user?.id]);

  const bootWithRecovery = useCallback(async () => {
    setPhase('loading'); setError('');
    try { await boot(); }
    catch (caught: any) {
      if (caught?.status === 409 && caught?.detail?.reason === 'admission_required') {
        setTestData(null); setAttempt(null); setResumeAvailable(false); setAdmissionRequired(true); setPhase('prestart'); return;
      }
      setError("Unable to load the Listening test. Check your connection and try again."); setPhase('error');
    }
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

  const saveAnswer = useCallback(async (qNum: number, value: string, options: { keepalive?: boolean; signal?: AbortSignal }) => {
    if (!attempt) return null;
    const path = `/api/listening/tests/attempts/${encodeURIComponent(attempt.attempt_id)}/answers`;
    const body = { q_num: qNum, user_answer: value };
    return coreOperationRequest({
      accountId: user?.id, method: 'PATCH', path, input: body, slot: String(qNum),
      acknowledged: (reply: any) => reply?.attempt_id === attempt.attempt_id,
    }, (headers: Record<string, string>) => window.api.patchWith(
      path, body, headers, { keepalive: !!options.keepalive, signal: options.signal, noRedirect: true },
    ));
  }, [attempt, user?.id]);

  // EXAMLISTENT-0070 FR-009/FR-014 (flag on only): the same save; its ack
  // branch records the acked value and "Saved at", a 401 opens "Sign in again".
  const saveAnswerInRoom = useCallback((qNum: number, value: string, options: { keepalive?: boolean; signal?: AbortSignal }) => {
    const request = saveAnswer(qNum, value, options);
    if (!request || !attempt) return request;
    return request.then((reply: any) => {
      if (value) ackedRef.current.set(qNum, value); else ackedRef.current.delete(qNum);
      setLastSavedAt(new Date());
      if (user?.id) removeAckedFromCopy(roomStorage(), { surface: 'listening', ownerKey: user.id, attemptKey: attempt.attempt_id, entries: [{ q: qNum, value }] });
      return reply;
    }, (caught: any) => {
      if (caught?.status === 401) setRoomSession('expired');
      throw caught;
    });
  }, [attempt, saveAnswer, user?.id]);

  useEffect(() => {
    coordinatorRef.current?.dispose?.();
    if (!attempt || phase === 'results' || phase === 'sealed') return undefined;
    const coordinator = createListeningSaveCoordinator({ save: examRoom ? saveAnswerInRoom : saveAnswer });
    coordinator.seed(answersRef.current);
    if (examRoom && ackedForRef.current !== attempt.attempt_id) {
      // FR-014 `baseValue`: what the server holds for this attempt right now.
      ackedForRef.current = attempt.attempt_id;
      const acked = new Map(answersRef.current);
      for (const { q, server } of replayRef.current) { if (server) acked.set(Number(q), server); else acked.delete(Number(q)); }
      ackedRef.current = acked;
      for (const { q, value } of replayRef.current) coordinator.update(Number(q), value);
      replayRef.current = [];
    }
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
  }, [attempt?.attempt_id, phase === 'results' || phase === 'sealed', saveAnswer, examRoom, saveAnswerInRoom]);

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

  const attachMockAttempt = useCallback(async (attemptId: string) => {
    if (!params?.sittingId) return;
    // The route-script bridge and React hydrate independently.  Do not expose
    // an attempt until the mock binding exists: otherwise autosaves succeed in
    // the domain table while the sitting is later collected as a blank paper.
    const hookReady = await whenGlobalReady(
      () => typeof (window as any).MockHook?.attach === 'function',
      'window.MockHook.attach (Listening mock)',
    );
    if (!hookReady) throw new Error('Unable to connect Listening to your test session.');
    await (window as any).MockHook.attach('listening', attemptId);
  }, [params?.sittingId]);

  const enterAttempt = useCallback(async (nextAttempt: Attempt, restored: AnswerMap, attach = true, nextTest = testData) => {
    if (nextAttempt.attempt_purpose === 'mock_delivery') {
      if (!nextAttempt.mock_sitting_id || (params?.sittingId && nextAttempt.mock_sitting_id !== params.sittingId)) throw new Error('Unable to confirm your Listening test session.');
    } else if (attach) await attachMockAttempt(nextAttempt.attempt_id);
    const offset = await resolveAudioOffset(nextAttempt, nextTest);
    answersRef.current = restored;
    setAnswers(new Map(restored)); setAttempt(nextAttempt); setResumeAvailable(false);
    setResumeOffset(Number.isFinite(offset) ? Math.max(0, Number(offset)) : null);
    const firstQuestion = Number(listeningQuestions(nextTest)[0]?.question?.q_num || 0);
    setCurrentQuestion(firstQuestion || null);
    // Embedded mock sections still need an explicit user gesture before a
    // browser may start media. Suppressing this prompt leaves full-test audio
    // with no first-play control because the parent runner cannot call play()
    // inside the iframe on the learner's behalf.
    setAudioPromptOpen(!!nextTest && !isPracticeListeningTest(nextTest));
    setPhase('inprogress');
  }, [attachMockAttempt, params?.sittingId, resolveAudioOffset, testData]);

  const resume = useCallback(() => {
    if (!attempt) return;
    void enterAttempt(attempt, answersRef.current).catch((caught: any) => {
      setError("Unable to resume the Listening test. Check your connection and try again."); setPhase('error');
    });
  }, [attempt, enterAttempt]);

  const startFresh = useCallback(async () => {
    if (!params) return;
    setPhase('loading');
    try {
      const path = withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}/attempts`, [['class_item', params.classItem]]);
      const body = { renderer_affinity_protocol: 'claim-v1', purpose: params.sittingId || admissionRequired ? 'mock_delivery' : params.classItem ? 'assigned_practice' : 'practice', ...(params.sittingId ? { mock_sitting_id: params.sittingId } : {}) };
      const started: any = await coreOperationRequest({
        accountId: user?.id, method: 'POST', path, input: body, fresh: resumeAvailable,
        acknowledged: (reply: any) => typeof reply?.attempt_id === 'string' && !!reply.attempt_id,
      }, (headers: Record<string, string>) => window.api.postWith(path, body, headers));
      const affinity = await claimNextRenderer(String(started.attempt_id));
      if (!affinity) return;
      const [resumePayload, testPayload] = await Promise.all([
        window.api.get(resumePath(params)),
        window.api.get(withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}`, [['class_item', params.classItem], ['sitting_id', params.sittingId]])),
      ]);
      const canonical = normalizeListeningResume(resumePayload);
      if (!canonical || canonical.attempt_id !== String(started.attempt_id)) throw new Error('Unable to confirm the new attempt.');
      const confirmedTest = normalizeListeningTest(testPayload);
      setTestData(confirmedTest); setAdmissionRequired(false);
      const ownedAttempt = { ...canonical, renderer_affinity: affinity };
      await enterAttempt(ownedAttempt, listeningAnswersFromRows(canonical.answers), true, confirmedTest);
    } catch (caught: any) { setError("Unable to start the Listening test. Check your connection and try again."); setPhase('error'); }
  }, [admissionRequired, claimNextRenderer, enterAttempt, params, resumePath, resumeAvailable, user?.id]);

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
    const [clean] = await Promise.all([coordinatorRef.current?.flush?.(), flagApi.flush()]);
    if (!clean) {
      setPhase('inprogress');
      setSubmitBlocked('Some answers have not been saved. Check your connection, select “Retry”, then submit again to avoid losing answers.');
      return;
    }
    try {
      if (testData?.skill_drill_homework) {
        audioRef.current?.pause();
        await drillPlayback.current().catch(() => {});
      }
      const path = `/api/listening/tests/attempts/${encodeURIComponent(attempt.attempt_id)}/submit`;
      // This endpoint reads saved answers and has no body. Include the local
      // answer snapshot in the hint identity so edited work is not a retry of
      // the earlier submit. The server still verifies canonical ownership/input.
      const response = await coreOperationRequest({
        accountId: user?.id, method: 'POST', path,
        input: [...answersRef.current].sort(([a], [b]) => a - b),
        acknowledged: (reply: any) => reply?.attempt_id === attempt.attempt_id || (reply?.received === true && reply?.sealed === true),
      }, (headers: Record<string, string>) => window.api.postWith(path, {}, headers));
      audioRef.current?.pause();
      const hook = (window as any).MockHook;
      if (hook?.isSealedResponse?.(response)) {
        setPhase('sealed');
        if (!params?.mockEmbed) hook.showSealedAndReturn('listening');
        return;
      }
      if (response?.post_test_capture_required) {
        setResult(response); setPhase('capture'); return;
      }
      setResult(response); setPhase('results');
    } catch (caught: any) { setError("Unable to submit Listening answers. Check your connection and try again."); setPhase('error'); }
  }, [attempt, drillPlayback, flagApi.flush, params?.mockEmbed, phase, testData?.skill_drill_homework, user?.id]);

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
        ? 'Audio could not start. Reload the audio and select Play. The test timer continues.'
        : 'You are offline and audio could not start. Keep this tab open; audio will reload when the connection returns.');
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
    if (!params || (!attempt && !params.adminPreview) || audioRetrying) return;
    const mediaOffset = Number(audioRef.current?.currentTime);
    setAudioRetrying(true);
    try {
      const refreshed = normalizeListeningTest(await window.api.get(params.adminPreview
        ? `/admin/listening/tests/${encodeURIComponent(params.testId)}/player-preview`
        : withQuery(`/api/listening/tests/${encodeURIComponent(params.testId)}`, [
          ['class_item', params.classItem],
        ])));
      const offset = params.adminPreview ? 0 : params.sittingId || !Number.isFinite(mediaOffset)
        ? await resolveAudioOffset(attempt!, refreshed)
        : Math.max(0, mediaOffset);
      audioRef.current?.pause();
      setPlaying(false);
      setPlaybackStarted(false);
      setAudioEnded(false);
      setResumeOffset(Number.isFinite(offset) ? Math.max(0, Number(offset)) : null);
      setTestData(refreshed);
      setAudioReloadKey((value) => value + 1);
      setAudioError('');
      setAudioPromptOpen(!isPracticeListeningTest(refreshed));
    } catch (caught: any) {
      setAudioError('Unable to reload audio. Check your connection and try again.');
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
  const unsavedRetrying = [...saveStates.values()].filter((state) => state === 'retrying').length;
  const unsavedPending = [...saveStates.values()].filter((state) => state === 'pending').length;
  const backHref = params?.adminPreview ? '/admin/mock-exams#test-library' : listeningLibraryHref(params?.from, params?.sittingId);

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
    const active = document.querySelector<HTMLElement>('.listening-next-palette [aria-current="step"]');
    const strip = active?.parentElement;
    if (!active || !strip) return;
    const button = active.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    if (button.left < viewport.left + 4) strip.scrollLeft -= viewport.left + 4 - button.left;
    else if (button.right > viewport.right - 4) strip.scrollLeft += button.right - viewport.right + 4;
  }, [currentQuestion, activeSection, phase]);

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

  // ---- EXAMLISTENT-0070 exam room (flag on only) ------------------------
  const roomScope = useMemo(() => (attempt && user?.id
    ? { surface: 'listening', ownerKey: user.id, attemptKey: attempt.attempt_id } : null), [attempt, user?.id]);
  const clearRoomRetry = useCallback(() => {
    const pending = roomRetryRef.current;
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.online) window.removeEventListener('online', pending.online);
    roomRetryRef.current = {};
  }, []);
  const submitGeneration = useRef(0);
  useLayoutEffect(() => () => {
    submitGeneration.current += 1;
    clearRoomRetry();
  }, [attempt?.attempt_id, user?.id, status, clearRoomRetry]);

  const finishRoomSubmit = useCallback((response: any, sealed = false) => {
    audioRef.current?.pause();
    if (roomScope) clearLocalCopy(roomStorage(), roomScope);
    const hook = (window as any).MockHook;
    if (sealed) {
      setPhase('sealed');
      if (!params?.mockEmbed) hook?.showSealedAndReturn?.('listening');
      return;
    }
    if (response?.post_test_capture_required) { setResult(response); setPhase('capture'); return; }
    if (response && typeof response === 'object' && response.attempt_id) { setResult(response); setPhase('results'); return; }
    // Confirmed by the re-read only: the result lives on the review page.
    if (attempt) window.location.assign(listeningReviewHref(attempt.attempt_id, params?.from || null));
  }, [attempt, params?.from, params?.mockEmbed, roomScope]);

  // FR-010: one submit, then the re-read and the automatic retries the pure
  // `listeningSubmitOutcome` asks for; never the full-page error.
  const runRoomSubmit = useCallback(async (autoRetries: number): Promise<void> => {
    if (!attempt) return;
    clearRoomRetry();
    const generation = submitGeneration.current;
    const sittingId = attempt.mock_sitting_id || params?.sittingId;
    const id = encodeURIComponent(attempt.attempt_id);
    const path = `/api/listening/tests/attempts/${id}/submit`;
    setRoomSubmit({ outcome: 'submitting', message: null });
    let reply: any = null;
    let error: any = null;
    try {
      reply = await coreOperationRequest({
        accountId: user?.id, method: 'POST', path,
        input: [...answersRef.current].sort(([a], [b]) => a - b),
        acknowledged: (r: any) => listeningSubmitOutcome({ attemptId: attempt.attempt_id, sittingId, reply: r }).next === 'results',
      }, (headers: Record<string, string>) => window.api.postWith(path, {}, headers, { noRedirect: true }));
    } catch (caught) { error = caught; }
    if (generation !== submitGeneration.current) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    let state = listeningSubmitOutcome({ attemptId: attempt.attempt_id, sittingId, reply, error, autoRetries, online });
    const reread = async () => {
      try { return await window.api.getWith<any>(`/api/listening/tests/attempts/${id}`, {}, { noRedirect: true }); }
      catch (caught: any) {
        if (caught?.status === 401) { setRoomSession('expired'); return { status: 'unknown', signin: true }; }
        return { status: 'unknown' };
      }
    };
    if (state.next === 'reread') state = listeningSubmitOutcome({ attemptId: attempt.attempt_id, sittingId, reply, error, autoRetries, online, reread: await reread() });
    if (generation !== submitGeneration.current) return;
    if (error?.status === 401) setRoomSession('expired');
    if (state.next === 'results') { setRoomSubmit({ outcome: 'confirmed', message: null }); finishRoomSubmit(reply, state.sealed); return; }
    if (state.next === 'resubmit') { setRoomSubmit({ outcome: 'idle', message: null }); setPhase('inprogress'); return; }
    if (state.next === 'back') {
      audioRef.current?.pause();
      if (state.clearLocalCopy && roomScope) clearLocalCopy(roomStorage(), roomScope);
      setRoomSubmit({ outcome: state.outcome as ListeningRoomSubmit['outcome'], message: state.message });
      return;
    }
    setRoomSubmit({ outcome: state.outcome as ListeningRoomSubmit['outcome'], message: state.message });
    if (state.next !== 'retry') return;
    // `used` counts the automatic tries spent so far; each scheduled check
    // re-reads the attempt first.
    const schedule = (used: number, waitFor: string | null) => {
      const again = async () => {
        if (generation !== submitGeneration.current) return;
        clearRoomRetry();
        // A sealed mock rejects result reads even after a successful submit.
        // Replay the same POST so the server returns its opaque receipt.
        if (sittingId) { void runRoomSubmit(used + 1); return; }
        const truth: any = await reread();
        if (generation !== submitGeneration.current) return;
        if (truth?.status === 'in_progress') { void runRoomSubmit(used + 1); return; }
        const nowOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
        const checked = listeningSubmitOutcome({ attemptId: attempt.attempt_id, reply: null, error: { status: 409 }, autoRetries: used + 1, online: nowOnline, reread: truth });
        if (checked.next === 'retry') {
          // The re-read failed (CR #2557 F4): try again while the budget lasts.
          setRoomSubmit({ outcome: checked.outcome as ListeningRoomSubmit['outcome'], message: null });
          schedule(used + 1, checked.waitFor);
          return;
        }
        if (checked.next === 'results') { setRoomSubmit({ outcome: 'confirmed', message: null }); finishRoomSubmit(null); return; }
        if (checked.next === 'back') {
          if (checked.clearLocalCopy && roomScope) clearLocalCopy(roomStorage(), roomScope);
          setRoomSubmit({ outcome: checked.outcome as ListeningRoomSubmit['outcome'], message: checked.message });
          return;
        }
        setRoomSubmit({ outcome: 'unconfirmed_manual', message: null });
      };
      if (waitFor === 'online') {
        const onOnline = () => { void again(); };
        roomRetryRef.current = { online: onOnline };
        window.addEventListener('online', onOnline, { once: true });
      } else {
        roomRetryRef.current = { timer: setTimeout(() => { void again(); }, 2000 * (used + 1)) };
      }
    };
    schedule(autoRetries, state.waitFor);
  }, [attempt, clearRoomRetry, finishRoomSubmit, params?.sittingId, roomScope, user?.id]);

  const submitRoom = useCallback(async () => {
    if (!attempt || ['submitting', 'results', 'sealed'].includes(phase)) return;
    setSubmitBlocked('');
    const [clean] = await Promise.all([coordinatorRef.current?.flush?.(), flagApi.flush()]);
    if (!clean) {
      setSubmitBlocked('Some answers have not been saved. Check your connection, select “Retry”, then submit again to avoid losing answers.');
      return;
    }
    setPhase('submitting');
    if (testData?.skill_drill_homework) {
      audioRef.current?.pause();
      await drillPlayback.current().catch(() => {});
    }
    await runRoomSubmit(0);
  }, [attempt, drillPlayback, flagApi.flush, phase, runRoomSubmit, testData?.skill_drill_homework]);

  const retryRoomSubmit = useCallback(() => { void runRoomSubmit(0); }, [runRoomSubmit]);

  const roomFlush = useCallback(async () => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return { unsaved: 0 };
    const clean = await coordinator.flush?.();
    return { unsaved: clean ? 0 : Math.max(1, coordinator.snapshot?.().size ?? 1) };
  }, []);

  // FR-014: write every answer the server has not acked yet, read it back.
  const saveRoomLocalCopy = useCallback(() => {
    if (!roomScope || !attempt) return false;
    void coordinatorRef.current?.flush?.({ keepalive: true });
    const entries: Record<string, { value: string; baseValue: string | null }> = {};
    const keys = new Set<number>([...answersRef.current.keys(), ...ackedRef.current.keys()]);
    for (const q of keys) {
      const value = answersRef.current.get(q) || '';
      const base = ackedRef.current.get(q) ?? null;
      if (value !== (base ?? '')) entries[String(q)] = { value, baseValue: base };
    }
    if (!Object.keys(entries).length) return true;
    const started = Date.parse(attempt.started_at);
    const expiresAt = localCopyExpiry({ deadline: Number.isFinite(started) ? started + ROOM_RESUME_WINDOW_MS : null });
    return writeLocalCopy(roomStorage(), { ...roomScope, answers: entries, expiresAt });
  }, [attempt, roomScope]);

  const selfSelected = !!attempt && !params?.classItem && !params?.sittingId && !params?.adminPreview && !params?.mockEmbed
    && attempt.attempt_purpose !== 'mock_delivery';
  // FR-012: "Abandon test" for a learner's own self-selected attempt (route of G08-T23).
  const abandonRoom = useCallback(async () => {
    if (!attempt) return;
    const id = encodeURIComponent(attempt.attempt_id);
    try {
      await window.api.postWith(`/api/listening/tests/attempts/${id}/abandon`, undefined, {}, { noRedirect: true });
    } catch (caught: any) {
      if (caught?.status === 401) { setRoomSession('expired'); throw caught; }
      const reason = String(caught?.detail?.reason || '');
      if (caught?.status === 409 && reason === 'already_submitted') {
        window.location.assign(listeningReviewHref(attempt.attempt_id, params?.from || null));
        return;
      }
      if (caught?.status === 409 && reason === 'resume_expired') {
        audioRef.current?.pause();
        setRoomSubmit({ outcome: 'expired', message: ROOM_ABANDON_MESSAGES.resume_expired });
        return;
      }
      if (caught?.status === 409) { setRoomNotice(ROOM_ABANDON_MESSAGES[reason] || ROOM_ABANDON_MESSAGES.attempt_changed); return; }
      setRoomNotice('Unable to abandon the test. Check your connection and try again.');
      throw caught;
    }
    collectionFrozenRef.current = true;
    coordinatorRef.current?.dispose?.();
    audioRef.current?.pause();
    if (roomScope) clearLocalCopy(roomStorage(), roomScope);
    window.location.assign(backHref);
  }, [attempt, backHref, params?.from, roomScope]);

  // FR-015: a read-only tab reloads the canonical answers and stays silent.
  const reloadRoomFromServer = useCallback(async () => {
    if (!params || !attempt) return;
    const payload = await window.api.getWith<any>(resumePath(params), {}, { noRedirect: true });
    const canonical = normalizeListeningResume(payload);
    if (!canonical || canonical.attempt_id !== attempt.attempt_id) return;
    const restored = listeningAnswersFromRows(canonical.answers);
    ackedRef.current = new Map(restored);
    answersRef.current = restored;
    setAnswers(new Map(restored));
    coordinatorRef.current?.seed?.(restored);
  }, [attempt, params, resumePath]);
  const onRoomWriteRight = useCallback((canWrite: boolean) => {
    canWriteRef.current = canWrite;
    if (!canWrite) { audioRef.current?.pause(); setPlaying(false); }
  }, []);

  if (phase === 'results' && testData) return <ResultView result={result} attempt={attempt} test={testData} from={params?.from || null} sittingId={params?.sittingId || null} classItem={params?.classItem} />;
  if (phase === 'capture' && result) return <MockPostTestCapture
    skill="listening"
    envelope={result}
    onComplete={(payload) => {
      if (payload?.result) { setResult(payload.result); setPhase('results'); }
      else setPhase('sealed');
    }}
  />;

  const audioElement = testData ? <audio
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
        ? 'Unable to load audio. Reload the audio; the test timer continues.'
        : 'You are offline and audio was interrupted. Keep this tab open; audio will reload when the connection returns.')}
    /> : null;

  if (examRoom) {
    // FR-001: the single branch point, after every hook.
    const questionsBySection = new Map<number, number[]>(sections.map((section: any) => [
      Number(section.section_num), questionsForSection(section).map((question: any) => Number(question.q_num)).filter(Number.isFinite),
    ]));
    const policy = testData ? listeningAudioPolicy(testData, { sittingId: params?.sittingId }) : 'practice';
    const fullTest = !!testData && testData.test_type === 'full' && !params?.mockEmbed && !params?.adminPreview;
    return <ListeningTestRoom
      phase={phase === 'submitting' ? 'inprogress' : phase}
      error={error}
      title={testData?.title || 'Listening Test'}
      practice={practice}
      isFullTest={fullTest}
      adminPreview={!!params?.adminPreview}
      embedded={!!params?.mockEmbed}
      attemptId={attempt?.attempt_id || null}
      ownerKey={user?.id || ''}
      backHref={backHref}
      sectionNums={sections.map((section: any) => Number(section.section_num))}
      activeSection={activeSection}
      questionsBySection={questionsBySection}
      answers={answers}
      saveStates={saveStates}
      lastSavedAt={lastSavedAt}
      currentQuestion={currentQuestion}
      reviewQuestions={reviewQuestions}
      flagsReady={!!params?.adminPreview || flagApi.ready}
      resumeAvailable={resumeAvailable}
      admissionRequired={admissionRequired}
      savedAnswerCount={answers.size}
      submitBlocked={roomNotice || submitBlocked}
      session={roomSession}
      audio={{
        policy,
        playing,
        started: playbackStarted,
        ended: audioEnded,
        current: currentTime,
        duration,
        error: audioError,
        retrying: audioRetrying,
        needsGesture: audioPromptOpen,
        element: audioElement,
        onPlay: () => { if (canWriteRef.current) void startAudio(); },
        onPause: () => { if (policy === 'practice') { audioRef.current?.pause(); setPlaying(false); } },
        onSeek: (seconds: number) => { if (policy === 'practice' && audioRef.current) { audioRef.current.currentTime = seconds; setCurrentTime(seconds); } },
        onRetry: () => { void retryAudio(); },
      }}
      submit={{ outcome: roomSubmit.outcome, message: roomSubmit.message, onSubmit: submitRoom, onRetry: retryRoomSubmit }}
      renderSection={(sectionNum: number) => <div onFocusCapture={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-q-num]');
        const qNum = Number(target?.dataset.qNum || 0);
        if (qNum) setCurrentQuestion(qNum);
      }}>{sections.filter((section: any) => Number(section.section_num) === sectionNum).map((section: any) => <section className="ielts-section" key={section.section_num}>
        <div className="ielts-section-label">PART {section.section_num}</div><h2 className="ielts-section-title">{questionRange(section)}</h2>
        {(section.exercises || []).map((exercise: any, index: number) => <Exercise key={exercise.id || index} exercise={exercise} answers={answers} saveStates={saveStates} onAnswer={(q: number, v: string) => { if (canWriteRef.current) updateAnswer(q, v); }} />)}
      </section>)}</div>}
      onStartFresh={() => { void startFresh(); }}
      onResume={resume}
      onReload={() => { void bootWithRecovery(); }}
      onJump={jumpToQuestion}
      onToggleFlag={toggleFlag}
      onRetrySaves={() => { setRoomNotice(''); coordinatorRef.current?.retryFailed?.(); }}
      flush={roomFlush}
      abandon={selfSelected ? abandonRoom : undefined}
      saveLocalCopy={saveRoomLocalCopy}
      reloadFromServer={reloadRoomFromServer}
      onWriteRightChange={onRoomWriteRight}
    />;
  }

  const activeSectionData = sections.find((section: any) => Number(section.section_num) === activeSection);
  const activeSectionQuestions = questionsForSection(activeSectionData);

  return <>
    <a className="vh" href="#listening-paper">Skip to test content</a>
    <header className="exam-topbar listening-next-topbar" role="banner">
      <div className="exam-topbar__left">
        <div className="exam-topbar__candidate">Aver Learning <b>{params?.adminPreview ? 'Admin preview' : user?.email || 'Candidate'}</b></div>
        <div className="exam-topbar__section">{practice ? 'IELTS Listening Practice' : 'IELTS Listening'} · {testData?.title || 'Listening Test'}</div>
      </div>
      <div className="listening-next-audio-state" aria-live="polite" hidden={!['inprogress', 'submitting'].includes(phase)}>
        <strong>{practice ? (playing ? 'Practice audio playing' : 'Practice audio ready') : audioEnded ? 'Audio has ended' : playing ? 'Audio is Playing' : playbackStarted ? 'Audio paused' : 'Audio ready'}</strong>
        {practice ? <span>{formatTime(currentTime)} / {formatTime(duration)}</span> : <span>{playing ? 'Do not close this page' : 'Listening test'}</span>}
      </div>
      <div className="exam-topbar__right"><span className="listening-next-topbar-progress">{answers.size}/{total || '—'} answered</span></div>
    </header>
    <main className={`listening-next-shell${['inprogress', 'submitting'].includes(phase) ? ' is-testing' : ''}${params?.adminPreview ? ' is-preview' : ''}`}>
      {phase === 'loading' ? <div className="empty-state">Đang tải bài Listening…</div> : null}
      {phase === 'error' ? <section className="error-banner" role="alert"><p>{error}</p><div className="listening-next-actions"><button className="ft-control-btn" type="button" onClick={() => void bootWithRecovery()}>Retry</button><a className="ft-control-btn ghost" href={backHref}>← Back</a></div></section> : null}
      {phase === 'prestart' && admissionRequired ? <section className="ft-prestart"><h1>Listening test</h1><p>Start the test to continue to Listening.</p><div className="listening-next-actions"><button className="ft-control-btn" type="button" onClick={() => void startFresh()}>Start test</button><a className="ft-control-btn ghost" href={backHref}>← Back</a></div></section> : null}
      {phase === 'prestart' && testData ? <section className="ft-prestart">
        <p className="eyebrow">{practice ? 'LISTENING PRACTICE' : 'FULL LISTENING TEST'}</p>
        <h1>{testData.title}</h1><p>{sections.length} parts · {total} questions</p>
        <div className="ft-rules"><ul><li>Your answers are saved automatically.</li><li>Reloading the page resumes your current attempt.</li><li>{practice ? 'You can pause, seek and replay the practice audio.' : 'The recording plays once. You cannot rewind or restart it.'}</li></ul></div>
        {resumeAvailable ? <p className="ft-resume-note">You have an unfinished attempt with {answers.size} saved answers. Resume to keep your answers and audio position.</p> : null}
        <div className="listening-next-actions"><a className="ft-control-btn ghost" href={backHref}>← Back</a>
          {resumeAvailable ? <button className="ft-control-btn" id="ft-resume-btn" type="button" onClick={resume}>Resume test</button> : null}
          <button className="ft-control-btn ghost" id="btn-start" type="button" onClick={() => {
            if (!resumeAvailable) { void startFresh(); return; }
            if (window.confirm('Your current attempt will be discarded and replaced. Start a new attempt?')) void startFresh();
          }}>{resumeAvailable ? 'Start a new attempt' : 'Start test'}</button>
        </div>
      </section> : null}
      {['inprogress', 'submitting'].includes(phase) && testData ? <>
        {params?.adminPreview ? <aside className="listening-admin-preview" role="status"><strong>Admin preview</strong><span>Preview only. Answers stay in this tab and no test attempt or result is saved.</span><span className="listening-admin-preview__actions"><a className="ft-control-btn ghost" href={`/listening/review?admin_test_id=${encodeURIComponent(testData.id)}`}>Review answers</a><a className="ft-control-btn ghost" href={backHref}>Back to tests</a></span></aside> : null}
        <section className="listening-next-part-strip" aria-label={`Part ${activeSection}`}>
          <strong>Part {activeSection}</strong><span>{activeSectionQuestions.length ? `Listen and answer questions ${activeSectionQuestions[0]?.q_num}–${activeSectionQuestions.at(-1)?.q_num}.` : 'Listen and answer the questions.'}</span>
        </section>
        <section className={`ft-sticky listening-next-player${practice ? ' is-practice' : ' is-full-test'}`} aria-label="Audio controls">
          {practice ? <>
            <div className="ft-sticky-row"><span className="ft-progress-text">Practice audio</span><span className="ft-time">{formatTime(currentTime)} / {formatTime(duration)}</span></div>
            <div className="ft-audio-bar ft-audio-bar--seekable"><div className="ft-audio-fill" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }} /></div>
          </> : <div className="listening-next-full-audio-copy"><span className="listening-next-headphones" aria-hidden="true">◉</span><span><strong>{audioEnded ? 'Audio has ended' : playing ? 'Audio is Playing' : playbackStarted ? 'Audio paused by the browser' : 'Audio ready'}</strong><small>{audioEnded ? 'Continue answering before you submit.' : 'The recording cannot be rewound or restarted.'}</small></span></div>}
          {audioError ? <div className="ft-audio-error" role="alert"><span>{audioError}</span><button className="ft-control-btn ghost" type="button" onClick={() => void retryAudio()} disabled={audioRetrying}>{audioRetrying ? 'Reloading…' : 'Reload audio'}</button></div> : null}
          <div className="ft-audio-controls">
            {practice ? <><button className="ft-control-btn" type="button" onClick={toggleAudio}>{playing ? 'Pause' : '▶ Play'}</button><input aria-label="Audio progress" type="range" min="0" max={Math.max(1, duration)} value={currentTime} onChange={(event) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setCurrentTime(next); }} /></>
              : !audioPromptOpen && !playing && !audioEnded ? <button className="ft-control-btn" type="button" onClick={startAudio}>{playbackStarted ? 'Resume' : '▶ Play'}</button> : null}
            <label>Volume <input aria-label="Volume" type="range" min="0" max="100" defaultValue="100" onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value) / 100; }} /></label>
          </div>
          {audioElement}
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
              <button className="listening-next-palette-label" type="button" aria-expanded={sectionNum === activeSection} aria-controls={`listening-part-${sectionNum}-numbers`} onClick={() => { const first = Number(sectionQuestions[0]?.q_num || 0); if (first) jumpToQuestion(first); }}><strong>Part {sectionNum}</strong><span>{sectionQuestions.filter((question: any) => answers.has(Number(question.q_num))).length} / {sectionQuestions.length}</span></button>
              <div id={`listening-part-${sectionNum}-numbers`} hidden={sectionNum !== activeSection}>{sectionQuestions.map((question: any) => {
                const qNum = Number(question.q_num);
                return <button className={`progress-square${answers.has(qNum) ? ' answered' : ''}${qNum === currentQuestion ? ' current' : ''}${reviewQuestions.has(qNum) ? ' is-review' : ''}${saveStates.has(qNum) ? ' is-unsaved' : ''}${saveStates.get(qNum) === 'failed' ? ' is-save-failed' : ''}`} type="button" key={qNum} aria-current={qNum === currentQuestion ? 'step' : undefined} aria-label={`Question ${qNum}${answers.has(qNum) ? ', answered' : ', unanswered'}${reviewQuestions.has(qNum) ? ', marked for review' : ''}`} onClick={() => jumpToQuestion(qNum)}>{qNum}</button>;
              })}</div>
            </div>;
          })}</div>
          {saveStates.size ? <p className="ft-unsaved-note" role="status">{unsavedPending ? `Saving ${unsavedPending} answers. ` : ''}{unsavedRetrying ? `Retrying ${unsavedRetrying} answers. ` : ''}{unsavedFailed ? `${unsavedFailed} answers have not been saved to the server.` : 'Keep this tab open until saving finishes.'}{unsavedFailed ? <button className="ft-unsaved-retry" type="button" onClick={() => coordinatorRef.current?.retryFailed?.()}>Retry</button> : null}</p> : null}
          {submitBlocked ? <p className="ft-nothing-saved" role="alert">{submitBlocked}</p> : null}
          {!params?.adminPreview ? <AttemptReviewFlagStatus ready={flagApi.ready} states={flagApi.states} error={flagApi.error} onRetry={flagApi.retry} /> : null}
          <div className="listening-next-submit-row"><button className="listening-next-nav-btn" type="button" disabled={currentQuestion === Number(allQuestions[0]?.question?.q_num)} onClick={() => moveQuestion(-1)}>‹ Previous</button><label className="listening-next-review"><input type="checkbox" checked={currentQuestion != null && reviewQuestions.has(currentQuestion)} disabled={currentQuestion == null || phase !== 'inprogress' || (!params?.adminPreview && !flagApi.ready)} onChange={() => { if (currentQuestion != null) toggleFlag(currentQuestion); }} /> Review</label><button className="listening-next-nav-btn" type="button" disabled={currentQuestion === Number(allQuestions.at(-1)?.question?.q_num)} onClick={() => moveQuestion(1)}>Next ›</button>{params?.adminPreview ? <a className="btn-submit-final" href={`/listening/review?admin_test_id=${encodeURIComponent(testData.id)}`}>Review answers</a> : !params?.mockEmbed ? <button className="btn-submit-final" id="btn-submit" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(true)}>{phase === 'submitting' ? 'Submitting…' : 'Submit answers'}</button> : null}</div>
        </footer>
      </> : null}
      {phase === 'sealed' ? <section className="ft-prestart"><p>Listening answers collected. Waiting for the next section…</p></section> : null}
    </main>
    {audioPromptOpen ? <div className="listening-next-modal listening-next-audio-prompt" role="dialog" aria-modal="true" aria-labelledby="listening-audio-title"><div className="listening-next-modal-backdrop" /><section ref={audioDialogRef} className="listening-next-modal-panel" tabIndex={-1}><div className="listening-next-audio-icon" aria-hidden="true">◉</div><h2 id="listening-audio-title">Check your headphones</h2><p>When you press Play, the recording starts immediately. You cannot pause, rewind or play it again.</p><button ref={audioPlayRef} className="ft-control-btn" type="button" onClick={() => void startAudio()}>▶ Play</button></section></div> : null}
    {submitOpen && !params?.adminPreview ? <div className="listening-next-modal" role="dialog" aria-modal="true" aria-labelledby="listening-submit-title"><button className="listening-next-modal-backdrop" aria-label="Close" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(false)} /><section ref={submitDialogRef} className="listening-next-modal-panel" tabIndex={-1}><h2 id="listening-submit-title">Submit answers?</h2><p>{answers.size < total ? `You have ${total - answers.size} unanswered questions out of ${total}.` : `You have answered all ${total} questions.`}</p><div className="listening-next-actions"><button ref={submitCancelRef} className="ft-control-btn ghost" type="button" disabled={phase === 'submitting'} onClick={() => setSubmitOpen(false)}>Return to test</button><button className="ft-control-btn" type="button" disabled={phase === 'submitting'} onClick={() => void submit()}>Submit answers</button></div></section></div> : null}
  </>;
}
