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
  useEffect(() => {
    alive.current = true;
    setNotice(''); setFailed(false); setPlaying(false);
    return () => { alive.current = false; owned.current?.stop(); };
  }, [url, say]);

  function play() {
    if (owned.current && active === owned.current) { owned.current.stop(); return; }
    active?.stop();
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    window.speechSynthesis?.cancel();
    setNotice(''); setFailed(false); setPlaying(true);
    let media: HTMLAudioElement | null = null;
    let utterance: SpeechSynthesisUtterance | null = null;
    let fallbackStarted = false;
    const owner: Owner = { stop() {
      media?.pause();
      if (utterance) window.speechSynthesis?.cancel();
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
    const speak = () => {
      if (!current() || fallbackStarted) return;
      fallbackStarted = true; media?.pause();
      if (!say || !window.speechSynthesis || !window.SpeechSynthesisUtterance) { fail(); return; }
      try {
        utterance = new SpeechSynthesisUtterance(say);
        utterance.lang = 'en-GB'; utterance.rate = 0.92;
        utterance.onend = () => { if (current()) owner.stop(); };
        utterance.onerror = fail;
        setNotice('Đang dùng giọng của trình duyệt.');
        window.speechSynthesis.speak(utterance);
      } catch { fail(); }
    };
    if (!url || !/^(https:\/\/|\/(?!\/))/.test(url)) { speak(); return; }
    try {
      media = new Audio(url);
      media.onended = () => { if (current()) owner.stop(); };
      media.onerror = speak;
      void media.play().catch(speak);
    } catch { speak(); }
  }

  return <span className={styles.control}>
    <button type="button" className={className} aria-label={label} aria-pressed={playing} tabIndex={tabIndex}
      disabled={!url && !say} onClick={event => { event.stopPropagation(); play(); }}>
      {children || <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>}
    </button>
    {notice && <small className={styles.notice} role={failed ? 'alert' : 'status'}>{notice}</small>}
  </span>;
}
