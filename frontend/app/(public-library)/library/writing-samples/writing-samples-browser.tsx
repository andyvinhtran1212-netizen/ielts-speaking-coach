'use client';

// Filters, list and states of `/library/writing-samples` (LIBRARY-0061 T009).
//
// The server already rendered the list for `query`. A filter change replaces
// the URL (no new history entry) and the server renders again; while that
// runs, the list area keeps exactly 12 placeholder rows so the page does not
// jump (FR-011). The search box waits 300 ms after the last keystroke
// (FR-010). Every filter change goes back to page 1; Task 1 disables and
// drops the question type. A signed-in reader also gets the "Của bạn"
// column (T016, FR-060): their own "Đã đọc" / "Đã lưu" marks, always in
// words, in place of the topic column (sheet BaiMauWritingDanhSach §4).
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Button, PageState, Pagination } from '@/components/ui';
import { MARKS_LOAD_ERROR, useLibraryMarks } from '@/components/library/use-library-marks';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  PAGE_SIZE,
  QUESTION_TYPES,
  SEARCH_DEBOUNCE_MS,
  Q_MAX_LENGTH,
  activeChips,
  changeListQuery,
  clearedQuery,
  countText,
  hasFilters,
  listHref,
  questionTypeLabel,
  rowNumber,
  totalPages,
} from '@/lib/writing-samples-list-model.mjs';

import styles from './writing-samples.module.css';

export type ListQuery = {
  task: 'task2' | 'task1' | null;
  dang: string | null;
  chude: string | null;
  q: string;
  trang: number;
};

export type SampleListItem = {
  slug: string;
  title_en: string | null;
  task: 'task2' | 'task1' | null;
  question_type: string | null;
  question_type_label: string | null;
  task1_subtype?: string | null;
  topic_slug: string | null;
  prompt_text: string | null;
};

export type SampleList = {
  items: SampleListItem[];
  total: number;
  page: number;
  page_size: number;
  facets?: { task?: Record<string, number>; question_type?: Record<string, number>; topic?: Record<string, number> };
  topics?: { slug: string; label_vi: string | null }[];
};

/** `topic-gone`: the link named a topic the API no longer has; the list shows every topic. */
export type ListNotice = 'topic-gone' | null;

type Props = {
  query: ListQuery;
  notice?: ListNotice;
  /** `null`: the list could not be read (error state, filters kept). */
  data: SampleList | null;
  /** True once the sample page (T010) is served; rows link to it only then. */
  detailLive: boolean;
};

function SkeletonRows() {
  return (
    <ol className={styles.rows} aria-hidden="true" data-testid="list-skeleton">
      {Array.from({ length: PAGE_SIZE }, (_, i) => (
        <li key={i} className={`${styles.row} ${styles.skeletonRow}`}>
          <span className={styles.skeletonBar} />
        </li>
      ))}
    </ol>
  );
}

/** Loading state of the list area: 12 placeholder rows plus a spoken status. */
export function WritingSamplesSkeleton() {
  return (
    <div className={styles.layout}>
      <div />
      <section className={styles.results} aria-busy="true">
        <p role="status" className={styles.count}>Đang tải danh sách đề…</p>
        <SkeletonRows />
      </section>
    </div>
  );
}

function plural(count: number | undefined): string {
  return typeof count === 'number' ? count.toLocaleString('vi-VN') : '';
}

export function WritingSamplesBrowser({ query, data, notice = null, detailLive }: Props) {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const marks = useLibraryMarks('writing_sample', { signedIn: authStatus === 'signed-in' });
  // The column shows once the reader is signed in, and goes away if the
  // server ends the session (`signed-out`) or never had one (`idle`).
  const mine = marks.status === 'loading' || marks.status === 'ready' || marks.status === 'error';
  const [pending, startTransition] = useTransition();
  // What the filters show: the server's query, or the change being applied.
  const [shown, setShown] = useState<ListQuery>(query);
  const [text, setText] = useState(query.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useId();

  // The server answered for a new URL (navigation, back button): follow it.
  // The search text is left alone while the reader is typing in it.
  useEffect(() => {
    setShown(query);
    if (document.activeElement !== searchRef.current) setText(query.q);
  }, [query]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function go(next: ListQuery) {
    setShown(next);
    startTransition(() => router.replace(listHref(next), { scroll: false }));
  }

  function change(patch: Partial<ListQuery>) {
    // A search still inside its 300 ms wait goes along with the filter change
    // instead of being dropped; an explicit q in the patch (its chip) wins.
    const pendingSearch = timer.current ? { q: text } : {};
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    go(changeListQuery(shown, { ...pendingSearch, ...patch }) as ListQuery);
  }

  function typed(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (value.trim() !== shown.q) go(changeListQuery(shown, { q: value }) as ListQuery);
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current);
    setText('');
    go(clearedQuery() as ListQuery);
  }

  function reload() {
    startTransition(() => router.refresh());
  }

  const facets = data?.facets;
  const topics = data?.topics ?? [];
  const taskCounts = facets?.task;
  const allCount = taskCounts ? (taskCounts.task2 ?? 0) + (taskCounts.task1 ?? 0) : undefined;
  const typeDisabled = shown.task === 'task1';
  const chips = activeChips(shown, topics);
  const filterCount = chips.length;
  const pages = data ? totalPages(data.total) : 1;
  const topicLabel = (slug: string | null) => topics.find((t) => t.slug === slug)?.label_vi ?? null;

  const taskOptions: { value: ListQuery['task']; label: string; count?: number }[] = [
    { value: null, label: 'Tất cả', count: allCount },
    { value: 'task2', label: 'Task 2', count: taskCounts ? taskCounts.task2 ?? 0 : undefined },
    { value: 'task1', label: 'Task 1', count: taskCounts ? taskCounts.task1 ?? 0 : undefined },
  ];

  let list: ReactNode;
  if (pending) {
    list = (
      <>
        <p role="status" className={styles.count}>Đang tải danh sách đề…</p>
        <SkeletonRows />
      </>
    );
  } else if (!data) {
    list = (
      <PageState
        kind="error"
        label="Tải lỗi"
        title="Chưa tải được danh sách đề"
        body="Máy chủ không trả lời. Bộ lọc bạn chọn vẫn được giữ."
        action={<Button variant="secondary" onClick={reload}>Tải lại</Button>}
      />
    );
  } else if (data.total === 0 || data.items.length === 0) {
    const scope = shown.dang ? ` trong dạng ${questionTypeLabel(shown.dang)}` : '';
    list = (
      <PageState
        kind="empty"
        label="Không có kết quả"
        title={shown.q ? `Không có đề nào khớp “${shown.q}”${scope}` : 'Không có đề nào khớp bộ lọc'}
        body={
          shown.q
            ? 'Thử một từ ngắn hơn hoặc từ đồng nghĩa, ví dụ “job” thay cho “employment”. Bộ lọc đang bật cũng có thể làm danh sách hẹp lại.'
            : 'Bỏ bớt một bộ lọc để xem thêm đề.'
        }
        action={hasFilters(shown) ? <Button variant="secondary" onClick={clearAll}>Bỏ mọi bộ lọc</Button> : undefined}
      />
    );
  } else {
    list = (
      <>
        {marks.status === 'error' ? (
          <p role="status" className={styles.notice}>
            {MARKS_LOAD_ERROR}{' '}
            <button type="button" className={styles.clearAll} onClick={marks.reload}>Thử lại</button>
          </p>
        ) : null}
        <div className={mine ? `${styles.head} ${styles.withMine}` : styles.head} aria-hidden="true">
          <span>Số</span>
          <span>Tiêu đề · đề bài</span>
          <span>Dạng đề</span>
          <span>{mine ? 'Của bạn' : 'Chủ đề'}</span>
        </div>
        <ol className={styles.rows} start={rowNumber(data.page, 0)}>
          {data.items.map((item, index) => {
            const kind = item.task === 'task1' ? 'Task 1' : item.question_type_label ?? '';
            const read = mine && marks.has(item.slug, 'read');
            const saved = mine && marks.has(item.slug, 'saved');
            const words = [saved ? 'Đã lưu' : null, read ? 'Đã đọc' : null].filter(Boolean);
            const body = (
              <>
                <span className={styles.no}>{rowNumber(data.page, index)}</span>
                <span className={styles.main}>
                  <strong lang="en" className={styles.title}>{item.title_en || item.slug}</strong>
                  {item.prompt_text ? <span lang="en" className={styles.prompt}>{item.prompt_text}</span> : null}
                </span>
                <span lang="en" className={styles.kind}>{kind}</span>
                {mine
                  ? <span className={styles.mine}>{words.join(' · ')}</span>
                  : <span className={styles.topic}>{topicLabel(item.topic_slug) ?? ''}</span>}
              </>
            );
            return (
              <li key={item.slug} className={styles.row}>
                {detailLive
                  ? <a className={mine ? `${styles.rowLink} ${styles.withMine}` : styles.rowLink} href={`/library/writing-samples/${encodeURIComponent(item.slug)}`}>{body}</a>
                  : <div className={mine ? `${styles.rowLink} ${styles.withMine}` : styles.rowLink}>{body}</div>}
              </li>
            );
          })}
        </ol>
        <Pagination
          page={data.page}
          totalPages={pages}
          totalLabel={`${plural(data.total)} đề`}
          hrefFor={(page) => listHref(changeListQuery(shown, { trang: page }))}
          className={styles.pagination}
        />
      </>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.filterColumn}>
        <label htmlFor={`${ids}-q`} className={styles.label}>Tìm trong đề</label>
        <input
          ref={searchRef}
          id={`${ids}-q`}
          type="search"
          className={styles.search}
          value={text}
          maxLength={Q_MAX_LENGTH}
          onChange={(event) => typed(event.target.value)}
          aria-describedby={`${ids}-q-hint`}
        />
        <p id={`${ids}-q-hint`} className={styles.hint}>Tìm theo chữ trong tiêu đề và câu đề tiếng Anh.</p>

        <button
          type="button"
          className={styles.filterToggle}
          aria-expanded={filtersOpen}
          aria-controls={`${ids}-filters`}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Bộ lọc{filterCount ? ` · ${filterCount}` : ''}
        </button>

        <div id={`${ids}-filters`} className={filtersOpen ? `${styles.filters} ${styles.filtersOpen}` : styles.filters}>
          <fieldset className={styles.group}>
            <legend className={styles.label}>Task</legend>
            {taskOptions.map((option) => (
              <label key={option.label} className={styles.option}>
                <input
                  type="radio"
                  name={`${ids}-task`}
                  checked={shown.task === option.value}
                  onChange={() => change({ task: option.value })}
                />
                <span>{option.label}</span>
                {typeof option.count === 'number' ? <span className={styles.optionCount}>{plural(option.count)}</span> : null}
              </label>
            ))}
          </fieldset>

          <fieldset className={styles.group} disabled={typeDisabled} aria-describedby={`${ids}-type-hint`}>
            <legend className={styles.label}>Dạng đề · Task 2</legend>
            <label className={styles.option}>
              <input type="radio" name={`${ids}-dang`} checked={!shown.dang} onChange={() => change({ dang: null })} />
              <span>Tất cả</span>
              <span className={styles.gloss}>mọi dạng Task 2</span>
            </label>
            {QUESTION_TYPES.map((type: { code: string; label: string; gloss: string }) => (
              <label key={type.code} className={styles.option}>
                <input
                  type="radio"
                  name={`${ids}-dang`}
                  checked={shown.dang === type.code}
                  onChange={() => change({ dang: type.code })}
                />
                <span lang="en">{type.label}</span>
                <span className={styles.gloss}>{type.gloss}</span>
                {facets?.question_type && !typeDisabled
                  ? <span className={styles.optionCount}>{plural(facets.question_type[type.code] ?? 0)}</span>
                  : null}
              </label>
            ))}
            <p id={`${ids}-type-hint`} className={styles.hint}>Dạng đề chỉ áp dụng cho Task 2.</p>
          </fieldset>

          <div className={styles.group}>
            <label htmlFor={`${ids}-topic`} className={styles.label}>Chủ đề</label>
            <select
              id={`${ids}-topic`}
              className={styles.select}
              value={shown.chude ?? ''}
              onChange={(event) => change({ chude: event.target.value || null })}
            >
              <option value="">Tất cả chủ đề</option>
              {shown.chude && !topics.some((t) => t.slug === shown.chude)
                ? <option value={shown.chude}>{shown.chude}</option>
                : null}
              {topics.map((topic) => {
                const count = facets?.topic?.[topic.slug];
                return (
                  <option key={topic.slug} value={topic.slug}>
                    {topic.label_vi || topic.slug}{typeof count === 'number' ? ` (${plural(count)})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <section className={styles.results} aria-label="Danh sách đề" aria-busy={pending || undefined}>
        {notice === 'topic-gone' && !pending ? (
          <p role="status" className={styles.notice}>Chủ đề này không còn. Danh sách đang hiện đề của mọi chủ đề.</p>
        ) : null}
        {!pending && data ? (
          <div className={styles.summary}>
            <p className={styles.count}>{countText(data.total, shown)}</p>
            {chips.length ? (
              <ul className={styles.chips} aria-label="Bộ lọc đang bật">
                {chips.map((chip: { key: string; label: string; change: Partial<ListQuery> }) => (
                  <li key={chip.key}>
                    <button
                      type="button"
                      className={styles.chip}
                      aria-label={`Bỏ lọc ${chip.label}`}
                      onClick={() => {
                        if (chip.key === 'q') setText('');
                        change(chip.change);
                      }}
                    >
                      {chip.label} <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className={styles.clearAll} onClick={clearAll}>Bỏ mọi bộ lọc</button>
                </li>
              </ul>
            ) : null}
          </div>
        ) : null}
        {list}
      </section>
    </div>
  );
}
