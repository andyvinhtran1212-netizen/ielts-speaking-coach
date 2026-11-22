// /ui-library section for G03-T18 part 2 (UIBASE-0056 FR-020, FR-021, FR-024),
// as drawn on CheDoToi.dc.html §3: ThemeMenu, the Account-page radio group, the
// open menu, and an always-light area. Sample content only.
import { MediaPlaceholder, ThemeChoiceGroup, ThemeMenu, ThemeMenuList } from '@/components/ui';

import styles from './ui-library.module.css';

export function ThemeSection({ title }: { title: string }) {
  return (
    <section id="theme" className={styles.section} aria-labelledby="theme-h">
      <h2 id="theme-h">{title}</h2>
      <div className={styles.themeGrid}>
        <div>
          <p className={styles.demoLabel}>Nút trên thanh · bấm thử, đổi là áp ngay</p>
          <ThemeMenu />
          <p className={styles.demoLabel}>Trang Tài khoản · nhóm radio</p>
          <ThemeChoiceGroup />
        </div>
        <div>
          <p className={styles.demoLabel}>Menu đang mở · khi chọn Theo thiết bị, máy đang tối</p>
          {/* A drawing of the open menu: inert, so it is neither focusable nor announced. */}
          <div inert>
            <ThemeMenuList choice="system" device="dark" />
          </div>
        </div>
        <div>
          <p className={styles.demoLabel}>Luôn sáng (lớp .av2-always-light) · ảnh đề Task 1, mã QR, thư, bản in</p>
          <div className={`av2-always-light ${styles.alwaysLight}`}>
            <MediaPlaceholder kind="chart" ratio="16:9" caption="Ảnh đề Task 1: nền sáng, có viền, kể cả khi web đang tối" />
          </div>
        </div>
      </div>
      <p className={styles.note}>Lựa chọn chỉ lưu trên trình duyệt này (khoá av-theme); “Theo thiết bị” là xoá khoá. Tab khác đổi theo ngay.</p>
    </section>
  );
}
