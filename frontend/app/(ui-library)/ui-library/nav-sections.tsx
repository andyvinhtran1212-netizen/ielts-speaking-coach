// /ui-library sections for G03-T07 (UIBASE-0056 FR-005, FR-013): Tabs,
// Breadcrumb/BackLink, Pagination, ProgressBar, Stepper, as drawn on
// ThanhPhan §6, ThanhPhanDuLieu §5 and §8, KhungTrang §5. Sample data only.
import { BackLink, Breadcrumb, Notice, Pagination, ProgressBar, Stepper, Tabs } from '@/components/ui';

import { StepperDemo, TabsDemo } from './nav-demos';
import styles from './ui-library.module.css';

const pageHref = (page: number) => `#pagination-${page}`;

export function TabsSection({ title }: { title: string }) {
  return (
    <section id="tabs" className={styles.section} aria-labelledby="tabs-h">
      <h2 id="tabs-h">{title}</h2>
      <p className={styles.demoLabel}>Thẻ trong trang · ← → chuyển thẻ</p>
      <TabsDemo />
      <p className={styles.demoLabel}>Thẻ là liên kết (đổi địa chỉ trang)</p>
      <Tabs
        label="Kho đề"
        active="writing"
        items={[
          { id: 'writing', label: 'Writing', count: 312, href: '#tabs' },
          { id: 'speaking', label: 'Speaking', count: 237, href: '#tabs' },
        ]}
      />
    </section>
  );
}

export function BreadcrumbSection({ title }: { title: string }) {
  return (
    <section id="breadcrumb" className={styles.section} aria-labelledby="breadcrumb-h">
      <h2 id="breadcrumb-h">{title}</h2>
      <p className={styles.demoLabel}>Máy tính: cả chuỗi, mục cuối là trang hiện tại · điện thoại: chỉ “‹ trang cha”</p>
      <Breadcrumb
        items={[
          { label: 'Luyện tập', href: '#breadcrumb' },
          { label: 'Writing', href: '#breadcrumb' },
          { label: 'Task 2 — Công nghệ và việc làm của người trẻ' },
        ]}
      />
      <p className={styles.demoLabel}>Quay lại đứng riêng</p>
      <BackLink parentLabel="Listening" href="#breadcrumb" />
      <p className={styles.note}>Không dùng “← Back”, “Quay lại” không nói về đâu, hay chỉ một mũi tên.</p>
    </section>
  );
}

export function PaginationSection({ title }: { title: string }) {
  return (
    <section id="pagination" className={styles.section} aria-labelledby="pagination-h">
      <h2 id="pagination-h">{title}</h2>
      <div className={styles.stack}>
        <Pagination page={2} totalPages={11} totalLabel="549 đề" hrefFor={pageHref} />
        <Pagination page={1} totalPages={11} totalLabel="549 đề" hrefFor={pageHref} />
        <Pagination page={11} totalPages={11} totalLabel="549 đề" hrefFor={pageHref} />
      </div>
    </section>
  );
}

export function ProgressBarSection({ title }: { title: string }) {
  return (
    <section id="progress-bar" className={styles.section} aria-labelledby="progress-bar-h">
      <h2 id="progress-bar-h">{title}</h2>
      <div className={styles.progressGrid}>
        <div className={styles.stack}>
          <p className={styles.rowNote}>Xác định</p>
          <ProgressBar label="Lộ trình Writing" value={13} total={48} unit="bài" note="Đang học · còn 35 bài" />
          <ProgressBar label="Lộ trình Reading" value={0} total={48} unit="bài" note="Chưa bắt đầu" />
          <ProgressBar label="Lộ trình Listening" value={48} total={48} unit="bài" />
        </div>
        <div className={styles.stack}>
          <p className={styles.rowNote}>Không xác định · đang xử lý</p>
          <ProgressBar
            mode="indeterminate"
            label="Đang chấm bài Writing"
            note="Đang xử lý… thường mất khoảng 2 phút. Bạn có thể rời trang, kết quả sẽ nằm trong “Bài đã nộp”."
          />
        </div>
        <div className={styles.stack}>
          <p className={styles.rowNote}>Theo bước</p>
          <ProgressBar
            mode="steps"
            label="Nhập danh sách học viên"
            value={2}
            total={4}
            stepLabel="Kiểm tra thử"
            note="Đang làm: Kiểm tra thử · tiếp theo: Xác nhận"
          />
          <ProgressBar
            label="Đang nhập 1 284 dòng"
            value={640}
            total={1284}
            note="Giữ trang này mở. Nếu mất mạng, lần sau nhập tiếp từ dòng 641."
          />
        </div>
      </div>
      <p className={styles.note}>Không hiện phần trăm khi tổng nhỏ: “13 trên 48 bài” dễ hiểu hơn “27%”.</p>
    </section>
  );
}

export function StepperSection({ title }: { title: string }) {
  return (
    <section id="stepper" className={styles.section} aria-labelledby="stepper-h">
      <h2 id="stepper-h">{title}</h2>
      <p className={styles.demoLabel}>Đang làm · bấm “Tiếp tục” / “Quay lại”</p>
      <StepperDemo />
      <p className={styles.demoLabel}>Bước lỗi · kiểm tra thử phát hiện dòng sai</p>
      <Stepper
        label="Các bước nhập dữ liệu, có lỗi"
        steps={[
          { label: 'Chọn file', status: 'done', href: '#stepper' },
          { label: 'Kiểm tra thử', status: 'error', note: 'Có lỗi · 12 dòng cần sửa' },
          { label: 'Xác nhận', status: 'locked', note: 'Chưa tới · khoá cho tới khi hết lỗi' },
          { label: 'Xong', status: 'todo' },
        ]}
      />
      <Notice className={styles.gapTop} kind="error" live="none" title="12 dòng chưa nhập được." action={<a href="#stepper">Tải file các dòng lỗi</a>}>
        9 dòng thiếu email, 3 dòng trùng học viên đã có. Chưa có gì được ghi vào hệ thống.
      </Notice>
    </section>
  );
}
