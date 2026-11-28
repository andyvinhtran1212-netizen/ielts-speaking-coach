'use client';

// EXAMROOM-0066 FR-025: table, form and note completion keep the paper's shape
// (a real table with inputs in its cells; form and note lines in order). The
// surface turns its template into segments (templateSegments or its own
// rows); this component only draws them.
import type { ReactNode } from 'react';

import type { ExamRoomSegment } from './answer-codec.mjs';
import { Segments } from './gap-input';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export type CompletionLine = { segments: readonly ExamRoomSegment[]; role?: 'title' | 'heading' | 'bullet' | 'line' };

export function CompletionGrid(props: AnswerProps & (
  | { kind: 'table'; heading?: string | null; headers: readonly string[]; rows: readonly (readonly (readonly ExamRoomSegment[])[])[]; renderGap?: (q: number) => ReactNode }
  | { kind: 'form' | 'notes'; heading?: string | null; lines: readonly CompletionLine[]; renderGap?: (q: number) => ReactNode }
)) {
  const { kind, heading, renderGap, answers, onAnswer, readOnly, strings } = props;
  const answerProps = { answers, onAnswer, readOnly, strings, renderGap };
  if (props.kind === 'table') {
    return (
      <div className={styles.tableWrap} data-question-kind="table">
        <table className={styles.table}>
          {heading ? <caption>{heading}</caption> : null}
          <thead><tr>{props.headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}</tr></thead>
          <tbody>{props.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => {
              const Cell = cellIndex === 0 ? 'th' : 'td';
              return <Cell key={cellIndex} scope={cellIndex === 0 ? 'row' : undefined}><Segments {...answerProps} segments={cell} /></Cell>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div className={styles.notes} data-question-kind={kind}>
      {heading ? <p className={styles.noteTitle}>{heading}</p> : null}
      {props.lines.map((line, index) => {
        const role = line.role ?? 'line';
        const className = role === 'title' ? styles.noteTitle : role === 'heading' ? styles.noteHeading : role === 'bullet' ? styles.noteBullet : styles.noteLine;
        return <div className={className} key={index}><Segments {...answerProps} segments={line.segments} /></div>;
      })}
    </div>
  );
}
