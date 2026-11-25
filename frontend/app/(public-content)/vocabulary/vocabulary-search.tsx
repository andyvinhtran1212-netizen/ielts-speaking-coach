'use client';

/**
 * Look-up box of the Vocabulary shelf (LIBRARY-0061 T015, FR-051; tờ TuVung
 * màn 1). A plain GET form to `/vocabulary?q=` (works without JavaScript),
 * enhanced into a combobox: suggestions from the second character, at most 5,
 * headword prefix first, then inflected forms; ↑ ↓ choose, Enter opens the
 * chosen entry, Esc closes; "Tra từ" with nothing chosen opens the results page.
 * The word list is read once, on first focus, from the public directory.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { getBrowserJson } from '@/lib/browser-api';
import { normalizeVocabularyDirectory } from '@/lib/vocabulary-model.mjs';
import { entryHref, SUGGEST_MIN_CHARS, suggestWords } from '@/lib/vocabulary-suggest.mjs';
import type { VocabularyDirectory, VocabularyWord } from '@/lib/vocabulary-types';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './vocabulary.module.css';

const PAGE = 100;
const MAX_PAGES = 40;

/** Every directory word, page by page (the directory caps a page at 100). */
export async function loadAllWords(fetchPage: (offset: number) => Promise<VocabularyDirectory>): Promise<VocabularyWord[]> {
  const words: VocabularyWord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(words.length);
    words.push(...result.items);
    if (!result.items.length || words.length >= result.total) break;
  }
  return words;
}

let wordsPromise: Promise<VocabularyWord[]> | null = null;

function browserWords(): Promise<VocabularyWord[]> {
  wordsPromise ??= (async () => {
    const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocabulary look-up)');
    if (!ready) throw new Error('api-not-ready');
    return loadAllWords(async (offset) => normalizeVocabularyDirectory(
      await getBrowserJson('/api/vocabulary/directory', new URLSearchParams({ offset: String(offset), limit: String(PAGE) })),
    ) as VocabularyDirectory);
  })().catch((error) => { wordsPromise = null; throw error; });
  return wordsPromise;
}

function Highlight({ headword, query }: { headword: string; query: string }) {
  const at = headword.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return <>{headword}</>;
  const end = at + query.trim().length;
  return <>{headword.slice(0, at)}<b>{headword.slice(at, end)}</b>{headword.slice(end)}</>;
}

export function VocabularySearch({ initialQuery = '', autoFocus = false }: { initialQuery?: string; autoFocus?: boolean }) {
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [words, setWords] = useState<VocabularyWord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => (words && query.trim().length >= SUGGEST_MIN_CHARS ? suggestWords(query, words) : []),
    [query, words],
  );
  const showList = open && query.trim().length >= SUGGEST_MIN_CHARS && (loading || suggestions.length > 0);

  useEffect(() => { setActiveIndex(-1); }, [query]);

  function ensureWords() {
    if (words || loading) return;
    setLoading(true);
    void browserWords().then(setWords, () => setWords([])).finally(() => setLoading(false));
  }

  function openWord(word: VocabularyWord) {
    window.location.assign(entryHref(word));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (!suggestions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      const chosen = showList && activeIndex >= 0 ? suggestions[activeIndex] : null;
      if (chosen) {
        event.preventDefault();
        openWord(chosen);
      }
    } else if (event.key === 'Escape') {
      if (showList) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  const activeId = showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;
  return (
    <form className={styles.search} action="/vocabulary" method="get" role="search" onSubmit={(event) => {
      if (!query.trim()) { event.preventDefault(); inputRef.current?.focus(); }
    }}>
      <label className={styles.searchLabel} htmlFor={`${listId}-input`}>Tra từ tiếng Anh</label>
      <div className={styles.searchRow}>
        <div className={styles.combo}>
          <input ref={inputRef} id={`${listId}-input`} name="q" type="search" autoComplete="off" spellCheck={false}
            autoFocus={autoFocus} value={query} role="combobox" aria-autocomplete="list" aria-expanded={showList}
            aria-controls={`${listId}-list`} aria-activedescendant={activeId} aria-describedby={`${listId}-hint`}
            onFocus={() => { ensureWords(); setOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); ensureWords(); }}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown} />
          {showList ? (
            <div className={styles.suggest}>
              {loading && !words ? <p className={styles.suggestState} role="status">Đang tìm…</p> : (
                <ul id={`${listId}-list`} role="listbox" aria-label="Gợi ý tra từ" className={styles.suggestList}>
                  {suggestions.map((word, index) => (
                    <li key={`${word.category}/${word.slug}`} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                      className={index === activeIndex ? `${styles.suggestItem} ${styles.suggestActive}` : styles.suggestItem}
                      onMouseDown={(event) => { event.preventDefault(); openWord(word); }}
                      onMouseEnter={() => setActiveIndex(index)}>
                      <span className={styles.suggestWord}><Highlight headword={word.headword} query={query} /></span>
                      {word.partOfSpeech ? <span className={styles.suggestPos}>{word.partOfSpeech}</span> : null}
                      {word.glossVi ? <span className={styles.suggestVi}>{word.glossVi}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.suggestHint}>Phím ↑ ↓ để chọn · Enter để mở mục từ · Esc để đóng</p>
            </div>
          ) : null}
        </div>
        <button type="submit" className={styles.searchButton}>Tra từ</button>
      </div>
      <p id={`${listId}-hint`} className={styles.searchHint}>
        Gõ từ tiếng Anh. Gợi ý hiện từ chữ thứ hai; tra cả dạng chia, ví dụ “mitigated” mở mục “mitigate”.
      </p>
    </form>
  );
}
