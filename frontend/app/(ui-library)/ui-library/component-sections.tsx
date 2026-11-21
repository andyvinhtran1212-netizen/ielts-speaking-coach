// /ui-library sections for G03-T05 (UIBASE-0056 FR-005, FR-013): every state of
// the first eight components, as drawn on ThanhPhan §1–3. Sample data only.
import type { ReactNode } from 'react';

import {
  Button, ChoiceGroup, Icon, IconButton, SearchField, Select, StatusBadge, TextArea, TextField,
} from '@/components/ui';

import styles from './ui-library.module.css';

const STATES = ['Mặc định', 'Rê chuột', 'Đang chọn bằng phím', 'Đang xử lý', 'Vô hiệu'] as const;

const BUTTON_ROWS = [
  { variant: 'primary', name: 'Chính', note: 'một nút mỗi màn', label: 'Nộp bài', busy: 'Đang nộp…' },
  { variant: 'secondary', name: 'Phụ', note: '', label: 'Lưu nháp', busy: 'Đang lưu…' },
  { variant: 'text', name: 'Chữ', note: 'việc ít quan trọng', label: 'Xem lại đáp án', busy: null },
  { variant: 'danger', name: 'Nguy hiểm', note: 'luôn hỏi lại', label: 'Xoá bài nháp', busy: 'Đang xoá…' },
] as const;

function Cell({ state, children, caption = false }: { state: string; children: ReactNode; caption?: boolean }) {
  return (
    <div className={styles.stateCell}>
      <span className={caption ? styles.rowNote : styles.stateLabel}>{state}</span>
      {children}
    </div>
  );
}

export function ButtonSection({ title }: { title: string }) {
  return (
    <section id="button" className={styles.section} aria-labelledby="button-h">
      <h2 id="button-h">{title}</h2>
      <div className={styles.stateGrid}>
        <span className={styles.stateHead} aria-hidden="true" />
        {STATES.map((s) => <span key={s} className={styles.stateHead}>{s}</span>)}
        {BUTTON_ROWS.map((row) => (
          <div key={row.variant} className={styles.stateRow}>
            <span className={styles.rowName}>
              {row.name}
              {row.note ? <span className={styles.rowNote}>{row.note}</span> : null}
            </span>
            <Cell state={STATES[0]}><Button variant={row.variant} loadingLabel={row.busy ?? undefined}>{row.label}</Button></Cell>
            <Cell state={STATES[1]}><Button variant={row.variant} loadingLabel={row.busy ?? undefined} data-demo-state="hover">{row.label}</Button></Cell>
            <Cell state={STATES[2]}><Button variant={row.variant} loadingLabel={row.busy ?? undefined} data-demo-state="focus">{row.label}</Button></Cell>
            <Cell state={STATES[3]}>
              {row.busy
                ? <Button variant={row.variant} loading loadingLabel={row.busy}>{row.label}</Button>
                : <span className={styles.rowNote}>không dùng</span>}
            </Cell>
            <Cell state={STATES[4]}><Button variant={row.variant} loadingLabel={row.busy ?? undefined} disabled>{row.label}</Button></Cell>
          </div>
        ))}
      </div>
      <h3 className={styles.subhead}>Cỡ, biểu tượng, liên kết</h3>
      <div className={styles.row}>
        <Button size="lg">Bắt đầu (48px)</Button>
        <Button size="md">Bắt đầu (44px)</Button>
        <Button size="sm" variant="secondary">Sửa (36px)</Button>
        <Button variant="secondary" iconStart={<Icon name="plus" />}>Thêm câu hỏi</Button>
        <Button href="#button">Vào khoá học</Button>
        <Button href="#button" variant="secondary">Xem các khoá</Button>
      </div>
      <p className={styles.note}>Cỡ: 48px trên điện thoại · 44px mặc định · 36px trong bảng admin. Nút chỉ có biểu tượng phải có nhãn đọc cho trình đọc màn hình.</p>
    </section>
  );
}

export function IconButtonSection({ title }: { title: string }) {
  return (
    <section id="icon-button" className={styles.section} aria-labelledby="icon-button-h">
      <h2 id="icon-button-h">{title}</h2>
      <div className={styles.row}>
        <Cell caption state="Mặc định"><IconButton icon="pencil" label="Sửa bài" /></Cell>
        <Cell caption state="Rê chuột"><IconButton icon="pencil" label="Sửa bài" data-demo-state="hover" /></Cell>
        <Cell caption state="Đang chọn bằng phím"><IconButton icon="pencil" label="Sửa bài" data-demo-state="focus" /></Cell>
        <Cell caption state="Vô hiệu"><IconButton icon="pencil" label="Sửa bài" disabled /></Cell>
        <Cell caption state="Có viền"><IconButton icon="trash" label="Xoá bài nháp" variant="outline" /></Cell>
        <Cell caption state="48 · 44 · 36px">
          <span className={styles.row}>
            <IconButton icon="close" label="Đóng" size="lg" />
            <IconButton icon="close" label="Đóng" size="md" />
            <IconButton icon="close" label="Đóng" size="sm" />
          </span>
        </Cell>
      </div>
    </section>
  );
}

export function TextFieldSection({ title }: { title: string }) {
  return (
    <section id="text-field" className={styles.section} aria-labelledby="text-field-h">
      <h2 id="text-field-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <TextField label="Họ và tên" placeholder="Ví dụ: Nguyễn Minh Anh" hint="Chữ mờ là ví dụ, không thay cho nhãn." />
        <TextField label="Email" type="email" defaultValue="minhanh@example.com" hint="Đang nhập: viền đậm 2px." data-demo-state="focus" />
        <TextField label="Mã kích hoạt" defaultValue="K7QM-24RT-9XWD" error="Mã không đúng hoặc đã hết hạn." />
        <TextField label="Lớp" defaultValue="Tue–Thu 19:30" readOnlyReason="Lớp do giáo viên xếp; nhờ giáo viên đổi nếu cần." />
      </div>
    </section>
  );
}

export function TextAreaSection({ title }: { title: string }) {
  return (
    <section id="text-area" className={styles.section} aria-labelledby="text-area-h">
      <h2 id="text-area-h">{title}</h2>
      <div className={styles.fieldGrid2}>
        <TextArea label="Bài viết của bạn" placeholder="Viết ít nhất 250 từ." saveStatus="Đã lưu lúc 10:42" wordCount={{ count: 0, limit: 250 }} />
        <TextArea
          label="Ghi chú cho giáo viên"
          defaultValue="Em chưa chắc đoạn mở bài."
          error="Ghi chú dài quá 500 ký tự; bớt đi 32 ký tự."
        />
      </div>
    </section>
  );
}

export function SelectSection({ title }: { title: string }) {
  return (
    <section id="select" className={styles.section} aria-labelledby="select-h">
      <h2 id="select-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <Select label="Dạng đề" options={[{ value: '', label: 'Tất cả dạng đề' }, { value: 'opinion', label: 'Opinion' }]} />
        <Select label="Kỹ năng" defaultValue="writing" hint="Chọn một kỹ năng." options={[{ value: 'writing', label: 'Writing' }, { value: 'speaking', label: 'Speaking' }]} />
        <Select label="Lớp" disabled options={[{ value: 'a', label: 'Tue–Thu 19:30' }]} />
      </div>
    </section>
  );
}

export function SearchFieldSection({ title }: { title: string }) {
  return (
    <section id="search-field" className={styles.section} aria-labelledby="search-field-h">
      <h2 id="search-field-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <div>
          <p className={styles.rowNote}>Rỗng</p>
          <SearchField label="Tìm trong thư viện" placeholder="Tìm đề, bài mẫu, từ vựng" />
        </div>
        <div>
          <p className={styles.rowNote}>Có chữ: nút xoá</p>
          <SearchField label="Tìm trong thư viện" placeholder="Tìm đề, bài mẫu, từ vựng" defaultValue="present perfect" />
        </div>
      </div>
    </section>
  );
}

export function ChoiceGroupSection({ title }: { title: string }) {
  return (
    <section id="choice-group" className={styles.section} aria-labelledby="choice-group-h">
      <h2 id="choice-group-h">{title}</h2>
      <div className={styles.fieldGrid}>
        <ChoiceGroup mode="single" legend="Chọn một" defaultValue="t1" options={[{ value: 't1', label: 'Task 1' }, { value: 't2', label: 'Task 2' }]} />
        <ChoiceGroup mode="multiple" legend="Chọn nhiều" defaultValue={['overdue']} options={[{ value: 'overdue', label: 'Chỉ bài quá hạn' }, { value: 'hide', label: 'Ẩn bài đã chấm' }]} />
        <ChoiceGroup mode="single" legend="Kỳ thi" hint="Kỳ thi đã đóng không chọn được." options={[{ value: 'nov', label: 'Tháng 11' }, { value: 'oct', label: 'Tháng 10', disabled: true }]} />
        <ChoiceGroup mode="single" legend="Hình thức nộp" error="Chọn một hình thức nộp." options={[{ value: 'online', label: 'Trực tuyến' }, { value: 'paper', label: 'Bài giấy' }]} />
      </div>
    </section>
  );
}

export function StatusBadgeSection({ title }: { title: string }) {
  return (
    <section id="status-badge" className={styles.section} aria-labelledby="status-badge-h">
      <h2 id="status-badge-h">{title}</h2>
      <p className={styles.note}>Luôn là chữ tiếng Việt kèm màu; không dùng draft, published, live, graded.</p>
      <div className={styles.badgeGrid}>
        <span className={styles.rowName}>Bài của học viên</span>
        <div className={styles.row}>
          <StatusBadge set="work" value="not_started" />
          <StatusBadge set="work" value="in_progress" />
          <StatusBadge set="work" value="submitted" />
          <StatusBadge set="work" value="graded" />
          <StatusBadge set="work" value="returned" />
          <StatusBadge set="work" value="overdue" detail="2 ngày" />
        </div>
        <span className={styles.rowName}>Nội dung (admin)</span>
        <div className={styles.row}>
          <StatusBadge set="content" value="draft" />
          <StatusBadge set="content" value="published" />
          <StatusBadge set="content" value="archived" />
        </div>
        <span className={styles.rowName}>Quyền học</span>
        <div className={styles.row}>
          <StatusBadge set="access" value="active" />
          <StatusBadge set="access" value="expiring" detail="còn 7 ngày" />
          <StatusBadge set="access" value="expired" />
          <StatusBadge set="access" value="locked" />
        </div>
      </div>
    </section>
  );
}
