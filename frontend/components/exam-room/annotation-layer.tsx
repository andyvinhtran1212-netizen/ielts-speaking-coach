'use client';

// EXAMROOM-0066 FR-030, FR-032: Highlight / Note on the reading passage.
// Selecting text shows a floating bar "Highlight · Note · Clear" (English in
// both modes, FR-002). Marks are kept per attempt on this browser only, under
// `exam-room:marks:{surface}:{ownerKey}:{attemptKey}`, for 30 days after the
// last change (FR-032: submitted + 30 days). They are never sent to the server.
//
// Marks are stored as character offsets in the passage's text, so the passage
// DOM that React owns is never rewritten: the CSS Custom Highlight API paints
// them where it exists; otherwise `<mark>` boxes are laid over the text.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import styles from './annotation-layer.module.css';

export type ExamRoomMark = { id: string; start: number; end: number; note?: string };

export const MARKS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HIGHLIGHT_NAME = 'exam-room-mark';

const WORDS = { highlight: 'Highlight', note: 'Note', clear: 'Clear', save: 'Save note', cancel: 'Cancel', noteLabel: 'Note text', notes: 'Notes', toolbar: 'Annotation tools' } as const;

export function marksKey(surface: string, ownerKey: string, attemptKey: string): string {
  return `exam-room:marks:${surface}:${ownerKey}:${attemptKey}`;
}

function validMark(m: unknown): m is ExamRoomMark {
  if (!m || typeof m !== 'object') return false;
  const x = m as Record<string, unknown>;
  return typeof x.id === 'string' && Number.isInteger(x.start) && Number.isInteger(x.end)
    && (x.start as number) >= 0 && (x.end as number) > (x.start as number)
    && (x.note === undefined || typeof x.note === 'string');
}

/** Reads the marks; an expired, broken or unreadable entry reads as none. */
export function readMarks(storage: Storage | null, key: string, now = Date.now()): ExamRoomMark[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const data = JSON.parse(raw) as { expiresAt?: number; marks?: unknown[] };
    if (typeof data.expiresAt !== 'number' || data.expiresAt <= now) {
      storage?.removeItem(key);
      return [];
    }
    return Array.isArray(data.marks) ? data.marks.filter(validMark) : [];
  } catch {
    return [];
  }
}

/** Writes the marks; returns false when the browser would not keep them. */
export function writeMarks(storage: Storage | null, key: string, marks: ExamRoomMark[], now = Date.now()): boolean {
  try {
    if (!storage) return false;
    if (!marks.length) { storage.removeItem(key); return true; }
    storage.setItem(key, JSON.stringify({ v: 1, expiresAt: now + MARKS_TTL_MS, marks }));
    return true;
  } catch {
    return false;
  }
}

/** Adds a highlight over [start, end); overlapping highlights merge, notes are kept. */
export function addMark(marks: ExamRoomMark[], start: number, end: number, id: string, note?: string): ExamRoomMark[] {
  if (!(end > start)) return marks;
  if (note !== undefined) return [...marks, { id, start, end, note }].sort((a, b) => a.start - b.start);
  let s = start;
  let e = end;
  const keep: ExamRoomMark[] = [];
  for (const m of marks) {
    if (m.note === undefined && m.start <= e && m.end >= s) { s = Math.min(s, m.start); e = Math.max(e, m.end); }
    else keep.push(m);
  }
  return [...keep, { id, start: s, end: e }].sort((a, b) => a.start - b.start);
}

/** Removes every mark that touches [start, end); a collapsed range clears the mark under it. */
export function clearMarks(marks: ExamRoomMark[], start: number, end: number): ExamRoomMark[] {
  const e = end > start ? end : start + 1;
  return marks.filter((m) => !(m.start < e && m.end > start));
}

function safeStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** Character offset of a DOM point inside `root`'s text. */
function offsetOf(root: Node, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

/** A DOM range for [start, end) of `root`'s text. */
function rangeFor(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;
    if (!startNode && start <= pos + len) { startNode = node; startOff = start - pos; }
    if (startNode && end <= pos + len) {
      const range = document.createRange();
      range.setStart(startNode, startOff);
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
function highlightApi(): { registry: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
}

type Box = { key: string; top: number; left: number; width: number; height: number };
type Selection = { start: number; end: number; top: number; left: number };

export type AnnotationLayerProps = {
  surface: string;
  ownerKey: string;
  attemptKey: string;
  /** Narrow screens: notes are numbers in the text that open on tap, not a margin. */
  narrow?: boolean;
  /** Time up or read-only: marks show, nothing can be added or cleared. */
  disabled?: boolean;
  /** Tests only. */
  storage?: Storage | null;
  children: ReactNode;
};

export function AnnotationLayer({ surface, ownerKey, attemptKey, narrow = false, disabled = false, storage, children }: AnnotationLayerProps) {
  const store = storage === undefined ? safeStorage() : storage;
  const key = marksKey(surface, ownerKey, attemptKey);
  const textRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<ExamRoomMark[]>(() => readMarks(store, key));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drafting, setDrafting] = useState<Selection | null>(null);
  const [draft, setDraft] = useState('');
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [anchors, setAnchors] = useState<Record<string, { top: number; left: number }>>({});
  const seq = useRef(0);
  const noteId = useId();

  useEffect(() => { setMarks(readMarks(store, key)); setSelection(null); setDrafting(null); }, [key, store]);

  // Time up or read-only: tools that were already open close, and no write path
  // changes a saved mark any more (FR-030, CR HOLD on #2528).
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    if (!disabled) return;
    setSelection(null);
    setDrafting(null);
    setDraft('');
  }, [disabled]);

  const update = useCallback((next: ExamRoomMark[]) => {
    if (disabledRef.current) return;
    setMarks(next);
    writeMarks(store, key, next);
  }, [store, key]);

  // Paint: CSS Highlight API where it exists, otherwise <mark> boxes over the text.
  useLayoutEffect(() => {
    const root = textRef.current;
    const wrap = wrapRef.current;
    if (!root || !wrap) return undefined;
    const ranges = marks.map((m) => ({ m, r: rangeFor(root, m.start, m.end) })).filter((x): x is { m: ExamRoomMark; r: Range } => x.r != null);
    const base = wrap.getBoundingClientRect();
    const nextAnchors: Record<string, { top: number; left: number }> = {};
    for (const { m, r } of ranges) {
      if (m.note === undefined) continue;
      const rects = Array.from(r.getClientRects?.() ?? []);
      const last = rects[rects.length - 1];
      nextAnchors[m.id] = last ? { top: last.top - base.top, left: last.right - base.left } : { top: 0, left: 0 };
    }
    setAnchors(nextAnchors);
    const api = highlightApi();
    if (api) {
      api.registry.set(HIGHLIGHT_NAME, new api.Highlight(...ranges.map((x) => x.r)));
      setBoxes([]);
      return () => api.registry.delete(HIGHLIGHT_NAME);
    }
    const next: Box[] = [];
    for (const { m, r } of ranges) {
      Array.from(r.getClientRects?.() ?? []).forEach((rect, i) => {
        next.push({ key: `${m.id}-${i}`, top: rect.top - base.top, left: rect.left - base.left, width: rect.width, height: rect.height });
      });
    }
    setBoxes(next);
    return undefined;
  }, [marks, narrow]);

  const readSelection = useCallback(() => {
    if (disabled) return;
    const root = textRef.current;
    const wrap = wrapRef.current;
    const sel = typeof window === 'undefined' ? null : window.getSelection();
    if (!root || !wrap || !sel || sel.rangeCount === 0) { setSelection(null); return; }
    const range = sel.getRangeAt(0);
    const start = offsetOf(root, range.startContainer, range.startOffset);
    const end = offsetOf(root, range.endContainer, range.endOffset);
    if (start == null || end == null) { setSelection(null); return; }
    const rect = range.getBoundingClientRect?.();
    const base = wrap.getBoundingClientRect();
    setSelection({ start: Math.min(start, end), end: Math.max(start, end), top: rect ? rect.top - base.top : 0, left: rect ? rect.left - base.left : 0 });
  }, [disabled]);

  const nextId = () => { seq.current += 1; return `m${Date.now().toString(36)}${seq.current}`; };
  const clearSelection = () => { try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ } setSelection(null); };

  const highlight = () => {
    if (disabled || !selection || selection.end <= selection.start) return;
    update(addMark(marks, selection.start, selection.end, nextId()));
    clearSelection();
  };
  const startNote = () => {
    if (disabled || !selection || selection.end <= selection.start) return;
    setDrafting(selection);
    setDraft('');
    clearSelection();
  };
  const saveNote = () => {
    if (disabled || !drafting) return;
    const text = draft.trim();
    if (text) update(addMark(marks, drafting.start, drafting.end, nextId(), text));
    setDrafting(null);
    setDraft('');
  };
  const clear = () => {
    if (disabled || !selection) return;
    update(clearMarks(marks, selection.start, selection.end));
    clearSelection();
  };

  const notes = marks.filter((m) => m.note !== undefined);
  const selectionInMark = selection ? clearMarks(marks, selection.start, selection.end).length !== marks.length : false;
  const hasRange = selection != null && selection.end > selection.start;

  return (
    <div className={styles.wrap} ref={wrapRef} data-narrow={narrow ? '' : undefined}>
      <div
        ref={textRef}
        className={styles.text}
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        onTouchEnd={readSelection}
      >
        {children}
      </div>
      {boxes.map((b) => (
        <mark key={b.key} aria-hidden="true" className={styles.box} style={{ top: b.top, left: b.left, width: b.width, height: b.height }} />
      ))}
      {notes.map((m, i) => {
        const at = anchors[m.id];
        if (!narrow || !at) return null;
        return (
          <button
            key={m.id}
            type="button"
            className={styles.noteNumber}
            style={{ top: at.top, left: at.left }}
            aria-expanded={openNote === m.id}
            aria-controls={`${noteId}-${m.id}`}
            aria-label={`${WORDS.note} ${i + 1}`}
            onClick={() => setOpenNote(openNote === m.id ? null : m.id)}
          >
            {i + 1}
          </button>
        );
      })}
      {!disabled && (hasRange || selectionInMark) && !drafting ? (
        <div role="toolbar" aria-label={WORDS.toolbar} lang="en" className={styles.toolbar} style={{ top: selection!.top, left: selection!.left }}>
          {hasRange ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={highlight}>{WORDS.highlight}</button> : null}
          {hasRange ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={startNote}>{WORDS.note}</button> : null}
          {selectionInMark ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clear}>{WORDS.clear}</button> : null}
        </div>
      ) : null}
      {drafting && !disabled ? (
        <div className={styles.noteEditor} lang="en" style={{ top: drafting.top }}>
          <label className={styles.noteLabel} htmlFor={`${noteId}-draft`}>{WORDS.noteLabel}</label>
          <textarea id={`${noteId}-draft`} autoFocus value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} />
          <div className={styles.noteActions}>
            <button type="button" onClick={saveNote}>{WORDS.save}</button>
            <button type="button" onClick={() => { setDrafting(null); setDraft(''); }}>{WORDS.cancel}</button>
          </div>
        </div>
      ) : null}
      {notes.length ? (
        <aside className={styles.margin} aria-label={WORDS.notes} lang="en">
          <ol>
            {notes.map((m, i) => (
              <li key={m.id} id={`${noteId}-${m.id}`} hidden={narrow && openNote !== m.id} style={!narrow && anchors[m.id] ? { top: anchors[m.id].top } : undefined}>
                <span className={styles.noteIndex} aria-hidden="true">{i + 1}</span>
                {m.note}
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </div>
  );
}
