'use client';

// Filter bar of `/library/speaking` (LIBRARY-0061 T013, FR-030; tờ
// DeSpeakingDanhSach §1, §4). Every filter lives in the URL (`part`, `chude`,
// `video`, `q`) so a filtered list can be shared; the server page renders the
// list for that URL. Part and topic are plain links (they work before the
// script loads); the video switch and the search box replace the URL, the
// search 300 ms after typing stops.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { filterQuery, PARTS, Q_MAX } from './speaking-list-model.mjs';
import styles from './speaking.module.css';

export type Filters = { part: string | null; chude: string | null; video: boolean; q: string };

const DEBOUNCE_MS = 300;
const BASE = '/library/speaking';

export function SpeakingFilters({ filters }: { filters: Filters }) {
  const router = useRouter();
  const [text, setText] = useState(filters.q);
  const latest = useRef(filters);
  latest.current = filters;

  // The URL changed from elsewhere (a link, back button): follow it.
  useEffect(() => setText(filters.q), [filters.q]);

  useEffect(() => {
    const value = text.trim().slice(0, Q_MAX);
    if (value === latest.current.q) return undefined;
    const timer = setTimeout(() => {
      router.replace(`${BASE}${filterQuery({ ...latest.current, q: value })}`, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, router]);

  return (
    <div className={styles.filters}>
      <nav aria-label="Lọc theo Part" className={styles.parts}>
        {[null, ...PARTS].map((part) => {
          const on = filters.part === part;
          return (
            <a
              key={part ?? 'all'}
              href={`${BASE}${filterQuery({ ...filters, part })}`}
              aria-current={on ? 'true' : undefined}
              className={on ? `${styles.partLink} ${styles.partOn}` : styles.partLink}
            >
              {part ? `Part ${part}` : 'Tất cả'}
            </a>
          );
        })}
      </nav>
      <button
        type="button"
        role="switch"
        aria-checked={filters.video}
        className={styles.switch}
        onClick={() => router.replace(`${BASE}${filterQuery({ ...filters, video: !filters.video })}`, { scroll: false })}
      >
        <span aria-hidden="true" className={filters.video ? `${styles.knob} ${styles.knobOn}` : styles.knob} />
        Chỉ đề có video trả lời mẫu
      </button>
      <form action={BASE} method="get" role="search" className={styles.search} onSubmit={(event) => {
        event.preventDefault();
        router.replace(`${BASE}${filterQuery({ ...filters, q: text.trim().slice(0, Q_MAX) })}`, { scroll: false });
      }}>
        {filters.part ? <input type="hidden" name="part" value={filters.part} /> : null}
        {filters.chude ? <input type="hidden" name="chude" value={filters.chude} /> : null}
        {filters.video ? <input type="hidden" name="video" value="1" /> : null}
        <label htmlFor="speaking-q" className={styles.searchLabel}>Tìm đề</label>
        <input
          id="speaking-q"
          name="q"
          type="search"
          value={text}
          maxLength={Q_MAX}
          autoComplete="off"
          placeholder="Tên đề hoặc chủ đề"
          onChange={(event) => setText(event.target.value)}
        />
      </form>
    </div>
  );
}
