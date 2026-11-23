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
   * YouTube embed URL. Only `https://www.youtube-nocookie.com/embed/…` is
   * embedded (no-cookie mode, HocTap §3); anything else shows the placeholder.
   * `autoplay` is removed: a video never starts on its own.
   */
  embedUrl?: string;
  /** "Xem trên YouTube" link, for a YouTube source. */
  watchUrl?: string;
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

/**
 * The embed URL to use, or null when it is not a no-cookie YouTube embed.
 * Drops `autoplay` so the iframe never starts by itself.
 */
export function safeYoutubeEmbed(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== NOCOOKIE_HOST || !parsed.pathname.startsWith('/embed/')) return null;
  parsed.searchParams.delete('autoplay');
  return parsed.toString();
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
        <p className={styles.sayHead}>[TRÌNH PHÁT YOUTUBE NHÚNG]</p>
        <p className={styles.sayBody}>Ảnh bìa, nút phát, tốc độ và phụ đề do YouTube vẽ. Trang không vẽ thêm nút đè lên.</p>
      </div>
    );
    if (watchUrl) {
      link = (
        <a href={watchUrl} className={styles.out} target="_blank" rel="noopener noreferrer">
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
      <div className={styles.say}>
        <p className={styles.sayHead}>[ẢNH BÌA VIDEO]</p>
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
    area = children ?? (
      <div className={styles.say}>
        <p className={styles.sayHead}>[KHUNG HÌNH VIDEO]</p>
      </div>
    );
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
