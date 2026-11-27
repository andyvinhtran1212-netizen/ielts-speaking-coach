// Kept on purpose (GOI-06 G06-T14 vướng mắc (b)): removing it changes how the
// article streams. Only the skeleton follows the new reading frame.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { av2FontClass } from '@/styles/av2/fonts';

import styles from './article.module.css';

export default function Loading() {
  return (
    <>
      {/* @ts-ignore custom element is registered by the public-content layout */}
      <aver-chrome active="grammar" />
      <div className={`av2-root ${av2FontClass} ${styles.page}`}>
        <div className={styles.inner} aria-busy="true">
          <p className={styles.loadingNote} role="status">Đang tải bài Grammar…</p>
          <div className={styles.skeleton} aria-hidden="true">
            <span className={styles.skelToc} />
            <span className={styles.skelText}>
              <span className={styles.skelLine} data-w="eyebrow" />
              <span className={styles.skelLine} data-w="title" />
              <span className={styles.skelLine} data-w="meta" />
              <span className={styles.skelLine} />
              <span className={styles.skelLine} />
              <span className={styles.skelLine} data-w="short" />
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
