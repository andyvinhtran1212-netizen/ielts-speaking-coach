'use client';

import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListeningSourceBlock } from '@/components/listening-source-block';
import { ListeningSourceSupplement } from '@/components/listening-source-supplement';
import { ListeningSourceAudio } from '@/components/listening-source-audio';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import { sourceCollectionContext, sourceCollectionHref, sourceDayHref } from '@/lib/listening-source-collection-api';
import type { ListeningSourceDayWire } from '@/lib/listening-source-collection-api';
import { useListeningSource } from '@/lib/use-listening-source';
import { useAuth } from '@/lib/auth/auth-provider';
import { SourceLoadError } from '../source-collection';

export function ListeningSourceDay({ day }: { day: number }) {
  const context = sourceCollectionContext(useSearchParams());
  const { status, user } = useAuth();
  const { state, retry } = useListeningSource<ListeningSourceDayWire>(`/api/listening/source-collections/80-days/days/${day}`);
  return <main className="source-shell">
    <a className="source-back" href={sourceCollectionHref(context)}>← 80 ngày Listening</a>
    {state.status === 'loading' ? <p className="source-notice" role="status">Đang tải ngày {day}…</p> : state.status === 'error' ? <SourceLoadError code={state.code} retry={retry} /> : <DayWorkspace key={JSON.stringify([day, status, user?.id, state.data.manifest_sha256])} data={state.data} />}
    <nav className="source-day-navigation" aria-label="Chuyển ngày">{day > 1 ? <a href={sourceDayHref(day - 1, context)}>← Ngày {day - 1}</a> : <span />}{day < 80 ? <a href={sourceDayHref(day + 1, context)}>Ngày {day + 1} →</a> : null}</nav>
  </main>;
}

function DayWorkspace({ data }: { data: ListeningSourceDayWire }) {
  const parts = data.parts.filter((part) => part.source_position_count > 0);
  const first = parts[0]?.part_id || '';
  const [selected, setSelected] = useState(first);
  const [visited, setVisited] = useState(() => new Set([first]));
  const tabs = useRef<HTMLDivElement>(null);
  function choose(id: string) { setSelected(id); setVisited((current) => new Set([...current, id])); }
  const groups = data.vocabulary_groups || [];
  return <>
    <header className="source-hero"><p className="source-kicker">Ngày {data.day}/80</p><h1>{data.title}</h1><p>{groups.length ? 'Nghe và học từ vựng theo chủ đề.' : `${data.source_position_count} câu luyện${data.response_field_count && data.response_field_count !== data.source_position_count ? ` · ${data.response_field_count} ô trả lời` : ''}`}</p></header>
    {data.partial_data ? <p className="source-notice" role="status">Tiến độ chưa tải đầy đủ. Bạn vẫn có thể làm bài đã xuất bản.</p> : null}
    {data.source_only_count ? <p className="source-notice">{data.source_only_count} câu tự luyện có ghi chú giới hạn, chưa chấm đúng/sai. Nội dung được hiển thị trong từng Part.</p> : null}
    {parts.length && !parts.some((part) => part.form) ? <ListeningSourceAudio key={selected} day={data.day} /> : null}
    {parts.length ? <>
      <link rel="stylesheet" href="/css/listening-programme-runner.css" />
      <div ref={tabs} className="source-part-tabs" role="tablist" aria-label="Chọn phần luyện nghe">{parts.map((part, index) => <button type="button" key={part.part_id} id={`source-tab-${index}`} role="tab" aria-controls={`source-panel-${index}`} aria-selected={selected === part.part_id} tabIndex={selected === part.part_id ? 0 : -1} onClick={() => choose(part.part_id)} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + parts.length) % parts.length;
        choose(parts[next].part_id); tabs.current?.querySelectorAll('button')[next]?.focus();
      }}>{part.source_label} <span>{part.source_position_count} câu</span></button>)}</div>
      {parts.map((part, index) => <section key={part.part_id} id={`source-panel-${index}`} role="tabpanel" aria-labelledby={`source-tab-${index}`} hidden={selected !== part.part_id}>{visited.has(part.part_id) ? part.form ? <ProgrammeFormRunner testId={part.form.id} active={selected === part.part_id} embedded manifest={data.manifest_sha256} sourceBlocks={data.blocks.filter((block) => block.part_id === part.part_id && block.display_kind === 'practice')} supplements={(data.supplemental_questions || []).filter((question) => question.part_id === part.part_id)} /> : <>
        {parts.some((part) => part.form) ? <ListeningSourceAudio day={data.day} active={selected === part.part_id} /> : null}
        {data.blocks.filter((block) => block.part_id === part.part_id && block.display_kind === 'practice').map((block) => <section key={block.block_id}><ListeningSourceBlock block={block} showQuestions={false} />{(data.supplemental_questions || []).filter((question) => question.block_id === block.block_id).map((question) => <ListeningSourceSupplement key={question.item_id} question={question} manifest={data.manifest_sha256} active={selected === part.part_id} />)}</section>)}
      </> : null}</section>)}
    </> : <><ListeningSourceAudio day={data.day} />{!groups.length ? <p className="source-notice" role="status">Buổi này chưa có bài tập đủ dữ kiện để mở luyện. Bạn vẫn có thể nghe audio.</p> : null}</>}
    {groups.length ? <section className="source-vocabulary" aria-label="Từ vựng theo chủ đề">{groups.map((group, index) => <section key={index}><h2>{group.title}</h2><dl>{(group.terms || []).map((term, termIndex) => <div key={termIndex}><dt lang="en">{term.term}{term.related_terms?.length ? <small>{term.related_terms.join(' · ')}</small> : null}</dt><dd>{term.meaning_vi || 'Chưa có nghĩa tiếng Việt.'}</dd></div>)}</dl></section>)}</section> : null}
  </>;
}
