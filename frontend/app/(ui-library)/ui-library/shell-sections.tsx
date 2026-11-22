import { AiCreditsIndicator } from '@/components/ui/shell/ai-credits';
import { LearnerPanelProvider } from '@/components/ui/shell/learner-panel';

import { LearnerShellDemo, SampleBell, SampleOverdue } from './learner-demo';
import styles from './ui-library.module.css';

/**
 * G03-T14 (FR-007, FR-008, FR-016, FR-017). The shell follows the window width,
 * so resize to see all three: ≥1024px one row, 768–1023px "Menu: Luyện tập",
 * <768px the bottom bar. The page has no learner route, so the demo shows the
 * "Luyện tập" section (acceptance scenario 3).
 */
export function LearnerShellSection({ title }: { title: string }) {
  return (
    <section id="learner-shell" className={styles.section} aria-labelledby="learner-shell-h">
      <h2 id="learner-shell-h">{title}</h2>
      <p>
        Khung đổi theo bề rộng cửa sổ: từ 1024px năm mục một hàng; 768–1023px nút &ldquo;Menu: Luyện tập&rdquo;;
        dưới 768px thanh dưới. Bấm kính lúp hoặc phím / rồi gõ &ldquo;agree&rdquo;; bấm VT để mở menu tài khoản admin.
      </p>
      <div className={styles.shellFrame} data-testid="learner-shell-demo">
        <LearnerShellDemo />
      </div>

      <h3>Chuông thông báo · ba trạng thái</h3>
      <LearnerPanelProvider>
        <div className={styles.demoRow}>
          <SampleBell />
          <SampleBell unread={2} />
          <span className={styles.demoRow}><SampleOverdue count={3} /><SampleBell /></span>
        </div>
      </LearnerPanelProvider>

      <h3>Lượt chấm AI</h3>
      <div className={styles.demoRow}>
        <AiCreditsIndicator credits={{ remaining: null, low: false }} />
        <AiCreditsIndicator credits={{ remaining: null, low: true }} />
        <AiCreditsIndicator trialLeft={2} />
      </div>
    </section>
  );
}
