'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { components } from '@/types/api';

type Clip = components['schemas']['SourceQuestionClip'];

/** Whole-lesson and question playback share one audible channel. */
export function pauseOtherListeningAudio(current: HTMLAudioElement) {
  document.querySelectorAll('audio').forEach((audio) => { if (audio !== current) audio.pause(); });
}

export function ListeningQuestionAudio({ clip, active = true, reload }: { clip?: Clip; active?: boolean; reload?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [loop, setLoop] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const media = audio.current;
    setFailed(false);
    if (media) { media.pause(); setLoop(false); if (active && clip?.url) media.setAttribute('src', clip.url); else media.removeAttribute('src'); media.load(); }
    const stop = (event: Event) => { if (event.target !== media) { media?.pause(); setLoop(false); } };
    document.addEventListener('play', stop, true);
    return () => { document.removeEventListener('play', stop, true); if (media) { media.pause(); media.loop = false; media.removeAttribute('src'); media.load(); } };
  }, [active, clip?.url]);
  return <div className="source-question-audio">
    {clip ? <><p>{clip.note_vi}</p>{clip.url ? <audio ref={audio} controls preload="none" src={active ? clip.url : undefined} loop={loop} aria-label="Nghe đoạn gốc của câu này" onPlay={(event) => pauseOtherListeningAudio(event.currentTarget)} onError={() => setFailed(true)} /> : null}
      <button type="button" aria-pressed={loop} disabled={!clip.url || !active || failed} onClick={() => setLoop((value) => !value)}>{loop ? 'Tắt lặp đoạn' : 'Lặp đoạn liên tục'}</button>
      {!clip.url || failed ? <><p role="alert">Chưa phát được đoạn audio. Hãy tải lại.</p>{reload ? <button type="button" onClick={() => { setFailed(false); audio.current?.load(); reload(); }}>Tải lại đoạn nghe</button> : null}</> : null}</> : <p role="status">Câu này chưa có đoạn nghe gốc phù hợp.</p>}
  </div>;
}
