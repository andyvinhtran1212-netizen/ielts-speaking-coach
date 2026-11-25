'use client';

/**
 * Word lists of the Vocabulary shelf (LIBRARY-0061 T015; tờ TuVung màn 1, 3b,
 * 3c): one row per entry with headword, part of speech, IPA and Vietnamese
 * meaning; every headword is a real link to the entry, so the list works and
 * is indexable without JavaScript. `VocabularyTable` adds "Xem thêm" paging
 * through the public directory.
 */
import { useEffect, useRef, useState } from 'react';

import { getBrowserJson } from '@/lib/browser-api';
import { normalizeVocabularyDirectory } from '@/lib/vocabulary-model.mjs';
import { entryHref } from '@/lib/vocabulary-suggest.mjs';
import type { VocabularyDirectory, VocabularyWord } from '@/lib/vocabulary-types';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './vocabulary.module.css';

export function WordTable({ words }: { words: readonly VocabularyWord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr><th scope="col">Từ</th><th scope="col">Từ loại</th><th scope="col">Phiên âm</th><th scope="col">Nghĩa tiếng Việt</th></tr>
      </thead>
      <tbody>
        {words.map((word) => (
          <tr key={`${word.category}/${word.slug}`} data-category={word.category} data-slug={word.slug}>
            <th scope="row"><a href={entryHref(word)}>{word.headword}</a></th>
            <td>{word.partOfSpeech}</td>
            <td><span className="av2-ipa">{word.pronunciation}</span></td>
            <td>{word.glossVi}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VocabularyTable({ initial, category }: { initial: VocabularyDirectory; category: string }) {
  const [directory, setDirectory] = useState(initial);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>('ready');
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function loadMore() {
    if (status === 'loading' || directory.items.length >= directory.total) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setStatus('loading');
    try {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocabulary directory page)');
      if (controller.signal.aborted) return;
      if (!ready) throw new Error('api-not-ready');
      const params = new URLSearchParams({ offset: String(directory.items.length), limit: String(directory.limit) });
      if (category) params.set('category', category);
      const payload = await getBrowserJson('/api/vocabulary/directory', params, controller.signal);
      if (controller.signal.aborted) return;
      const next = normalizeVocabularyDirectory(payload) as VocabularyDirectory;
      setDirectory((current) => ({ ...next, offset: current.offset, items: [...current.items, ...next.items] }));
      setStatus('ready');
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) return;
      setStatus('error');
    }
  }

  if (!directory.items.length) {
    return <p className={styles.empty}>Chủ đề này chưa có từ nào. <a href="/vocabulary">Xem tất cả từ</a>.</p>;
  }
  const remaining = directory.total - directory.items.length;
  return (
    <>
      <p className={styles.count}>{directory.total} từ</p>
      <WordTable words={directory.items} />
      {status === 'error' ? (
        <p className={styles.pageState} role="alert">
          Không tải được thêm từ. <button type="button" onClick={() => { setStatus('ready'); void loadMore(); }}>Tải lại</button>
        </p>
      ) : null}
      {status !== 'error' && remaining > 0 ? (
        <button type="button" className={styles.more} disabled={status === 'loading'} onClick={() => void loadMore()}>
          {status === 'loading' ? 'Đang tải…' : `Xem thêm (${remaining})`}
        </button>
      ) : null}
    </>
  );
}
