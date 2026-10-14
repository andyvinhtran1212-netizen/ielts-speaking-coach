'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { components } from '@/types/api';
import { annotatePracticeHtml, markQuote, matchesSupportRevision } from '@/lib/reading-practice-dom.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export type PracticeSupport = components['schemas']['PracticeSupport'];
export type PracticeEvidence = components['schemas']['PracticeEvidence'];
type Unit = components['schemas']['PracticeUnit'];
type Figure = components['schemas']['PracticeIllustration'];
export type EvidenceSelection = { qNum: number; evidence: PracticeEvidence; generation: number } | null;

// The source DOM owns annotation spans and portal slots. Replacing innerHTML
// during a phrase/dialog update would detach the slot and lose reading focus.
const SourceHtml = memo(function SourceHtml({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

export function PracticeFigure({ figure, onZoom }: { figure: Figure; onZoom(src: string, alt: string): void }) {
  const [failed, setFailed] = useState(false);
  return <figure className="rp-figure">
    {failed ? <p role="status">Chưa tải được minh hoạ. Bạn vẫn có thể đọc bài và bản dịch.</p>
      : <button type="button" aria-label={`Phóng to: ${figure.alt}`} onClick={() => onZoom(figure.src, figure.alt)}>
        <img alt={figure.alt} src={figure.src} onError={() => setFailed(true)} />
      </button>}
    <figcaption>{figure.caption}</figcaption>
  </figure>;
}

function LinkedTranslation({ unit, highlighted, onHighlight }: { unit: Unit; highlighted: number | null; onHighlight(index: number): void }) {
  const pieces: React.ReactNode[] = [];
  let start = 0;
  const phrases = (unit.phrases || []).map((phrase, index) => ({ ...phrase, index, at: unit.translation_vi.indexOf(phrase.target) })).sort((a, b) => a.at - b.at);
  for (const phrase of phrases) {
    pieces.push(unit.translation_vi.slice(start, phrase.at));
    pieces.push(<button className={`rp-target${highlighted === phrase.index ? ' is-highlighted' : ''}`} type="button"
      aria-label={`${phrase.target} tương ứng với ${phrase.source}`} aria-pressed={highlighted === phrase.index}
      key={phrase.index} onClick={() => { if (!window.getSelection()?.toString()) onHighlight(phrase.index); }}>{phrase.target}</button>);
    start = phrase.at + phrase.target.length;
  }
  pieces.push(unit.translation_vi.slice(start));
  return <p lang="vi">{pieces}</p>;
}

export function PracticeReadingText({ body, glossary, support, translation, evidenceSelection, onGlossary, onZoom, onReturn }: {
  body: string;
  glossary: { term: string; aliases?: string[] }[];
  support: PracticeSupport | null;
  translation: string | null;
  evidenceSelection: EvidenceSelection;
  onGlossary(index: number): void;
  onZoom(src: string, alt: string): void;
  onReturn(qNum: number): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ html: string; units: Unit[]; figures: Figure[]; hash: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  const [evidenceReady, setEvidenceReady] = useState(false);
  const sourceFocus = useRef<HTMLElement | null>(null);
  const navigationFocus = useRef(false);
  const units = rendered?.units || [];
  const index = units.findIndex((unit) => unit.id === selected);
  const unit = units[index] || null;

  useEffect(() => {
    let disposed = false;
    setRendered(null); setSelected(null); setHighlighted(null);
    void (async () => {
      const ready = await whenGlobalReady(() => typeof window.renderMarkdown === 'function', 'Reading practice Markdown');
      if (!ready || disposed) return;
      const valid = await matchesSupportRevision(support, body, translation);
      if (disposed) return;
      const units = valid ? (support!.units || []) : [];
      setRendered({ html: annotatePracticeHtml(window.renderMarkdown!(body, { breaks: false }), glossary, units),
        units, figures: valid ? (support!.illustrations || []) : [], hash: valid ? support!.source_sha256 : null });
    })();
    return () => { disposed = true; };
  }, [body, glossary, support, translation]);

  const select = (id: string, phrase: number | null = null) => {
    sourceFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(id); setHighlighted(phrase);
  };
  const close = () => {
    const action = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-unit-action]') || [])].find((node) => node.dataset.unitAction === selected);
    setSelected(null); setHighlighted(null); (action || sourceFocus.current)?.focus();
  };
  const navigate = (id: string) => { navigationFocus.current = true; select(id); };
  useEffect(() => {
    if (slot && navigationFocus.current) { slot.querySelector<HTMLElement>('button')?.focus(); navigationFocus.current = false; }
  }, [slot]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-unit-id]').forEach((node) => {
      node.classList.toggle('is-selected', node.dataset.unitId === selected);
      node.classList.toggle('is-highlighted', node.dataset.unitId === selected && highlighted !== null && node.dataset.phraseIndex === String(highlighted));
    });
    root.querySelectorAll<HTMLElement>('[data-unit-action]').forEach((node) => node.setAttribute('aria-expanded', String(node.dataset.unitAction === selected)));
    const first = [...root.querySelectorAll<HTMLElement>('[data-unit-action]')].find((node) => node.dataset.unitAction === selected);
    setSlot(first ? document.getElementById(first.getAttribute('aria-controls') || '') : null);
  }, [selected, highlighted, rendered]);

  useEffect(() => {
    const root = rootRef.current;
    root?.querySelectorAll('.rp-evidence').forEach((node) => node.replaceWith(...node.childNodes));
    setEvidenceReady(false);
    if (!root || !rendered || !evidenceSelection) return;
    let disposed = false;
    void (async () => {
      const evidence = evidenceSelection.evidence;
      // This check also works for a passage with evidence but no aligned units.
      const revision = { source_sha256: evidence.source_sha256, translation_sha256: support?.translation_sha256 };
      const valid = rendered.hash === evidence.source_sha256 || await matchesSupportRevision(revision, body, translation);
      if (disposed || !valid) return;
      const blocks = [...root.querySelectorAll('p,li,td')].filter((node) => !node.closest('.rp-slot,.rp-actions'));
      const block = blocks.find((node) => markQuote(node, evidence.source, { class: 'rp-evidence' }));
      if (!block) return;
      setEvidenceReady(true);
      const selectedUnit = units.find((item) => item.source.includes(evidence.source) || evidence.source.includes(item.source));
      if (selectedUnit) { setSelected(selectedUnit.id); setHighlighted(null); }
      root.querySelector('.rp-evidence')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    })();
    return () => { disposed = true; };
  }, [evidenceSelection, rendered]);

  const activate = (target: Element) => {
    if (window.getSelection()?.toString() && !target.closest('[data-unit-action]')) return;
    const entry = target.closest<HTMLElement>('[data-glossary-index]');
    if (entry) { onGlossary(Number(entry.dataset.glossaryIndex)); return; }
    const image = target.closest('img');
    if (image?.src) { onZoom(image.src, image.alt); return; }
    const action = target.closest<HTMLElement>('[data-unit-action]');
    if (action?.dataset.unitAction) { select(action.dataset.unitAction); return; }
    const phrase = target.closest<HTMLElement>('[data-phrase-index]');
    const source = target.closest<HTMLElement>('[data-unit-id]');
    if (source?.dataset.unitId) select(source.dataset.unitId, phrase ? Number(phrase.dataset.phraseIndex) : null);
  };
  return <>
    <p className="rp-hint">{units.length ? 'Bấm vào câu để xem dịch. Bấm cụm từ trong bản dịch để đối chiếu với tiếng Anh.'
      : translation ? 'Bài này có bản dịch đầy đủ; liên kết theo câu đang được biên soạn.' : 'Bài này chưa có bản dịch.'}</p>
    {rendered?.figures.map((figure) => <PracticeFigure figure={figure} onZoom={onZoom} key={figure.src} />)}
    <div className="rv-passage__body md-body" ref={rootRef}
      onClick={(event) => { if (event.target instanceof Element) activate(event.target); }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.matches('img[role="button"]')) {
          event.preventDefault(); activate(event.target);
        }
      }}>
      {rendered ? <SourceHtml html={rendered.html} /> : <p>{body}</p>}
    </div>
    {unit && slot && createPortal(<section className="rp-translation" aria-label={`Dịch ${unit.precision === 'paragraph' ? 'đoạn' : 'câu'} ${index + 1}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="rp-translation__head"><strong>{unit.precision === 'paragraph' ? 'Dịch đoạn' : 'Dịch câu'} {index + 1}</strong>
        <button type="button" aria-label="Đóng bản dịch tại chỗ" onClick={close}>Đóng</button></div>
      <LinkedTranslation unit={unit} highlighted={highlighted} onHighlight={setHighlighted} />
      {Boolean(unit.phrases?.length) && <div className="rp-phrase-actions" role="group" aria-label="Đối chiếu cụm tiếng Anh">
        {(unit.phrases || []).map((phrase, phraseIndex) => <button type="button" lang="en" key={phraseIndex}
          aria-pressed={highlighted === phraseIndex} onClick={() => setHighlighted(phraseIndex)}>{phrase.source}</button>)}
      </div>}
      {highlighted !== null && unit.phrases?.[highlighted] && <p className="rp-pair" role="status"><span lang="en">{unit.phrases?.[highlighted].source}</span> ↔ {unit.phrases?.[highlighted].target}</p>}
      <div className="rp-translation__nav">
        <button type="button" disabled={index === 0} onClick={() => navigate(units[index - 1].id)}>← Câu trước</button>
        <button type="button" disabled={index === units.length - 1} onClick={() => navigate(units[index + 1].id)}>Câu sau →</button>
      </div>
    </section>, slot)}
    {evidenceSelection && <section className="rp-evidence-panel" aria-label={`Căn cứ câu ${evidenceSelection.qNum}`}>
      <p role="status">{evidenceReady ? `Đã làm sáng câu trích dẫn cho câu hỏi ${evidenceSelection.qNum}.` : 'Chưa định vị được trích dẫn trong bản bài hiện tại.'}</p>
      <button type="button" onClick={() => onReturn(evidenceSelection.qNum)}>Trở lại câu {evidenceSelection.qNum}</button>
      {evidenceReady && (evidenceSelection.evidence.illustrations || []).map((figure) => <PracticeFigure figure={figure} onZoom={onZoom} key={figure.src} />)}
    </section>}
  </>;
}
