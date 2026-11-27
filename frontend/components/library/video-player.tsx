'use client';

/**
 * Player of a Speaking model answer (LIBRARY-0061 T013, FR-032, FR-033, FR-036;
 * tờ DeSpeaking §1 mục 2, §2a–2c).
 *
 * - YouTube: embedded from youtube-nocookie.com through the IFrame API, which
 *   reports the position so the page can highlight the line being spoken.
 * - Self-hosted video: our own `<video>`; the position is remembered per
 *   question in this browser ("Xem tiếp từ 0:55").
 * - Audio (no video): a compact `<audio>` player.
 *
 * Never autoplays. The label "Giọng đọc tổng hợp" is always printed next to
 * the player as text (FR-036). A failed load shows a message in the same frame
 * (never an empty frame) and tells the page, so the transcript stops seeking.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { formatClock } from '@/lib/library-cues.mjs';

import styles from './video-player.module.css';

export type PlayerSource =
  | { kind: 'youtube'; id: string }
  | { kind: 'self_hosted'; url: string }
  | { kind: 'audio'; url: string };

export type PlayerHandle = {
  /** Seek to `ms` and play (a press on a transcript line). */
  seekTo: (ms: number) => void;
};

export type VideoPlayerProps = {
  source: PlayerSource;
  /** English title of the question, for the frame label. */
  title: string;
  /** Slug of the question: key of the remembered position. */
  storageKey: string;
  durationS?: number | null;
  onTime?: (ms: number) => void;
  /** `true` once the media cannot play, `false` again after a successful retry. */
  onBroken?: (broken: boolean) => void;
};

export const SYNTHETIC_VOICE_LABEL = 'Giọng đọc tổng hợp';
const POSITION_PREFIX = 'aver-speaking-position:';
const RESUME_MIN_S = 5;
const RETRY_AFTER_MS = 5000;
const POLL_MS = 250;
/** Longest wait for the YouTube API + player to report ready before the frame says it failed. */
export const YOUTUBE_READY_TIMEOUT_MS = 15000;

// ── remembered position (self-hosted video only) ───────────────────────────

export function readPosition(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(POSITION_PREFIX + key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= RESUME_MIN_S ? value : null;
  } catch {
    return null;
  }
}

function writePosition(key: string, seconds: number) {
  try {
    if (seconds >= RESUME_MIN_S) window.localStorage.setItem(POSITION_PREFIX + key, String(Math.floor(seconds)));
    else window.localStorage.removeItem(POSITION_PREFIX + key);
  } catch {
    /* storage blocked: nothing to remember */
  }
}

// ── YouTube IFrame API ──────────────────────────────────────────────────────

type YtPlayer = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  destroy: () => void;
};
type YtNamespace = {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YtPlayer;
  PlayerState: { PLAYING: number };
};
type YtWindow = Window & { YT?: YtNamespace; onYouTubeIframeAPIReady?: () => void };

let ytApi: Promise<YtNamespace> | null = null;

/** Loads https://www.youtube.com/iframe_api once per page. */
export function loadYouTubeApi(): Promise<YtNamespace> {
  const w = window as YtWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise<YtNamespace>((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (w.YT?.Player) resolve(w.YT);
      else reject(new Error('YouTube API missing'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      ytApi = null;
      reject(new Error('YouTube API blocked'));
    };
    document.head.appendChild(script);
  });
  return ytApi;
}

function sourceLine(source: PlayerSource): string {
  if (source.kind === 'youtube') return 'nguồn: YouTube';
  if (source.kind === 'self_hosted') return 'nguồn: máy chủ video của Aver Learning';
  return 'bản đọc';
}

export const VideoPlayer = forwardRef<PlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { source, title, storageKey, durationS, onTime, onBroken },
  ref,
) {
  const [broken, setBroken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const ytPlayer = useRef<YtPlayer | null>(null);
  const autoRetried = useRef(false);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  const markBroken = useCallback((value: boolean) => {
    setBroken(value);
    onBroken?.(value);
  }, [onBroken]);

  useImperativeHandle(ref, () => ({
    seekTo(ms: number) {
      const seconds = Math.max(0, ms / 1000);
      if (source.kind === 'youtube') {
        ytPlayer.current?.seekTo(seconds, true);
        ytPlayer.current?.playVideo();
        return;
      }
      const media = mediaRef.current;
      if (!media) return;
      media.currentTime = seconds;
      void media.play().catch(() => undefined);
    },
  }), [source.kind]);

  // YouTube: build the player, poll the position while it plays. Keyed on the
  // id (a string), so a parent re-render on every time update keeps the player.
  const youtubeId = source.kind === 'youtube' ? source.id : null;
  useEffect(() => {
    if (youtubeId === null) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    // A blocked embed may never call onReady or onError: bound the wait, so the
    // frame always ends up playable or saying it failed, never empty.
    let readyTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      readyTimer = null;
      if (!cancelled) markBroken(true);
    }, YOUTUBE_READY_TIMEOUT_MS);
    const stopReadyTimer = () => {
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = null;
    };
    loadYouTubeApi().then((YT) => {
      if (cancelled || !ytHost.current) return;
      const target = document.createElement('div');
      ytHost.current.replaceChildren(target);
      ytPlayer.current = new YT.Player(target, {
        host: 'https://www.youtube-nocookie.com',
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0, playsinline: 1, cc_lang_pref: 'en' },
        events: {
          onReady: () => {
            stopReadyTimer();
            markBroken(false);
          },
          onError: () => {
            stopReadyTimer();
            stopPolling();
            markBroken(true);
          },
          onStateChange: (event: { data: number }) => {
            stopPolling();
            if (event.data === YT.PlayerState.PLAYING) {
              timer = setInterval(() => {
                const seconds = ytPlayer.current?.getCurrentTime();
                if (typeof seconds === 'number') onTimeRef.current?.(seconds * 1000);
              }, POLL_MS);
            }
          },
        },
      });
    }).catch(() => {
      stopReadyTimer();
      if (!cancelled) markBroken(true);
    });
    return () => {
      cancelled = true;
      stopReadyTimer();
      stopPolling();
      ytPlayer.current?.destroy();
      ytPlayer.current = null;
    };
  }, [youtubeId, attempt, markBroken]);

  // Self-hosted video: offer to resume where this browser stopped.
  useEffect(() => {
    if (source.kind === 'self_hosted') setResumeAt(readPosition(storageKey));
  }, [source.kind, storageKey]);

  function retry() {
    markBroken(false);
    if (source.kind === 'youtube') {
      setAttempt((n) => n + 1);
      return;
    }
    mediaRef.current?.load();
  }

  function onMediaError() {
    markBroken(true);
    // Own server: retry once by itself after 5 s, then wait for the reader.
    if (source.kind === 'self_hosted' && !autoRetried.current) {
      autoRetried.current = true;
      setTimeout(() => {
        markBroken(false);
        mediaRef.current?.load();
      }, RETRY_AFTER_MS);
    }
  }

  function onMediaTime() {
    const media = mediaRef.current;
    if (!media) return;
    onTimeRef.current?.(media.currentTime * 1000);
    if (source.kind === 'self_hosted' && Math.floor(media.currentTime) % 5 === 0) {
      writePosition(storageKey, media.currentTime);
    }
  }

  function onMediaPause() {
    const media = mediaRef.current;
    if (media && source.kind === 'self_hosted') writePosition(storageKey, media.currentTime);
  }

  function resume() {
    const media = mediaRef.current;
    if (!media || resumeAt === null) return;
    media.currentTime = resumeAt;
    setResumeAt(null);
    void media.play().catch(() => undefined);
  }

  const clock = typeof durationS === 'number' ? formatClock(durationS * 1000) : null;
  const isAudio = source.kind === 'audio';
  const brokenText = source.kind === 'youtube'
    ? { title: 'Không mở được video từ YouTube', body: 'Mạng có thể đang chặn YouTube hoặc video đã bị gỡ.' }
    : isAudio
      ? { title: 'Chưa phát được bản đọc', body: 'Máy chủ chưa trả lời. Bạn vẫn đọc được toàn bộ lời thoại bên dưới.' }
      : { title: 'Chưa phát được video', body: 'Máy chủ video không trả lời.' };

  return (
    <figure className={isAudio ? `${styles.player} ${styles.audio}` : styles.player} data-testid="speaking-player">
      {isAudio ? (
        <audio
          ref={mediaRef}
          className={styles.audioEl}
          controls
          preload="none"
          src={source.url}
          aria-label={`Nghe câu trả lời mẫu, ${SYNTHETIC_VOICE_LABEL.toLowerCase()}`}
          onTimeUpdate={onMediaTime}
          onError={onMediaError}
        />
      ) : (
        <div className={styles.frame}>
          {source.kind === 'youtube' ? (
            <div ref={ytHost} className={styles.embed} title={`Trả lời mẫu · ${title}`} />
          ) : (
            <video
              ref={mediaRef}
              className={styles.embed}
              controls
              playsInline
              preload="metadata"
              src={source.url}
              aria-label={`Trả lời mẫu · ${title}`}
              onTimeUpdate={onMediaTime}
              onPause={onMediaPause}
              onError={onMediaError}
            />
          )}
          {broken ? (
            <div className={styles.broken} role="status">
              <p className={styles.brokenTitle}>{brokenText.title}</p>
              <p>{brokenText.body}</p>
            </div>
          ) : null}
        </div>
      )}
      {broken && isAudio ? (
        <p className={styles.brokenInline} role="status">{brokenText.title}. {brokenText.body}</p>
      ) : null}
      <figcaption className={styles.caption}>
        {clock ? <span>{clock}</span> : null}
        <span className={styles.voice}>{SYNTHETIC_VOICE_LABEL}</span>
        <span>{sourceLine(source)}</span>
        {broken ? (
          <button type="button" className={styles.action} onClick={retry}>
            {source.kind === 'youtube' ? 'Thử tải lại' : 'Thử phát lại'}
          </button>
        ) : null}
        {source.kind === 'youtube' ? (
          <a className={styles.action} href={`https://www.youtube.com/watch?v=${encodeURIComponent(source.id)}`} target="_blank" rel="noopener noreferrer">
            Xem trên YouTube
          </a>
        ) : null}
        {resumeAt !== null && !broken ? (
          <button type="button" className={styles.action} onClick={resume}>
            Xem tiếp từ {formatClock(resumeAt * 1000)}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
});
