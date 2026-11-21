// /ui-library sections for G03-T06 (UIBASE-0056 FR-005, FR-013): Notice,
// Dialog, ConfirmDialog, PageState, MediaPlaceholder/PendingValue, as drawn on
// ThanhPhan §4–5 and ThanhPhanDuLieu §6. Sample data only.
import { Button, MediaPlaceholder, Notice, PageState, PendingValue } from '@/components/ui';

import { ConfirmShowcase, DialogShowcase } from './overlay-demos';
import styles from './ui-library.module.css';

export function NoticeSection({ title }: { title: string }) {
  return (
    <section id="notice" className={styles.section} aria-labelledby="notice-h">
      <h2 id="notice-h">{title}</h2>
      <div className={styles.fieldGrid2}>
        <Notice kind="info" live="none" title="Đã lưu bản nháp.">Bạn có thể đóng trang và viết tiếp sau.</Notice>
        <Notice kind="success" live="none" title="Đã nộp bài.">Kết quả thường có sau 2 phút.</Notice>
        <Notice kind="warning" live="none" title="Còn 5 phút.">Bài sẽ tự nộp khi hết giờ.</Notice>
        <Notice kind="error" live="none" title="Chưa nộp được bài." action={<a href="#notice">Thử nộp lại</a>}>
          Mất kết nối mạng. Bài vẫn còn trên máy bạn.
        </Notice>
        <Notice kind="warning" live="none" lang="en" title="5 minutes left.">The test is submitted automatically when time runs out.</Notice>
        <Notice kind="error" live="none" lang="en" title="Answers not saved.">Check your connection.</Notice>
      </div>
      <p className={styles.note}>
        Cảnh báo và lỗi luôn có viền trái dày, nền nhạt, biểu tượng và nhãn chữ, không chỉ đổi màu. Trong phòng thi nhãn bằng tiếng Anh.
      </p>
    </section>
  );
}

export function DialogSection({ title }: { title: string }) {
  return (
    <section id="dialog" className={styles.section} aria-labelledby="dialog-h">
      <h2 id="dialog-h">{title}</h2>
      <DialogShowcase />
      <p className={styles.note}>
        Nút đóng góc phải, phím Esc và bấm ra nền đều đóng; mở lên thì con trỏ phím vào lớp phủ, đóng thì trả về nút đã mở. Điện thoại: modal vừa và ngăn kéo chiếm toàn màn.
      </p>
    </section>
  );
}

export function ConfirmDialogSection({ title }: { title: string }) {
  return (
    <section id="confirm-dialog" className={styles.section} aria-labelledby="confirm-dialog-h">
      <h2 id="confirm-dialog-h">{title}</h2>
      <ConfirmShowcase />
      <p className={styles.note}>
        Thay cho hộp thoại mặc định của trình duyệt. Tiêu đề là câu hỏi; nút xác nhận lặp lại động từ của câu hỏi. Nút đỏ mận chỉ dùng ở đây và trong khối cảnh báo.
      </p>
    </section>
  );
}

export function PageStateSection({ title }: { title: string }) {
  return (
    <section id="page-state" className={styles.section} aria-labelledby="page-state-h">
      <h2 id="page-state-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <PageState
          kind="empty"
          title="Chưa có bài nào được giao"
          body="Khi giáo viên giao bài, bài sẽ hiện ở đây kèm hạn nộp."
          action={<a href="#page-state">Tự luyện một đề Writing</a>}
        />
        <PageState
          kind="error"
          title="Chưa tải được danh sách đề"
          body="Máy chủ không trả lời. Bài bạn đã làm không bị ảnh hưởng."
          action={<Button variant="secondary">Tải lại</Button>}
        />
        <PageState kind="loading" title="Đang tải danh sách đề" />
        <PageState
          kind="locked"
          title="Nộp bài để AI chấm cần một khoá học"
          body={<>Bạn vẫn đọc được đề và bài mẫu miễn phí. Tài khoản miễn phí có <PendingValue /> lượt chấm thử.</>}
          action={<Button href="#page-state">Xem các khoá</Button>}
        />
      </div>
    </section>
  );
}

export function MediaPlaceholderSection({ title }: { title: string }) {
  return (
    <section id="media-placeholder" className={styles.section} aria-labelledby="media-placeholder-h">
      <h2 id="media-placeholder-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <MediaPlaceholder kind="illustration" caption="Sơ đồ câu chữ tự vẽ · tỉ lệ 4:3" />
        <MediaPlaceholder kind="video" caption="nguồn · thời lượng" />
        <MediaPlaceholder kind="chart" tag="BIỂU ĐỒ TASK 1" caption="ảnh đề bài" />
        <div className={styles.pendingBox}>
          <p className={styles.pendingTitle}>Dữ liệu chưa chốt</p>
          <p className={styles.pendingBody}>
            Viết <PendingValue /> đúng chỗ số liệu sẽ nằm: giá <PendingValue /> · thời hạn <PendingValue /> · <PendingValue /> lượt chấm AI.
          </p>
        </div>
      </div>
    </section>
  );
}
