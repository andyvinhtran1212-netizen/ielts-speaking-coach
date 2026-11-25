'use client';

// /ui-library demos for G03-T10 (UIBASE-0056 #31, #32; ThanhPhanHocTap §2–3):
// one shared audio state drives the full, compact and phone players, like the
// sheet ("bấm Phát ở một chỗ thì cả ba cùng chạy"). No clock runs, so the
// screenshots stay still; Play only flips the state. Sample data only.
import { useState } from 'react';

import { AudioPlayer, VideoFrame, type AudioLoop, type AudioPlayerState } from '@/components/ui';

import styles from './ui-library.module.css';

const TRACK = 'Booking a room at the sports centre';
const DURATION = 222;

export function AudioPlayerDemo() {
  const [state, setState] = useState<AudioPlayerState>('paused');
  const [current, setCurrent] = useState(72);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<AudioLoop>({ a: 42, b: 65 });
  const common = {
    state,
    title: TRACK,
    current,
    duration: DURATION,
    speed,
    loop,
    onPlay: () => setState('playing'),
    onPause: () => setState('paused'),
    onSeek: setCurrent,
    onSpeed: setSpeed,
    onSetA: () => setLoop({ a: current }),
    onSetB: () => setLoop((l) => (l.a !== undefined && current > l.a ? { a: l.a, b: current } : l)),
    onClearLoop: () => setLoop({}),
  };
  return (
    <div className={styles.mediaGrid}>
      <div className={styles.stack}>
        <p className={styles.rowNote}>Đầy đủ · bấm thử được · phím cách phát hoặc tạm dừng</p>
        <AudioPlayer {...common} variant="full" spaceToggles />
        <p className={styles.rowNote}>Thu gọn một dòng · cùng trạng thái</p>
        <AudioPlayer {...common} variant="compact" />
      </div>
      <div className={styles.phoneBox}>
        <p className={styles.rowNote}>Điện thoại · cùng trạng thái</p>
        <AudioPlayer {...common} variant="phone" title="Booking a room" />
      </div>
    </div>
  );
}

export function VideoFrameDemo() {
  const [state, setState] = useState<'idle' | 'playing'>('idle');
  return (
    <VideoFrame
      source="self"
      title="Bài 14 · Hoà hợp chủ ngữ và động từ"
      state={state}
      resumeAt={372}
      meta="18:04 · phụ đề tiếng Việt · vị trí xem được nhớ trên mọi thiết bị"
      transcriptHref="#video-frame"
      onPlay={() => setState('playing')}
      onRestart={() => setState('playing')}
    >
      {/* Stands in for the page's own player; only the library draws a label here. */}
      <div className={styles.videoStub}>[KHUNG HÌNH VIDEO]</div>
    </VideoFrame>
  );
}
