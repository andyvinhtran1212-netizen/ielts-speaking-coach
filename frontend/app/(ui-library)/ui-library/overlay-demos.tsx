'use client';

// /ui-library overlay demos for G03-T06 (UIBASE-0056 FR-005, FR-013). Each
// overlay is drawn twice: a static frame in the page flow (what the screenshot
// compares) and a button that opens the real <dialog>, for the keyboard check
// (Tab stays inside, Esc closes, focus returns to the button). Sample data only.
import { useState } from 'react';

import { Button, ConfirmDialog, ConfirmDialogFrame, Dialog, DialogFrame, Select, TextField } from '@/components/ui';

import styles from './ui-library.module.css';

const noop = () => {};

function ShortForm() {
  return (
    <div className={styles.formStack}>
      <Select
        label="Buổi"
        options={[
          { value: '12', label: 'Buổi 12 · Thứ Năm 19/11/2026' },
          { value: '13', label: 'Buổi 13 · Thứ Ba 24/11/2026' },
        ]}
      />
      <TextField label="Ngày mới" defaultValue="20/11/2026" inputMode="numeric" />
    </div>
  );
}

function StudentSummary() {
  return (
    <dl className={styles.summary}>
      <dt>Lớp</dt><dd>Tue–Thu 19:30</dd>
      <dt>Mục tiêu</dt><dd>6.5</dd>
      <dt>Bài quá hạn</dt><dd>2</dd>
      <dt>Band gần đây</dt><dd>5.5</dd>
    </dl>
  );
}

export function DialogShowcase() {
  const [open, setOpen] = useState<null | 'sm' | 'md' | 'drawer'>(null);
  const close = () => setOpen(null);
  const smActions = (onClick: () => void) => (
    <>
      <Button onClick={onClick}>Gửi nhắc nhở</Button>
      <Button variant="secondary" onClick={onClick}>Huỷ</Button>
    </>
  );
  const mdActions = (onClick: () => void) => (
    <>
      <Button onClick={onClick}>Dời buổi</Button>
      <Button variant="secondary" onClick={onClick}>Huỷ</Button>
    </>
  );
  const drawerActions = (onClick: () => void) => (
    <>
      <Button href="#dialog">Mở hồ sơ</Button>
      <Button variant="secondary" onClick={onClick}>Gửi nhắc nhở</Button>
    </>
  );
  return (
    <>
      <div className={styles.overlayGrid}>
        <div>
          <p className={styles.rowNote}>Modal nhỏ · rộng 400px · hỏi một việc</p>
          <div className={styles.stage}>
            <DialogFrame titleId="demo-sm-t" title="Gửi nhắc nhở cho 3 học viên?" onClose={noop} actions={smActions(noop)}>
              <p>Mỗi học viên nhận một email liệt kê bài còn thiếu.</p>
            </DialogFrame>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen('sm')}>Mở modal nhỏ</Button>
        </div>
        <div>
          <p className={styles.rowNote}>Modal vừa · rộng 520px · biểu mẫu ngắn</p>
          <div className={styles.stage}>
            <DialogFrame titleId="demo-md-t" size="md" title="Dời buổi 12 · Tue–Thu 19:30" onClose={noop} actions={mdActions(noop)}>
              <ShortForm />
            </DialogFrame>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen('md')}>Mở modal vừa</Button>
        </div>
        <div>
          <p className={styles.rowNote}>Ngăn kéo · trượt từ phải · rộng 420px</p>
          <div className={styles.drawerStage}>
            <DialogFrame titleId="demo-dr-t" variant="drawer" title="Nguyễn Minh Anh" closeLabel="Đóng xem nhanh" onClose={noop} actions={drawerActions(noop)}>
              <StudentSummary />
            </DialogFrame>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen('drawer')}>Mở ngăn kéo</Button>
        </div>
      </div>

      <Dialog open={open === 'sm'} onClose={close} title="Gửi nhắc nhở cho 3 học viên?" actions={smActions(close)}>
        <p>Mỗi học viên nhận một email liệt kê bài còn thiếu.</p>
      </Dialog>
      <Dialog open={open === 'md'} onClose={close} size="md" title="Dời buổi 12 · Tue–Thu 19:30" actions={mdActions(close)}>
        <ShortForm />
      </Dialog>
      <Dialog open={open === 'drawer'} onClose={close} variant="drawer" title="Nguyễn Minh Anh" closeLabel="Đóng xem nhanh" actions={drawerActions(close)}>
        <StudentSummary />
      </Dialog>
    </>
  );
}

export function ConfirmShowcase() {
  const [open, setOpen] = useState<null | 'vi' | 'en'>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className={styles.fieldGrid2}>
        <div>
          <p className={styles.rowNote}>Cảnh báo · tiếng Việt</p>
          <ConfirmDialogFrame
            tone="warning"
            title="Nộp bài khi còn 3 câu chưa trả lời?"
            body="Câu 7, 12 và 13 đang để trống. Nộp rồi thì không sửa được nữa."
            confirmLabel="Nộp bài"
            cancelLabel="Quay lại làm tiếp"
          />
          <Button variant="secondary" size="sm" onClick={() => setOpen('vi')}>Mở hộp hỏi lại</Button>
        </div>
        <div>
          <p className={styles.rowNote}>Phòng thi · tiếng Anh · đang nộp</p>
          <ConfirmDialogFrame
            tone="warning"
            lang="en"
            title="Submit the test with 3 questions unanswered?"
            body="Questions 7, 12 and 13 are blank. You cannot change answers after submitting."
            confirmLabel="Submit test"
            cancelLabel="Keep working"
            busy
            busyLabel="Submitting…"
          />
          <p className={styles.rowNote}>Mặc định (không cảnh báo)</p>
          <ConfirmDialogFrame title="Rời trang khi bài chưa lưu?" body="Bài viết sẽ mất nếu bạn rời trang." confirmLabel="Ở lại" cancelLabel="Rời trang" />
          <Button variant="secondary" size="sm" onClick={() => setOpen('en')}>Open exam dialog</Button>
        </div>
      </div>
      <ConfirmDialog
        open={open === 'vi'}
        tone="warning"
        title="Nộp bài khi còn 3 câu chưa trả lời?"
        body="Câu 7, 12 và 13 đang để trống. Nộp rồi thì không sửa được nữa."
        confirmLabel="Nộp bài"
        cancelLabel="Quay lại làm tiếp"
        onConfirm={close}
        onCancel={close}
      />
      <ConfirmDialog
        open={open === 'en'}
        tone="warning"
        lang="en"
        title="Submit the test with 3 questions unanswered?"
        body="Questions 7, 12 and 13 are blank. You cannot change answers after submitting."
        confirmLabel="Submit test"
        cancelLabel="Keep working"
        onConfirm={close}
        onCancel={close}
      />
    </>
  );
}
