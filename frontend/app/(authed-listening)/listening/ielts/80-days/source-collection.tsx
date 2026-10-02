'use client';

import { useSearchParams } from 'next/navigation';
import { SOURCE_COLLECTION_PATH, sourceAudioLabel, sourceCollectionContext, sourceCollectionHref, sourceDayHref } from '@/lib/listening-source-collection-api';
import type { ListeningSourceCollectionWire } from '@/lib/listening-source-collection-api';
import { useListeningSource } from '@/lib/use-listening-source';

export function SourceLoadError({ code, retry }: { code: number; retry: () => void }) {
  return <section className="source-notice is-error" role="alert"><p>{code === 403 ? 'Bạn chưa có quyền mở nội dung này.' : code === 404 ? 'Bộ nội dung chưa được xuất bản hoặc hiện không còn khả dụng.' : 'Chưa tải được nội dung. Hãy thử lại.'}</p><button type="button" onClick={retry}>Thử lại</button><a href="/listening/ielts">Về IELTS Listening</a></section>;
}

export function ListeningSourceEntry() {
  const { state, retry } = useListeningSource<ListeningSourceCollectionWire>('/api/listening/source-collections/80-days');
  if (state.status === 'error' && state.code === 404) return null;
  return <section className="source-entry" aria-label="Bộ luyện 80 ngày"><link rel="stylesheet" href="/css/listening-source-collection.css" />
    {state.status === 'loading' ? <p role="status">Đang kiểm tra bộ luyện 80 ngày…</p> : state.status === 'error' ? <><p role="status">Chưa tải được bộ luyện 80 ngày.</p><button type="button" onClick={retry}>Thử lại</button></> : <a href={SOURCE_COLLECTION_PATH}><div><p className="source-kicker">Bộ luyện theo sách</p><h2>80 ngày Listening</h2><p>Luyện ngắn · Kỹ năng · Từ vựng · Đề mô phỏng. Mỗi ngày hiển thị rõ phần nội dung có sẵn.</p></div><span aria-hidden="true">Mở bộ luyện →</span></a>}
  </section>;
}

export function ListeningSourceCollection() {
  const { state, retry } = useListeningSource<ListeningSourceCollectionWire>('/api/listening/source-collections/80-days');
  const { group, query } = sourceCollectionContext(useSearchParams());
  const setGroup = (next: string) => window.history.replaceState(null, '', sourceCollectionHref({ group: next, query }));
  const setQuery = (next: string) => window.history.replaceState(null, '', sourceCollectionHref({ group, query: next }));
  const groups = state.status === 'ready' ? state.data.groups : [];
  const visible = groups.filter((value) => group === 'all' || value.id === group).map((value) => ({ ...value, days: value.days.filter((day) => !query.trim() || String(day.day) === query.trim() || day.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }));
  return <main className="source-shell">
    <a className="source-back" href="/listening/ielts">← IELTS Listening Practice</a>
    <header className="source-hero"><p className="source-kicker">Luyện theo ngày</p><h1>80 ngày Listening</h1><p>Chọn một ngày để luyện nghe hoặc học tài liệu. Đề và lời giải giữ nguồn đối chiếu; phần thiếu được ghi rõ.</p><div className="source-notice">Bài luyện tự đối chiếu, không quy đổi band IELTS. Đáp án chưa xác minh không được chấm đúng/sai tự động.</div></header>
    {state.status === 'loading' ? <p className="source-notice" role="status">Đang tải các ngày học…</p> : state.status === 'error' ? <SourceLoadError code={state.code} retry={retry} /> : <>
      {state.data.partial_data ? <p className="source-notice" role="status">Tiến độ hiện chưa tải đầy đủ. Nội dung bên dưới vẫn là bản đã xuất bản.</p> : null}
      <div className="source-filters"><nav aria-label="Nhóm nội dung"><button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>Tất cả</button>{groups.map((value) => <button type="button" key={value.id} aria-pressed={group === value.id} onClick={() => setGroup(value.id)}>{value.title}</button>)}</nav><label>Tìm ngày<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Số ngày hoặc tên bài" /></label></div>
      {visible.every((value) => value.days.length === 0) ? <p className="source-notice" role="status">Không có ngày học khớp với tìm kiếm.</p> : null}
      {visible.filter((value) => value.days.length).map((value) => <section className="source-group" key={value.id}><h2>{value.title}</h2><div className="source-day-grid">{value.days.map((day) => <a className="source-day-card" href={sourceDayHref(day.day, { group, query })} key={day.lesson_id}><header><span>Ngày {day.day}</span><span className="source-badge" data-warning={day.availability.audio === 'missing' || day.availability.audio === 'partial'}>{sourceAudioLabel(day.availability.audio)}</span></header><h3>{day.title}</h3><p>{day.group === 'vocabulary' ? 'Từ vựng theo chủ đề · tài liệu học' : `${day.practice_item_count} câu có thể luyện · ${day.source_position_count} vị trí trong nguồn`}</p>{day.source_only_count > 0 ? <p className="source-day-card__limitation">{day.source_only_count} vị trí chỉ xem tài liệu / chưa đủ dữ kiện</p> : null}<footer>{day.form_count > 0 ? <span>{day.completed_form_count}/{day.form_count} phần đã hoàn thành{day.in_progress_form_count > 0 ? ' · Đang luyện' : ''}</span> : <span>Tài liệu học</span>}<strong>Mở ngày →</strong></footer></a>)}</div></section>)}
    </>}
  </main>;
}
