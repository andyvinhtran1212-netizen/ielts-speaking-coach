'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListeningSourceBlock } from '@/components/listening-source-block';
import { ListeningSourceExplanation } from '@/components/listening-source-explanation';
import { sourceAudioLabel, sourceReviewLabel, sourceCollectionContext, sourceCollectionHref, sourceDayHref } from '@/lib/listening-source-collection-api';
import type { ListeningSourceDayWire, ListeningSourceStudyWire } from '@/lib/listening-source-collection-api';
import { useListeningSource } from '@/lib/use-listening-source';
import { useAuth } from '@/lib/auth/auth-provider';
import { SourceLoadError } from '../source-collection';

export function ListeningSourceDay({ day }: { day: number }) {
  const context = sourceCollectionContext(useSearchParams());
  const { status: authStatus, user } = useAuth();
  const scope = `${day}:${authStatus === 'signed-in' ? user?.id || '' : ''}`;
  const { state, retry } = useListeningSource<ListeningSourceDayWire>(`/api/listening/source-collections/80-days/days/${day}`);
  const [studyState, setStudyState] = useState<{ scope: string; status: 'idle' | 'loading' | 'error'; data: ListeningSourceStudyWire | null }>({ scope, status: 'idle', data: null });
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const studyRequest = useRef<AbortController | null>(null);
  const study = studyState.scope === scope ? studyState.data : null;
  const studyStatus = studyState.scope === scope ? studyState.status : 'idle';
  useEffect(() => {
    setStudyState({ scope, status: 'idle', data: null });
    return () => { studyRequest.current?.abort(); studyRequest.current = null; };
  }, [scope]);
  async function openStudy(blockIds: string[]) {
    if (studyStatus === 'loading' || authStatus !== 'signed-in' || !user?.id) return;
    studyRequest.current?.abort();
    const controller = new AbortController(); studyRequest.current = controller;
    const current = () => !controller.signal.aborted && studyRequest.current === controller && scopeRef.current === scope;
    setStudyState({ scope, status: 'loading', data: null });
    try {
      const result = await window.api.postWith<ListeningSourceStudyWire>(`/api/listening/source-collections/80-days/days/${day}/study`, { block_ids: blockIds }, undefined, { signal: controller.signal });
      if (current()) setStudyState({ scope, status: 'idle', data: result });
    } catch { if (current()) setStudyState({ scope, status: 'error', data: null }); }
  }
  const data = state.status === 'ready' ? state.data : null;
  const vocabularyGroups = data?.vocabulary_groups || [];
  const sourceOnlyPositions = data?.source_only_positions || [];
  const studyIds = data?.blocks.filter((block) => block.display_kind === 'source_study' || block.study_available === true).map((block) => block.block_id) || [];
  return <main className="source-shell">
    <a className="source-back" href={sourceCollectionHref(context)}>← 80 ngày Listening</a>
    {state.status === 'loading' ? <p className="source-notice" role="status">Đang tải ngày {day}…</p> : state.status === 'error' ? <SourceLoadError code={state.code} retry={retry} /> : data ? <>
      <header className="source-hero"><p className="source-kicker">Ngày {data.day}/80</p><h1>{data.title}</h1><span className="source-badge">{sourceAudioLabel(data.availability.audio)}</span><p>{data.group === 'vocabulary' ? 'Học từ vựng theo nhóm. Nghĩa tiếng Việt bổ sung được gắn nhãn biên tập, không phải đáp án in của sách.' : `${data.practice_item_count} câu có thể luyện; nguồn có ${data.source_position_count} vị trí câu hỏi.`}</p></header>
      {data.partial_data ? <p className="source-notice" role="status">Tiến độ chưa tải đầy đủ. Bạn vẫn có thể mở nội dung đã xuất bản.</p> : null}
      {data.availability.audio === 'partial' ? <p className="source-notice">Audio chỉ có một phần. Các phần có audio mới mở được lượt luyện; phần còn lại được giữ dưới dạng tài liệu.</p> : data.availability.audio === 'missing' ? <p className="source-notice">Nguồn chưa có audio cho ngày này. Bạn có thể học tài liệu có sẵn bên dưới.</p> : null}
      {data.parts.length ? <section className="source-parts" aria-label="Các phần trong ngày">{data.parts.map((part) => <article className="source-part" key={part.part_id}><div><h2>{part.source_label}</h2><p>{part.item_count} câu có thể luyện / {part.source_position_count} vị trí nguồn</p>{part.form && part.timing_granularity === 'whole_day' ? <p>Nghe audio toàn ngày; chưa có mốc tách riêng phần này.</p> : null}</div>{part.form ? <a className="source-action" href={part.form.href}>{part.form.status === 'completed' ? 'Xem lại' : part.form.status === 'in_progress' ? 'Tiếp tục luyện' : 'Bắt đầu luyện'} →</a> : <span className="source-badge">{sourceAudioLabel(part.audio_status)} · Chỉ xem tài liệu</span>}</article>)}</section> : null}
      {vocabularyGroups.length ? <section className="source-vocabulary" aria-label="Từ vựng theo chủ đề">{vocabularyGroups.map((group, index) => <section key={index}><h2>{group.title}</h2>{group.editorial_note_vi ? <p className="source-notice">{group.editorial_note_vi}</p> : null}{group.source_layout_note_vi ? <p>{group.source_layout_note_vi}</p> : null}<dl>{(group.terms || []).map((term, termIndex) => <div key={termIndex}><dt lang="en">{term.term}{term.related_terms?.length ? <small>{term.related_terms.join(' · ')}</small> : null}</dt><dd>{term.meaning_vi || 'Nguồn để trống phần nghĩa.'}{term.editorial ? <small>Nghĩa biên tập bổ sung</small> : null}</dd></div>)}</dl></section>)}</section> : null}
      {data.blocks.filter((block) => block.display_kind !== 'source_study').length ? <section className="source-day-blocks"><h2>Đề và tài liệu nguồn</h2>{data.blocks.filter((block) => block.display_kind !== 'source_study').map((block) => <ListeningSourceBlock key={block.block_id} block={block} />)}</section> : null}
      {sourceOnlyPositions.length ? <details className="source-limitations"><summary>{data.source_only_count} vị trí chưa mở luyện — xem lý do</summary><ul>{sourceOnlyPositions.map((position) => <li key={position.item_id}><strong>Câu {position.source_display_number} · {sourceReviewLabel(position.review_status)}</strong><p>{position.reason_vi}</p></li>)}</ul></details> : null}
      {studyIds.length ? <section className="source-study"><h2>Tài liệu tự học</h2><p>Tài liệu có thể gồm ví dụ đã giải hoặc nội dung thiếu audio. Mở tài liệu không tạo lượt luyện và không được tính là làm bài độc lập.</p>{!study ? <button type="button" className="source-action" disabled={studyStatus === 'loading'} onClick={() => void openStudy(studyIds)}>{studyStatus === 'loading' ? 'Đang mở tài liệu…' : studyStatus === 'error' ? 'Thử mở lại tài liệu' : 'Mở tài liệu tự học'}</button> : null}{studyStatus === 'error' ? <p role="alert">Chưa mở được tài liệu. Hãy thử lại.</p> : null}{study ? <><p className="source-notice">Đang xem tài liệu có lời giải · không phải lượt làm độc lập.</p>{study.blocks.map((block) => <article key={block.block_id}><ListeningSourceBlock block={block} />{block.items?.map((item) => <div key={item.item_id}><h3>Câu {item.source_display_number}</h3><ListeningSourceExplanation explanation={item.explanation} reviewStatus={item.review_status} provenance={item.answer_provenance} /></div>)}{block.transcript?.length ? <details><summary>Văn bản gốc của tài liệu</summary>{block.transcript.map((entry, index) => <p key={index} lang={/\p{Script=Han}/u.test(entry.quote) ? 'zh' : 'en'}>{entry.quote}</p>)}</details> : null}</article>)}</> : null}</section> : null}
      <nav className="source-day-navigation" aria-label="Chuyển ngày">{day > 1 ? <a href={sourceDayHref(day - 1, context)}>← Ngày {day - 1}</a> : <span />}{day < 80 ? <a href={sourceDayHref(day + 1, context)}>Ngày {day + 1} →</a> : null}</nav>
    </> : null}
  </main>;
}
