'use client';

import { useEffect, useRef } from 'react';

type Stage = 'listening' | 'dictation';
type Snapshot = { stage: Stage; page_id: string; plays: number; played_ms: number };

export function useListeningDrillPlayback(
  attemptId: string | undefined,
  stage: Stage,
  active: boolean,
  getAudio: () => HTMLMediaElement | null | undefined,
  mediaRevision?: string | number,
) {
  const flush = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});
  const audioReader = useRef(getAudio);
  audioReader.current = getAudio;

  useEffect(() => {
    const audio = audioReader.current();
    if (!attemptId || !active || !audio) return;
    let plays = 0;
    let played = 0;
    let sentPlays = -1;
    let sentMs = -1;
    let pendingStart = true;
    let clock: number | null = null;
    let position = audio.currentTime;
    let rate = audio.playbackRate;
    const page = crypto.randomUUID();
    const path = `/api/listening/skill-drill-playback/${encodeURIComponent(attemptId)}`;

    function sample() {
      if (!audio || clock == null || audio.seeking) return;
      const now = performance.now();
      const delta = audio.currentTime - position;
      if (delta > 0) played += Math.min(now - clock, (delta * 1000) / rate);
      clock = now;
      position = audio.currentTime;
    }
    async function send(keepalive = false) {
      sample();
      const snapshot: Snapshot = { stage, page_id: page, plays, played_ms: Math.round(played) };
      if (snapshot.plays <= sentPlays && snapshot.played_ms <= sentMs) return;
      await window.api.postWith(path, snapshot, undefined, { keepalive, noRedirect: true });
      sentPlays = Math.max(sentPlays, snapshot.plays);
      sentMs = Math.max(sentMs, snapshot.played_ms);
    }
    function checkpoint(keepalive = false) { void send(keepalive).catch(() => {}); }
    function playing() {
      if (!audio || audio.seeking) return;
      if (pendingStart) { plays += 1; pendingStart = false; }
      clock = performance.now();
      position = audio.currentTime;
    }
    function stop() { sample(); clock = null; }
    function pause() { stop(); pendingStart = true; checkpoint(); }
    function seeking() { clock = null; }
    function seeked() {
      if (audio && !audio.paused && audio.readyState >= 3) playing();
    }
    function replay() { stop(); pendingStart = true; }
    function ratechange() { sample(); rate = audio?.playbackRate || 1; }
    function hide() { checkpoint(true); }
    const listeners = {
      playing, timeupdate: sample, pause, ended: pause, waiting: stop, seeking, seeked,
      ratechange, 'aver-drill-replay': replay,
    };
    for (const [event, listener] of Object.entries(listeners)) audio.addEventListener(event, listener);
    if (!audio.paused && audio.readyState >= 3) playing();
    const interval = window.setInterval(() => checkpoint(), 5000);
    window.addEventListener('pagehide', hide);
    flush.current = send;
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', hide);
      for (const [event, listener] of Object.entries(listeners)) audio.removeEventListener(event, listener);
      checkpoint(true);
      flush.current = async () => {};
    };
  }, [attemptId, stage, active, mediaRevision]);
  return flush;
}
