'use client';

/**
 * Listen button of the public Library (LIBRARY-0061 T015, FR-052; tờ TuVung
 * "Nút nghe"). Never plays by itself. Pressing it plays the recording and the
 * button turns ink with the label "Dừng"; pressing again, or pressing another
 * listen button on the page, stops it. A recording that fails to load disables
 * the button and shows "Chưa tải được âm thanh"; the IPA next to it stays.
 * Without a usable URL the button is not rendered at all (no second voice
 * until there is data for it).
 */
import { useEffect, useRef, useState } from 'react';

import styles from './listen-button.module.css';

type Owner = { stop(): void };
let active: Owner | null = null;

/** Only same-origin paths or https URLs are played. Exported for tests. */
export function playableUrl(url: string | null | undefined): string | null {
  return url && /^(https:\/\/|\/(?!\/))/.test(url) ? url : null;
}

export function ListenButton({ url, label, small = false }: {
  url: string | null | undefined;
  /** Accessible name, e.g. "Nghe mitigate". */
  label: string;
  small?: boolean;
}) {
  const src = playableUrl(url);
  const owned = useRef<Owner | null>(null);
  const alive = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    alive.current = true;
    setPlaying(false);
    setFailed(false);
    const stop = () => owned.current?.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('pagehide', stop);
    };
  }, [src]);

  if (!src) return null;

  function toggle() {
    if (owned.current && active === owned.current) {
      owned.current.stop();
      return;
    }
    active?.stop();
    let media: HTMLAudioElement | null = null;
    const owner: Owner = {
      stop() {
        media?.pause();
        if (active === owner) active = null;
        if (owned.current === owner) owned.current = null;
        if (alive.current) setPlaying(false);
      },
    };
    active = owner;
    owned.current = owner;
    setPlaying(true);
    const fail = () => {
      if (!alive.current || owned.current !== owner) return;
      owner.stop();
      setFailed(true);
    };
    try {
      media = new Audio(src!);
      media.onended = () => { if (owned.current === owner) owner.stop(); };
      media.onerror = fail;
      void media.play().catch(fail);
    } catch {
      fail();
    }
  }

  const className = [styles.button, small ? styles.small : '', playing ? styles.playing : ''].filter(Boolean).join(' ');
  return (
    <span className={styles.control}>
      <button type="button" className={className} aria-label={playing ? label.replace(/^Nghe\b/, 'Dừng') : label} aria-pressed={playing} disabled={failed} onClick={toggle}>
        <span aria-hidden="true">{playing ? '■' : '▶'}</span>
        {small ? null : <span>{playing ? 'Dừng' : 'Nghe'}</span>}
      </button>
      {failed ? <small className={styles.notice} role="status">Chưa tải được âm thanh</small> : null}
    </span>
  );
}
