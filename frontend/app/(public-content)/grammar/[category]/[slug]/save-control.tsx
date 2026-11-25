'use client';

/**
 * "Lưu bài" of a Grammar article (LIBRARY-0061 T014 PR (a); tờ GrammarWikiBai,
 * dòng dưới tiêu đề). Signed-in reader: a pressed toggle that keeps the existing
 * `POST|DELETE /api/grammar/articles/{slug}/save`. Guest: one line with a
 * sign-in link, no pop-up (FR-003). Nothing is shown until the session is known.
 *
 * Same contract as before the redesign: there is no per-article "saved" read,
 * so the control starts as "Lưu bài"; a failed request puts it back.
 */
import { useEffect, useState } from 'react';

import { whenGlobalReady } from '../../../../../lib/when-global-ready.mjs';

import styles from './article.module.css';

type SaveState = 'unknown' | 'guest' | 'reader';

export function SaveControl({ slug }: { slug: string }) {
  const [who, setWho] = useState<SaveState>('unknown');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!await whenGlobalReady(
        () => !!(window as any).getSupabase && !!(window as any).api?.post && !!(window as any).api?.delete,
        'window.api (nút Lưu bài)',
      )) return;
      try {
        const session = await (window as any).getSupabase?.()?.auth.getSession();
        if (live) setWho(session?.data?.session ? 'reader' : 'guest');
      } catch {
        if (live) setWho('guest');
      }
    })();
    return () => { live = false; };
  }, []);

  if (who === 'unknown') return null;

  if (who === 'guest') {
    const next = typeof window === 'undefined' ? '/grammar' : window.location.pathname + window.location.search;
    return (
      <p className={styles.saveNote}>
        <a href={`/login?next=${encodeURIComponent(next)}`}>Đăng nhập</a> để lưu bài.
      </p>
    );
  }

  const toggle = async () => {
    if (busy) return;
    const wasSaved = saved;
    setBusy(true);
    setFailed(false);
    setSaved(!wasSaved);
    const path = `/api/grammar/articles/${encodeURIComponent(slug)}/save`;
    try {
      if (wasSaved) await (window as any).api.delete(path);
      else await (window as any).api.post(path, {});
    } catch {
      setSaved(wasSaved);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <p className={styles.saveNote}>
      <button
        type="button"
        id="save-article-btn"
        aria-pressed={saved}
        aria-busy={busy || undefined}
        className={saved ? `${styles.saveButton} ${styles.saveOn}` : styles.saveButton}
        onClick={toggle}
      >
        {saved ? 'Đã lưu' : 'Lưu bài'}
      </button>
      {failed ? <span role="status" className={styles.muted}> Chưa lưu được, thử lại.</span> : null}
    </p>
  );
}
