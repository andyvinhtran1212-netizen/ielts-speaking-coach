'use client';

/**
 * Figure of a Task 1 prompt (LIBRARY-0061 FR-016, ui-states "ảnh lỗi → khối
 * đề không hình kèm chữ"). The image is served by the backend media route; if
 * it fails to load, the prompt block stays and says so in words.
 */
import { useEffect, useRef, useState } from 'react';

import styles from './sample-page.module.css';

export function PromptFigure({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An error before hydration fires no onError: check the settled image once.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) {
    return <p className={styles.quiet}>Không tải được hình của đề. Câu đề ở trên vẫn đủ để đọc ba bài mẫu.</p>;
  }
  return (
    <figure className={styles.figure}>
      {/* eslint-disable-next-line @next/next/no-img-element -- backend media route, no-store (plan §5.5) */}
      <img ref={ref} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    </figure>
  );
}
