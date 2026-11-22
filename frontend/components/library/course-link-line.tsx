/**
 * The one way from a Library page to the courses (LIBRARY-0061 T007, FR-003;
 * tờ KienThucWriting §1 cuối danh sách, §2 cuối bài): a single line of text with
 * one link, placed at the end of a list or article, never mid-article and never
 * as a pop-up.
 *
 * Hidden only when the viewer is known to have a course that contains this
 * content (`hasCourse === true`, from G04 data). Unknown (`null`/`undefined`,
 * e.g. a guest or a failed lookup) shows the line.
 */
import type { ReactNode } from 'react';

import styles from './course-link-line.module.css';

export type CourseLinkLineProps = {
  /** Sentence before the link, e.g. "Đọc ở đây là miễn phí. Muốn nộp bài để AI chấm…". */
  children: ReactNode;
  href: string;
  linkLabel: string;
  hasCourse?: boolean | null;
};

export function CourseLinkLine({ children, href, linkLabel, hasCourse }: CourseLinkLineProps) {
  if (hasCourse === true) return null;
  return (
    <p className={styles.line} data-course-link="">
      {children} <a href={href} className={styles.link}>{linkLabel}</a>
    </p>
  );
}
