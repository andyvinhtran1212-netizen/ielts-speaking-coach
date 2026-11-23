'use client';

// Grammar Wiki home index (LIBRARY-0061 T014 part b = G06-T14b; tờ GrammarWiki §1, §3, §4).
//
// - Search filters as you type and matches without Vietnamese accents
//   ("bi dong" finds "Câu bị động"). It shows at most 12 rows, then "Còn N bài
//   khác". Enter, or the full-results link, opens the shareable
//   `/grammar/search?q=` page; with JS off the form submits there.
// - "Theo nhóm": the 10 groups of `_groups.yaml` in file order, one group open
//   at a time. "A–Z": every article once, by Vietnamese name (FR-041); a
//   letter with no article is dimmed and not a link.
// - View and group live in the URL (`?xem=az`, `?nhom=<slug>`): the server
//   renders the same state from a shared link, and clicks only replace the URL.
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';

import { grammarArticleHref } from '@/lib/grammar-navigation-context.mjs';
import {
  AZ_LETTERS,
  azName,
  azSections,
  buildIndex,
  indexHref,
  pickGroup,
  searchIndex,
  uniqueEntries,
  type GroupWire,
  type IndexEntry,
} from '@/lib/grammar-index-model.mjs';

import styles from './grammar-home.module.css';

export type IndexView = 'groups' | 'az';

type Props = {
  groups: GroupWire[];
  initialView?: IndexView;
  initialGroup?: string;
  /** Shown above the index while not searching (e.g. "Bài nổi bật"). */
  children?: ReactNode;
};

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function ArticleName({ entry }: { entry: IndexEntry }) {
  return (
    <>
      <a href={grammarArticleHref(entry.category, entry.slug)} className={styles.articleEn} lang="en">
        {entry.en}
      </a>
      {entry.vi ? <span className={styles.articleVi}>{entry.vi}</span> : null}
    </>
  );
}

function SearchResults({ query, index }: { query: string; index: ReturnType<typeof buildIndex> }) {
  const { results, more, total } = searchIndex(index, query);
  const fullHref = `/grammar/search?q=${encodeURIComponent(query.trim())}`;
  if (total === 0) {
    return (
      <div className={styles.noResults} role="status" data-testid="grammar-no-results">
        <p className={styles.noResultsTitle}>Không có bài nào khớp “{query.trim()}”.</p>
        <p>
          Thử tên tiếng Anh của điểm ngữ pháp (ví dụ <span lang="en">passive voice</span>), bỏ bớt từ, hoặc xem cả mục lục
          bên dưới khi xoá ô tìm.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="grammar-results">
      <p className={styles.resultNote} role="status">
        {total} bài khớp “{query.trim()}”
      </p>
      <ol className={styles.rows}>
        {results.map((entry) => (
          <li key={entry.slug} className={styles.row}>
            <ArticleName entry={entry} />
            <span className={styles.rowMeta}>
              Nhóm {entry.groupN} · {entry.groupName}
            </span>
          </li>
        ))}
      </ol>
      {more > 0 ? <p className={styles.resultNote}>Còn {more} bài khác, gõ thêm để thu hẹp.</p> : null}
      <p className={styles.fullResults}>
        <a href={fullHref}>Xem trang kết quả đầy đủ (lọc theo trình độ và kỹ năng)</a>
      </p>
    </div>
  );
}

export function GrammarIndex({ groups, initialView = 'groups', initialGroup = '', children }: Props) {
  const index = useMemo(() => buildIndex(groups), [groups]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<IndexView>(initialView);
  const [groupSlug, setGroupSlug] = useState(pickGroup(index, initialGroup)?.slug ?? '');
  const selected = pickGroup(index, groupSlug);
  const articleCount = uniqueEntries(index).length;
  const searching = query.trim().length > 0;

  const go = (event: MouseEvent<HTMLAnchorElement>, next: { view: IndexView; group?: string }) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    setView(next.view);
    if (next.group) setGroupSlug(next.group);
    window.history.replaceState(null, '', indexHref({ view: next.view, group: next.group ?? '' }).replace('#groups-section', ''));
  };

  return (
    <div className={styles.index}>
      <form
        role="search"
        action="/grammar/search"
        method="get"
        className={styles.search}
        onSubmit={(event) => {
          if (!query.trim()) event.preventDefault();
        }}
      >
        <label htmlFor="grammar-index-q" className={styles.searchLabel}>
          Tìm trong Grammar Wiki
        </label>
        <div className={styles.searchRow}>
          <input
            id="grammar-index-q"
            name="q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tên tiếng Anh hoặc tiếng Việt, gõ không dấu cũng được"
            autoComplete="off"
            className={styles.searchInput}
          />
          {searching ? (
            <button type="button" className={styles.clear} onClick={() => setQuery('')}>
              Xoá
            </button>
          ) : null}
        </div>
      </form>

      {searching ? (
        <SearchResults query={query} index={index} />
      ) : (
        <>
          {children}
          <section id="groups-section" aria-labelledby="muc-luc-title" className={styles.toc}>
            <div className={styles.tocHead}>
              <h2 id="muc-luc-title">Mục lục</h2>
              {index.length > 0 ? (
                <p className={styles.count}>
                  {index.length} nhóm · {articleCount} bài
                </p>
              ) : null}
              <nav aria-label="Cách xếp mục lục" className={styles.views}>
                <a
                  href={indexHref({ view: 'groups', group: selected?.slug ?? '' })}
                  aria-current={view === 'groups' ? 'true' : undefined}
                  onClick={(event) => go(event, { view: 'groups' })}
                >
                  Theo nhóm
                </a>
                <a
                  href={indexHref({ view: 'az' })}
                  aria-current={view === 'az' ? 'true' : undefined}
                  onClick={(event) => go(event, { view: 'az' })}
                >
                  A–Z
                </a>
              </nav>
            </div>

            {index.length === 0 ? (
              <p className={styles.noResults} data-testid="grammar-index-empty">
                Chưa tải được mục lục. Ô tìm vẫn dùng được; thử tải lại trang sau.
              </p>
            ) : view === 'az' ? (
              <AzList index={index} />
            ) : (
              <>
                {/* ≥ 768px: group list on the left, the chosen group on the right. */}
                <div className={styles.tree} data-testid="grammar-tree">
                  <ol className={styles.groupList}>
                    {index.map((g) => (
                      <li key={g.slug}>
                        <a
                          href={indexHref({ group: g.slug })}
                          aria-current={g.slug === selected?.slug ? 'true' : undefined}
                          onClick={(event) => go(event, { view: 'groups', group: g.slug })}
                        >
                          <span className={styles.num}>{g.n}</span>
                          <span className={styles.groupName}>{g.name}</span>
                          <span className={styles.groupCount}>{g.entries.length} bài</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                  {selected ? (
                    <div className={styles.groupPanel} aria-live="polite">
                      <p className={styles.eyebrow}>Nhóm {selected.n}</p>
                      <h3>{selected.name}</h3>
                      <p className={styles.groupNote}>
                        {selected.description ? `${selected.description} · ` : ''}
                        {selected.entries.length} bài.
                      </p>
                      <ol className={styles.rows}>
                        {selected.entries.map((entry) => (
                          <li key={entry.slug} className={styles.row}>
                            <ArticleName entry={entry} />
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>
                {/* < 768px: one disclosure per group, one open at a time. */}
                <div className={styles.accordion} data-testid="grammar-accordion">
                  {index.map((g) => (
                    <details key={g.slug} name="grammar-groups" open={g.slug === selected?.slug}>
                      <summary>
                        <span className={styles.num}>{g.n}</span>
                        <span className={styles.groupName}>{g.name}</span>
                        <span className={styles.groupCount}>{g.entries.length} bài</span>
                      </summary>
                      <ol className={styles.rows}>
                        {g.entries.map((entry) => (
                          <li key={entry.slug} className={styles.row}>
                            <ArticleName entry={entry} />
                          </li>
                        ))}
                      </ol>
                    </details>
                  ))}
                </div>
                <p className={styles.hint}>Thứ tự nhóm theo hướng học: nền tảng trước, áp dụng IELTS sau. Bạn mở nhóm nào cũng được.</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function AzList({ index }: { index: ReturnType<typeof buildIndex> }) {
  const sections = azSections(index);
  const present = new Set(sections.map((s) => s.letter));
  const bar = present.has('#') ? [...AZ_LETTERS, '#'] : AZ_LETTERS;
  const anchor = (letter: string) => `az-${letter === '#' ? 'khac' : letter}`;
  return (
    <div data-testid="grammar-az">
      <nav aria-label="Chữ cái" className={styles.letters}>
        {bar.map((letter) =>
          present.has(letter) ? (
            <a key={letter} href={`#${anchor(letter)}`}>
              {letter}
            </a>
          ) : (
            <span key={letter} className={styles.letterOff} aria-disabled="true" title="Chưa có bài">
              {letter}
            </span>
          ),
        )}
      </nav>
      {sections.map((s) => (
        <section key={s.letter} id={anchor(s.letter)} className={styles.azSection} aria-label={`Chữ ${s.letter}`}>
          <h3 className={styles.azLetter}>{s.letter}</h3>
          <ol className={styles.rows}>
            {s.entries.map((entry) => (
              <li key={entry.slug} className={styles.row}>
                <a href={grammarArticleHref(entry.category, entry.slug)} className={styles.articleEn} lang={entry.vi ? 'vi' : 'en'}>
                  {azName(entry)}
                </a>
                {entry.vi ? (
                  <span className={styles.articleVi} lang="en">
                    {entry.en}
                  </span>
                ) : null}
                <span className={styles.rowMeta}>{entry.groupName}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
