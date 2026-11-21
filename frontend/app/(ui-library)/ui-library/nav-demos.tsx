'use client';

// /ui-library interactive demos for G03-T07: a tablist that switches its panel
// and a stepper driven by "Quay lại" / "Tiếp tục". Sample data only.
import { useState } from 'react';

import { Button, Stepper, Tabs, type Step } from '@/components/ui';

import styles from './ui-library.module.css';

const TAB_ITEMS = [
  { id: 'assigned', label: 'Bài được giao', count: 4 },
  { id: 'submitted', label: 'Bài đã nộp' },
  { id: 'bank', label: 'Kho đề' },
] as const;

const PANELS: Record<string, string> = {
  assigned: '4 bài được giao, sớm nhất hạn nộp 22/11/2026.',
  submitted: 'Bài đã nộp hiện ở đây kèm trạng thái chấm.',
  bank: 'Kho đề Writing và Speaking để tự luyện.',
};

export function TabsDemo() {
  const [active, setActive] = useState<string>('assigned');
  return (
    <Tabs label="Bài của tôi" items={TAB_ITEMS} active={active} onChange={setActive}>
      <p className={styles.panelText}>{PANELS[active]}</p>
    </Tabs>
  );
}

const STEP_LABELS = ['Chọn file', 'Kiểm tra thử', 'Xác nhận', 'Xong'] as const;

export function StepperDemo() {
  const [current, setCurrent] = useState(1);
  const steps: Step[] = STEP_LABELS.map((label, i) => ({
    label,
    status: i < current ? 'done' : i === current ? 'current' : 'todo',
    href: i < current ? '#stepper' : undefined,
  }));
  return (
    <>
      <Stepper label="Các bước nhập dữ liệu" steps={steps} />
      <div className={`${styles.row} ${styles.gapTop}`}>
        <Button variant="secondary" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>Quay lại</Button>
        <Button disabled={current === STEP_LABELS.length - 1} onClick={() => setCurrent((c) => c + 1)}>
          {current === STEP_LABELS.length - 2 ? 'Nhập dữ liệu' : 'Tiếp tục'}
        </Button>
        <span role="status" className={styles.rowNote}>Bước {current + 1} trên {STEP_LABELS.length}</span>
      </div>
    </>
  );
}
