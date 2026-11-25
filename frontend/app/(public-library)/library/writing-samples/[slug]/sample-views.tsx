'use client';

/**
 * Section 4 "Ba bài mẫu" of the sample page (LIBRARY-0061 T010, FR-013,
 * FR-014; tờ BaiMauWriting màn 1 và 4).
 *
 * Two views, kept in the URL (`xem`, `muc`, `cap`): "Đọc từng bài" (one band at
 * a time) and "So sánh hai mức" (7.5 → 7.0 or 7.0 → 6.0, paragraph by
 * paragraph). All three essays and both comparisons are rendered by the
 * server; the views only show or hide them, so every essay and every delta
 * note is in the server HTML (FR-001). Switching rewrites the query string in
 * place (no navigation); each control is also a plain link, so the page works
 * without JavaScript.
 */
import { useCallback, useState, type MouseEvent } from 'react';

import type { ComparisonRow, MarginNote, RowNote, Segment } from '@/lib/delta-highlight.mjs';
import { criterionStyle } from '@/lib/delta-highlight.mjs';

import { BANDS, PAIRS, viewQuery } from './sample-model.mjs';
import styles from './sample-page.module.css';

export type ViewState = { xem: 'doc' | 'so-sanh'; muc: string; cap: string };

export type EssayView = {
  band: string;
  words: number | null;
  paragraphs: { part: string | null; fn: string | null; text: string }[];
};

export type ComparisonView = {
  pair: string;
  high: string;
  low: string;
  highWords: number | null;
  lowWords: number | null;
  rows: ComparisonRow[];
  marginOnly: MarginNote[];
};

export type SampleViewsProps = {
  essays: EssayView[];
  comparisons: ComparisonView[];
  initial: ViewState;
};

const UNDERLINE_LEGEND = [
  { style: 'tr', label: 'Task Response', mark: 'gạch chấm' },
  { style: 'cc', label: 'Coherence and Cohesion', mark: 'gạch đứt' },
  { style: 'lr', label: 'Lexical Resource', mark: 'gạch sóng' },
  { style: 'gra', label: 'Grammatical Range and Accuracy', mark: 'gạch liền' },
] as const;

const UNDERLINE_CLASS: Record<string, string | undefined> = {
  tr: styles.lineTr,
  cc: styles.lineCc,
  lr: styles.lineLr,
  gra: styles.lineGra,
};

function words(n: number | null): string {
  return typeof n === 'number' && n > 0 ? ` · ${n} từ` : '';
}

function Marked({
  segments,
  side,
  active,
  onPick,
}: {
  segments: Segment[];
  side: 'high' | 'low';
  active: number | null;
  onPick: (n: number) => void;
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.n === undefined) return <span key={i}>{seg.text}</span>;
        const n = seg.n;
        const on = active === n;
        const line = side === 'low' ? UNDERLINE_CLASS[criterionStyle(seg.criterion) ?? ''] : undefined;
        const cls = [side === 'high' ? styles.tint : styles.under, line, on ? styles.markOn : null].filter(Boolean).join(' ');
        return (
          <span key={i}>
            <mark className={cls} data-note={n} data-side={side}>
              {seg.text}
            </mark>
            <button type="button" className={styles.supButton} aria-pressed={on} aria-label={`Chú thích ${n}`} onClick={() => onPick(n)}>
              {n}
            </button>
          </span>
        );
      })}
    </>
  );
}

function NoteList({ notes, active, onPick }: { notes: RowNote[]; active: number | null; onPick: (n: number) => void }) {
  return (
    <ol className={styles.noteList}>
      {notes.map((note) => (
        <li key={note.n} className={active === note.n ? `${styles.noteItem} ${styles.noteOn}` : styles.noteItem}>
          <button type="button" className={styles.numButton} aria-pressed={active === note.n} onClick={() => onPick(note.n)}>
            {note.n}
          </button>
          <div>
            {note.criterion ? <p className={styles.noteKind}>{note.criterion}</p> : null}
            {note.why ? <p className={styles.noteWhy}>{note.why}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CompareRow({ row, high, low }: { row: ComparisonRow; high: string; low: string }) {
  const [active, setActive] = useState<number | null>(null);
  const pick = (n: number) => setActive((cur) => (cur === n ? null : n));

  if (row.same && row.high) {
    return (
      <div className={styles.cmpRow} data-testid="compare-row">
        <div className={styles.cmpSame}>
          <p lang="en" className={styles.essayText}>
            {row.high.map((s) => s.text).join('')}
          </p>
          <p className={styles.quiet}>Hai mức viết giống hệt nhau; trang hiện một lần.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cmpRow} data-testid="compare-row">
      <div className={styles.cmpCols}>
        <div className={styles.cmpCell}>
          <p className={styles.cellLabel}>Band {high}</p>
          {row.high ? (
            <p lang="en" className={styles.essayText}>
              <Marked segments={row.high} side="high" active={active} onPick={pick} />
            </p>
          ) : null}
        </div>
        <div className={styles.cmpCell}>
          <p className={styles.cellLabel}>Band {low}</p>
          {row.low ? (
            <p lang="en" className={styles.essayText}>
              <Marked segments={row.low} side="low" active={active} onPick={pick} />
            </p>
          ) : null}
        </div>
      </div>
      {row.notes.length > 0 ? (
        <NoteList notes={row.notes} active={active} onPick={pick} />
      ) : (
        <p className={styles.quiet}>Đoạn này giống nhau về ý; không có chỗ đổi đáng ghi.</p>
      )}
    </div>
  );
}

export function SampleViews({ essays, comparisons, initial }: SampleViewsProps) {
  const [state, setState] = useState<ViewState>(initial);

  const go = useCallback((next: ViewState) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setState(next);
    try {
      const url = `${window.location.pathname}${viewQuery(next)}#ba-bai-mau`;
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // History unavailable (sandboxed preview): the view still switches.
    }
  }, []);

  const link = (next: ViewState) => ({ href: `${viewQuery(next) || '?'}#ba-bai-mau`, onClick: go(next) });
  const shownBands = essays.map((e) => e.band);
  const shownPairs = comparisons.map((c) => c.pair);

  return (
    <div className={styles.views} data-view={state.xem}>
      <nav aria-label="Chế độ xem" className={styles.viewTabs}>
        <a {...link({ ...state, xem: 'doc' })} aria-current={state.xem === 'doc' ? 'true' : undefined} className={styles.tab}>
          Đọc từng bài
        </a>
        {comparisons.length > 0 ? (
          <a {...link({ ...state, xem: 'so-sanh' })} aria-current={state.xem === 'so-sanh' ? 'true' : undefined} className={styles.tab}>
            So sánh hai mức
          </a>
        ) : null}
      </nav>

      <div hidden={state.xem !== 'doc'} data-testid="view-doc">
        <nav aria-label="Mức điểm" className={styles.chips}>
          {BANDS.filter((b) => shownBands.includes(b)).map((band) => (
            <a key={band} {...link({ ...state, xem: 'doc', muc: band })} aria-current={state.muc === band ? 'true' : undefined} className={styles.chip}>
              {band}
            </a>
          ))}
        </nav>
        {essays.map((essay) => (
          <section
            key={essay.band}
            aria-label={`Bài band ${essay.band}`}
            hidden={essay.band !== (shownBands.includes(state.muc) ? state.muc : shownBands[0])}
            data-band={essay.band}
            className={styles.essay}
          >
            <p className={styles.essayHead}>
              Band {essay.band}
              {words(essay.words)}
            </p>
            {essay.paragraphs.map((para, i) => (
              <div key={i} className={styles.essayPara}>
                {para.part || para.fn ? (
                  <p className={styles.paraRole}>{[para.part, para.fn].filter(Boolean).join(' · ')}</p>
                ) : null}
                <p lang="en" className={styles.essayText}>{para.text}</p>
              </div>
            ))}
          </section>
        ))}
      </div>

      {comparisons.length > 0 ? (
        <div hidden={state.xem !== 'so-sanh'} data-testid="view-compare">
          <nav aria-label="Cặp so sánh" className={styles.chips}>
            {PAIRS.filter((p) => shownPairs.includes(p.id)).map((pair) => (
              <a key={pair.id} {...link({ ...state, xem: 'so-sanh', cap: pair.id })} aria-current={state.cap === pair.id ? 'true' : undefined} className={styles.chip}>
                {pair.high} → {pair.low}
              </a>
            ))}
          </nav>
          <ul className={styles.legend} aria-label="Cách gạch ở bản thấp">
            {UNDERLINE_LEGEND.map((item) => (
              <li key={item.style}>
                <span className={`${styles.under} ${UNDERLINE_CLASS[item.style]}`}>{item.mark}</span> {item.label}
                {item.style === 'tr' ? ' / Task Achievement' : ''}
              </li>
            ))}
          </ul>
          {comparisons.map((cmp) => (
            <section
              key={cmp.pair}
              aria-label={`So sánh ${cmp.high} và ${cmp.low}`}
              hidden={cmp.pair !== (shownPairs.includes(state.cap) ? state.cap : shownPairs[0])}
              data-pair={cmp.pair}
              className={styles.compare}
            >
              <div className={styles.cmpHead}>
                <p>Band {cmp.high}{words(cmp.highWords)} · tô nền chỗ sẽ đổi</p>
                <p>Band {cmp.low}{words(cmp.lowWords)} · gạch theo tiêu chí</p>
              </div>
              {cmp.rows.map((row) => (
                <CompareRow key={row.index} row={row} high={cmp.high} low={cmp.low} />
              ))}
              {cmp.marginOnly.length > 0 ? (
                <div className={styles.marginOnly}>
                  <p className={styles.noteKind}>Ghi chú chưa gắn được vào câu</p>
                  <ul className={styles.noteList}>
                    {cmp.marginOnly.map((note, i) => (
                      <li key={i} className={styles.noteItem} data-testid="margin-only-note">
                        <div>
                          {note.criterion ? <p className={styles.noteKind}>{note.criterion}</p> : null}
                          {note.before ? <p lang="en">Band {cmp.high}: “{note.before}”</p> : null}
                          {note.after ? <p lang="en">Band {cmp.low}: “{note.after}”</p> : null}
                          {note.why ? <p className={styles.noteWhy}>{note.why}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className={styles.quiet}>
                Bấm số để khoanh đúng câu ở cả hai cột. Lý do viết bằng tiếng Việt; tên tiêu chí giữ nguyên như trong thang chấm IELTS.
              </p>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
