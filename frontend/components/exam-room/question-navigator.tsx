'use client';

// EXAMROOM-0066 FR-006–FR-009: the question strip, built from the test
// structure. Wide/medium: sections in a row, the current one opened into cells.
// Below 1024px: previous / position / next / Review, and a sheet of cells.
import { useMemo, useState, type CSSProperties } from 'react';

import { navigatorModel } from '@/lib/exam-room/navigator-model.mjs';

import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import styles from './exam-room.module.css';
import type { ExamRoomQuestion, ExamRoomSection } from './types';
import type { ExamRoomStrings } from './strings';

type Model = ReturnType<typeof navigatorModel>;
type SectionModel = Model['sections'][number];
type CellModel = SectionModel['cells'][number];

export type QuestionNavigatorProps = {
  sections: ExamRoomSection[];
  questions: ExamRoomQuestion[];
  currentQ?: number;
  width: number;
  strings: ExamRoomStrings;
  onJump?(q: number): void;
  onToggleFlag?(q: number): void;
  flagsReady?: boolean;
};

function Cell({ cell, onJump }: { cell: CellModel; onJump?(q: number): void }) {
  return (
    <button
      type="button"
      className={styles.cell}
      data-q={cell.q}
      data-answered={cell.answered ? '' : undefined}
      data-flagged={cell.flagged ? '' : undefined}
      data-unsaved={cell.unsaved ? '' : undefined}
      aria-current={cell.current ? 'true' : undefined}
      aria-label={cell.ariaLabel}
      onClick={() => onJump?.(cell.q)}
    >
      {cell.label}
    </button>
  );
}

function FlagToggle({ q, flagged, strings, onToggleFlag, flagsReady }: { q: number; flagged: boolean; strings: ExamRoomStrings; onToggleFlag(q: number): void; flagsReady?: boolean }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={styles.flagToggle}
      aria-pressed={flagged}
      disabled={flagsReady === false}
      onClick={() => onToggleFlag(q)}
    >
      {flagged ? strings.shell.unflag : strings.flag}
    </Button>
  );
}

export function QuestionNavigator({ sections, questions, currentQ, width, strings, onJump, onToggleFlag, flagsReady }: QuestionNavigatorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A section opened by hand stays open until the current question moves.
  const [expandedFor, setExpandedFor] = useState<number | undefined>(currentQ);
  const expandedSectionId = expandedFor === currentQ ? expanded : null;
  const model = useMemo(
    () => navigatorModel({ sections, questions, currentQ: currentQ ?? null, width, strings, expandedSectionId }),
    [sections, questions, currentQ, width, strings, expandedSectionId],
  );
  const current = questions.find((q) => q.q === currentQ);
  const cellStyle = { '--exam-cell-w': `${model.cellWidth}px` } as CSSProperties;

  const openSection = (section: SectionModel) => {
    setExpanded(section.id);
    setExpandedFor(section.jumpTo);
    onJump?.(section.jumpTo);
  };
  const jump = (q: number) => { setSheetOpen(false); onJump?.(q); };

  const sectionRow = (section: SectionModel, inSheet: boolean) => {
    const kind = strings.sectionKind[section.kind] ?? section.kind;
    if (inSheet) {
      // The sheet shows every question of every section.
      const qs = questions.filter((q) => q.sectionId === section.id).sort((a, b) => a.q - b.q);
      return (
        <section key={section.id} aria-label={`${kind} ${section.index}`}>
          <h3 className={styles.sheetHeading}>{section.chipLabel}</h3>
          <div className={styles.sheetGrid} style={{ '--exam-sheet-cols': model.sheetColumns ?? 10 } as CSSProperties}>
            {qs.map((q) => (
              <Cell
                key={q.q}
                onJump={jump}
                cell={{
                  q: q.q, label: String(q.q), answered: q.answered, flagged: q.flagged, current: q.q === currentQ,
                  unsaved: Boolean(q.saveState), saveState: q.saveState ?? null,
                  ariaLabel: strings.qLabel({ n: q.q, answered: q.answered, flagged: q.flagged, current: q.q === currentQ }),
                }}
              />
            ))}
          </div>
        </section>
      );
    }
    if (!section.expanded) {
      return (
        <button
          key={section.id}
          type="button"
          className={styles.chip}
          data-flag-rule={section.flagRule ? '' : undefined}
          aria-label={section.ariaLabel ?? undefined}
          onClick={() => openSection(section)}
        >
          {section.chipLabel}
        </button>
      );
    }
    return (
      <div key={section.id} className={styles.section} role="group" aria-label={`${kind} ${section.index}`}>
        <span className={styles.sectionName} aria-hidden="true">{kind} {section.index}</span>
        {section.cells.map((cell) => <Cell key={cell.q} cell={cell} onJump={onJump} />)}
      </div>
    );
  };

  const flag = onToggleFlag && current
    ? <FlagToggle q={current.q} flagged={current.flagged} strings={strings} onToggleFlag={onToggleFlag} flagsReady={flagsReady} />
    : null;

  if (model.compactBar) {
    return (
      <div className={styles.compactBar} data-density={model.density}>
        <Button variant="secondary" size="sm" disabled={model.previousQ == null} aria-label={strings.previous} onClick={() => model.previousQ != null && onJump?.(model.previousQ)}>‹</Button>
        <span className={styles.position}>{model.position}</span>
        <Button variant="secondary" size="sm" disabled={model.nextQ == null} aria-label={strings.next} onClick={() => model.nextQ != null && onJump?.(model.nextQ)}>›</Button>
        <Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>{strings.review}</Button>
        {flag}
        <Dialog
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          variant={model.sheetFullScreen ? 'modal' : 'drawer'}
          size="md"
          title={strings.shell.reviewTitle}
          closeLabel={strings.shell.closeReview}
        >
          <p className={styles.answeredText}>{model.answeredText}</p>
          {model.sections.map((s) => sectionRow(s, true))}
        </Dialog>
      </div>
    );
  }

  return (
    <nav className={styles.navigator} aria-label={strings.shell.reviewTitle} data-density={model.density} style={cellStyle}>
      {model.sections.map((s) => sectionRow(s, false))}
      {model.showAnsweredText ? <span className={styles.answeredText}>{model.answeredText}</span> : null}
      {flag}
    </nav>
  );
}
