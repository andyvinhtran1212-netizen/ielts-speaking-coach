'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './vocabulary-audio-button.module.css';

type Owner = { stop(): void };
let active: Owner | null = null;

/** One pronunciation/example channel across vocabulary cards and lesson stages. */
export function VocabularyAudioButton({ url = '', say = '', label, tabIndex, className = 'fcs-audio', children }: {
  url?: string | null; say?: string; label: string; tabIndex?: number; className?: string; children?: ReactNode;
}) {
  const owned = useRef<Owner | null>(null);
  const alive = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const available = !!url && /^(https:\/\/|\/(?!\/))/.test(url);
  useEffect(() => {
    alive.current = true;
    setNotice(''); setFailed(false); setPlaying(false);
    const stop = () => owned.current?.stop();
    window.addEventListener('pagehide', stop);
    return () => { alive.current = false; stop(); window.removeEventListener('pagehide', stop); };
  }, [url, say]);

  function play() {
    if (owned.current && active === owned.current) { owned.current.stop(); return; }
    active?.stop();
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    setNotice(''); setFailed(false); setPlaying(true);
    let media: HTMLAudioElement | null = null;
    const owner: Owner = { stop() {
      media?.pause();
      if (active === owner) active = null;
      if (owned.current === owner) owned.current = null;
      if (alive.current) setPlaying(false);
    } };
    active = owner; owned.current = owner;
    const current = () => alive.current && active === owner;
    const fail = () => {
      if (!current()) return;
      owner.stop(); setFailed(true); setNotice('Chưa phát được audio. Nhấn nút nghe để thử lại.');
    };
    if (!available) { fail(); return; }
    try {
      media = new Audio(url!);
      media.onended = () => { if (current()) owner.stop(); };
      media.onerror = fail;
      void media.play().catch(fail);
    } catch { fail(); }
  }

  return <span className={styles.control}>
    <button type="button" className={`${className}${playing ? ' is-playing' : ''}`} aria-label={label} aria-pressed={playing} tabIndex={tabIndex}
      disabled={!available} title={!available ? 'Audio đang được chuẩn bị.' : undefined}
      onClick={event => { event.preventDefault(); event.stopPropagation(); play(); }}>
      {children || <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>}
    </button>
    {notice && <small className={styles.notice} role={failed ? 'alert' : 'status'}>{notice}</small>}
    {!available && <small className={styles.notice}>Audio đang được chuẩn bị.</small>}
  </span>;
}
