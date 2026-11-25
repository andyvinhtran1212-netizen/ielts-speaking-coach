'use client';

// /ui-library section for G03-T15 (UIBASE-0056 FR-009, FR-013): FocusShell in
// both modes and the two leave boxes, as drawn on ThanhPhanKhungTrang §6 and
// PhongThi §4a. Sample content only; "Thoát" opens the real box.
import { Button } from '@/components/ui/button';
import { FOCUS_WORDS } from '@/components/ui/shell/focus-copy';
import { LeaveConfirmFrame } from '@/components/ui/shell/focus-leave-confirm';
import { FocusShell, FocusStatus, FocusTimer } from '@/components/ui/shell/focus-shell';

import styles from './ui-library.module.css';

const always = () => true;

export function FocusShellSection({ title }: { title: string }) {
  return (
    <section id="focus-shell" className={styles.section} aria-labelledby="focus-shell-h">
      <h2 id="focus-shell-h">{title}</h2>
      <p className={styles.demoLabel}>Chế độ luyện · tiếng Việt · bấm &quot;‹ Thoát&quot; để mở hộp hỏi lại</p>
      <div data-testid="focus-practice-demo">
        <FocusShell
          demo
          mode="practice"
          title="Luyện Speaking Part 1 · Quê hương"
          exitHref="#focus-shell"
          hasUnsavedWork={always}
          subline="Câu 2 trên 5"
          right={(
            <>
              <FocusStatus tone="recording">Đang ghi âm 00:42</FocusStatus>
              <FocusStatus>Câu 2 trên 5</FocusStatus>
            </>
          )}
        >
          <div className={styles.focusContent}>[NỘI DUNG TRANG]</div>
        </FocusShell>
      </div>

      <p className={styles.demoLabel}>Chế độ thi · toàn tiếng Anh · đề tự chọn có &quot;Abandon test&quot; · phòng full test luôn sáng</p>
      <div data-testid="focus-exam-demo">
        <FocusShell
          demo
          mode="exam"
          title="Reading · Academic Test 1"
          detail="Passage 1 of 3"
          exitHref="#focus-shell"
          hasUnsavedWork={always}
          onAbandon={() => {}}
          leaveCopy={{ note: 'Come back before 11:05 to continue.' }}
          right={(
            <>
              <FocusStatus>Saved at 10:42</FocusStatus>
              <FocusTimer label="Time remaining" value="52:18" />
            </>
          )}
          bottom={(
            <>
              <span className={styles.focusMuted}>Question 7 of 40 answered</span>
              <Button>Submit test</Button>
            </>
          )}
        >
          <div className={styles.focusContent}>[TEST CONTENT]</div>
        </FocusShell>
      </div>

      <div className={styles.focusLeaveGrid}>
        <div>
          <p className={styles.demoLabel}>Hộp hỏi lại · luyện · chỉ khi thoát sẽ mất bài</p>
          <LeaveConfirmFrame mode="practice" copy={FOCUS_WORDS.practice.leave} />
        </div>
        <div className="av2-always-light">
          <p className={styles.demoLabel}>Hộp hỏi lại · thi · luôn hỏi, không có nút lưu rồi thoát</p>
          <LeaveConfirmFrame mode="exam" copy={{ ...FOCUS_WORDS.exam.leave, note: 'Come back before 11:05 to continue.' }} />
        </div>
      </div>
      <p className={styles.note}>
        Thoát bên trái, tên bài ở giữa (cắt bằng &quot;…&quot; khi dài), đồng hồ hoặc tiến độ bên phải. Không có chân trang, lượt AI, nút tài khoản, chuông hay thanh dưới, và không in tên hay email học viên.
      </p>
    </section>
  );
}
