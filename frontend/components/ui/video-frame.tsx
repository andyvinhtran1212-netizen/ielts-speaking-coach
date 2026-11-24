'use client';

import type { ReactNode } from 'react';

import { cx } from './cx';
import { Icon } from './icon/icon';
import { PendingValue } from './media-placeholder';
import { formatMediaTime } from './media-time';
import styles from './video-frame.module.css';

export type VideoSource = 'youtube' | 'self';
export type VideoFrameState = 'idle' | 'loading' | 'playing' | 'error' | 'locked';

export type VideoFrameProps = {
  /** `youtube`: YouTube draws its own controls. `self`: our video server; the page passes its player as `children`. */
  source: VideoSource;
  /** "Bài 14 · Hoà hợp chủ ngữ và động từ". */
  title: string;
  /** Line under the video: "12:40 · phụ đề tiếng Việt do kênh cung cấp". */
  meta?: ReactNode;
  state: VideoFrameState;
  /** Self-hosted: seconds where the learner stopped; offers "Xem tiếp từ …". */
  resumeAt?: number;
  /**
   * YouTube embed URL. Only `https://www.youtube-nocookie.com/embed/<id>` is
   * embedded (no-cookie mode, HocTap §3); anything else says "Chưa nhúng
   * được video này". `autoplay` is removed: a video never starts on its own.
   */
  embedUrl?: string;
  /**
   * "Xem trên YouTube" link. With a valid `embedUrl` the link is built from
   * that video's id and this is ignored. Otherwise only a YouTube watch URL
   * (youtube.com/watch?v=<id>, youtu.be/<id>) is used, rebuilt on
   * www.youtube.com; any other address hides the link.
   */
  watchUrl?: string;
  /** Self-hosted, `idle`: cover image URL. Without it the area stays plain dark. */
  poster?: string;
  /** "Đọc bản chữ của video" link. */
  transcriptHref?: string;
  /** Locked: the course the video belongs to, and where to see it. */
  lockedCourse?: ReactNode;
  lockedHref?: string;
  /** Locked: what is still open, e.g. "Bạn vẫn xem được 2 phút đầu và đọc bản chữ tóm tắt." */
  lockedNote?: ReactNode;
  /** Self-hosted, `playing`: the page's own player (this component never creates a `<video>`). */
  children?: ReactNode;
  onPlay?: () => void;
  onRestart?: () => void;
  onRetry?: () => void;
  className?: string;
};

const NOCOOKIE_HOST = 'www.youtube-nocookie.com';
const WATCH_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function parseHttps(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port ? parsed : null;
  } catch {
    return null;
  }
}

function embedId(parsed: URL | null): string | null {
  if (!parsed || parsed.hostname !== NOCOOKIE_HOST) return null;
  const match = /^\/embed\/([^/]+)$/.exec(parsed.pathname);
  return match && VIDEO_ID.test(match[1]) ? match[1] : null;
}

function watchFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * The embed URL to use, or null when it is not a no-cookie YouTube embed of
 * one video id. Drops `autoplay` so the iframe never starts by itself.
 */
export function safeYoutubeEmbed(url: string | undefined): string | null {
  const parsed = parseHttps(url);
  if (!parsed || !embedId(parsed)) return null;
  parsed.searchParams.delete('autoplay');
  return parsed.toString();
}

/**
 * The "Xem trên YouTube" address: rebuilt on www.youtube.com from a checked
 * video id, or null. Nothing outside YouTube gets a YouTube label.
 */
export function safeYoutubeWatch(watchUrl: string | undefined, embedUrl?: string): string | null {
  const fromEmbed = embedId(parseHttps(embedUrl));
  if (fromEmbed) return watchFor(fromEmbed);
  const parsed = parseHttps(watchUrl);
  if (!parsed) return null;
  let id: string | null = null;
  if (WATCH_HOSTS.has(parsed.hostname) && parsed.pathname === '/watch') id = parsed.searchParams.get('v');
  else if (parsed.hostname === 'youtu.be') id = parsed.pathname.slice(1);
  return id && VIDEO_ID.test(id) ? watchFor(id) : null;
}

/**
 * Video frame of the "Bản in" UI (UIBASE-0056 #32, ThanhPhanHocTap §3): source
 * line and title on top, a 16:9 dark area, an information line below. Every
 * state is said in words inside the video area. Presentation only.
 */
export function VideoFrame({
  source,
  title,
  meta,
  state,
  resumeAt,
  embedUrl,
  watchUrl,
  poster,
  transcriptHref,
  lockedCourse,
  lockedHref,
  lockedNote,
  children,
  onPlay,
  onRestart,
  onRetry,
  className,
}: VideoFrameProps) {
  const kicker = source === 'youtube' ? 'Video · YouTube' : 'Video · Aver Learning';
  const resume = resumeAt !== undefined && resumeAt > 0 ? formatMediaTime(resumeAt, { padMinutes: true }) : null;
  const course = lockedCourse ?? <PendingValue />;

  let area: ReactNode;
  let caption: ReactNode = meta;
  let link: ReactNode = null;

  if (source === 'youtube' && state !== 'locked') {
    const src = safeYoutubeEmbed(embedUrl);
    const watch = safeYoutubeWatch(watchUrl, embedUrl);
    area = src ? (
      <iframe
        src={src}
        title={title}
        className={styles.embed}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; fullscreen"
      />
    ) : (
      <div className={styles.say}>
        <p className={styles.sayHead}>Chưa nhúng được video này</p>
        {watch ? <p className={styles.sayBody}>Bạn vẫn xem được trên YouTube, link ở dưới khung.</p> : null}
      </div>
    );
    if (watch) {
      link = (
        <a href={watch} className={styles.out} target="_blank" rel="noopener noreferrer">
          Xem trên YouTube<Icon name="external" size={16} />
        </a>
      );
    }
  } else if (state === 'loading') {
    area = (
      <div className={styles.say} aria-busy="true">
        <p role="status" className={styles.sayHead}>Đang tải video…</p>
      </div>
    );
    caption = meta ?? 'Mạng chậm sẽ tự chọn chất lượng thấp hơn.';
  } else if (state === 'error') {
    area = (
      <div role="alert" className={styles.say}>
        <p className={styles.sayHead}><Icon name="error" size={20} />Chưa phát được video</p>
        <p className={styles.sayBody}>
          Máy chủ video không trả lời.{transcriptHref ? ' Bản chữ bên dưới vẫn đọc được.' : null}
        </p>
        <button type="button" className={styles.solid} onClick={onRetry}>Thử phát lại</button>
      </div>
    );
    caption = resume ? `Vị trí ${resume} vẫn được giữ.` : meta;
  } else if (state === 'locked') {
    area = (
      <div className={styles.say}>
        <p className={styles.sayHead}><Icon name="lock" size={20} />Đã khoá · video thuộc khoá {course}</p>
        {lockedNote ? <p className={styles.sayBody}>{lockedNote}</p> : null}
        {lockedHref ? <a href={lockedHref} className={styles.solidLink}>Xem khoá {course}</a> : null}
      </div>
    );
  } else if (state === 'idle') {
    area = (
      <div className={cx(styles.say, poster && styles.onPoster)}>
        {poster ? <img src={poster} alt="" className={styles.poster} /> : null}
        {resume ? (
          <>
            <p className={styles.sayBody}>Bạn đang xem dở ở <span className={styles.num}>{resume}</span>.</p>
            <div className={styles.choices}>
              <button type="button" className={styles.solid} onClick={onPlay}>Xem tiếp từ {resume}</button>
              <button type="button" className={styles.ghost} onClick={onRestart}>Xem từ đầu</button>
            </div>
          </>
        ) : (
          <button type="button" className={styles.solid} onClick={onPlay}><Icon name="play" size={20} />Phát video</button>
        )}
      </div>
    );
  } else {
    // Playing without the page's player: the area stays plain dark.
    area = children ?? null;
  }

  if (!link && transcriptHref && source === 'self') {
    link = <a href={transcriptHref} className={styles.out}>Đọc bản chữ của video</a>;
  }

  return (
    <figure className={cx(styles.frame, className)}>
      <div className={styles.head}>
        <p className={styles.kicker}>{kicker}</p>
        <p className={styles.title}>{title}</p>
      </div>
      <div className={styles.area}>{area}</div>
      {caption || link ? (
        <figcaption className={styles.caption}>
          {caption ? <span className={styles.num}>{caption}</span> : null}
          {link}
        </figcaption>
      ) : null}
    </figure>
  );
}
