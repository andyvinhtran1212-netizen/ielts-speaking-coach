import { Icon } from './icon/icon';
import { ProgressBar } from './progress-bar';
import styles from './stepper.module.css';
import { cx } from './cx';

export type StepStatus = 'done' | 'current' | 'todo' | 'locked' | 'error';

export type Step = {
  /** A verb phrase: "Chọn file", "Kiểm tra thử", "Xác nhận". */
  label: string;
  status: StepStatus;
  /** State in words under the name; defaults per status ("Xong", "Đang làm"…). */
  note?: string;
  /** Done steps with a link can be reopened; other steps are never links. */
  href?: string;
};

export type StepperProps = {
  steps: readonly Step[];
  /** Accessible name of the list, e.g. "Các bước nhập dữ liệu". */
  label: string;
  className?: string;
};

const NOTES: Record<StepStatus, string> = {
  done: 'Xong',
  current: 'Đang làm',
  todo: 'Chưa tới',
  locked: 'Chưa tới · đang khoá',
  error: 'Có lỗi',
};

/**
 * Fixed sequence of 3–5 steps (UIBASE-0056 FR-005, ThanhPhanDuLieu §8).
 * Every step says its state in words. `error` is the sheet's "Bước lỗi"
 * state, in addition to the four statuses of plan 5.4. Below 768px the list
 * collapses to "Bước 2 trên 4 · Kiểm tra thử" with a steps progress bar.
 */
export function Stepper({ steps, label, className }: StepperProps) {
  const currentIndex = steps.findIndex((step) => step.status === 'current' || step.status === 'error');
  const current = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const next = currentIndex >= 0 ? steps[currentIndex + 1] : undefined;
  return (
    <div className={className}>
      <ol aria-label={label} className={styles.list}>
        {steps.map((step, i) => {
          const isCurrent = step.status === 'current' || step.status === 'error';
          const name = step.status === 'done' && step.href
            ? <a href={step.href} className={styles.name}>{step.label}</a>
            : <span className={styles.name}>{step.label}</span>;
          return (
            <li key={`${step.label}-${i}`} aria-current={isCurrent ? 'step' : undefined} className={cx(styles.step, styles[step.status])}>
              <span className={styles.track}>
                <span className={styles.marker} aria-hidden="true">
                  {step.status === 'done' ? <Icon name="check" size={16} /> : step.status === 'error' ? '!' : i + 1}
                </span>
                {i < steps.length - 1 ? <span aria-hidden="true" className={styles.line} /> : null}
              </span>
              {name}
              <span className={styles.note}>{step.note ?? NOTES[step.status]}</span>
            </li>
          );
        })}
      </ol>
      <ProgressBar
        className={styles.compact}
        mode="steps"
        label={label}
        value={currentIndex >= 0 ? currentIndex + 1 : steps.length}
        total={steps.length}
        stepLabel={current?.label}
        note={
          current?.status === 'error'
            ? `${current.label}: ${current.note ?? NOTES.error}`
            : current ? `Đang làm: ${current.label}${next ? ` · tiếp theo: ${next.label}` : ''}` : undefined
        }
      />
    </div>
  );
}
