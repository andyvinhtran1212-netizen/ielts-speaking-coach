'use client';

import { useId, useRef, useState, type DragEvent } from 'react';

import styles from './file-upload.module.css';
import { cx } from './cx';

export type UploadFileStatus = 'uploading' | 'done' | 'error' | 'cancelled';

export type UploadFileError = { title: string; body: string };

export type UploadFile = {
  id: string;
  name: string;
  status: UploadFileStatus;
  /** Bytes; shown as "240 KB" when done and as the total while uploading. */
  size?: number;
  /** Bytes sent so far, while uploading. */
  loaded?: number;
  /** Extra words after the size when done: "40 câu". */
  detail?: string;
  /** Status `error`: "Sai định dạng." plus what to do. */
  error?: UploadFileError;
};

export type FileUploadProps = {
  /** Name of the picker button's purpose, e.g. "Danh sách học viên". */
  label: string;
  /** The input's `accept`: ".xlsx,.csv". */
  accept: string;
  /** The same in words: "File .xlsx hoặc .csv". */
  acceptLabel: string;
  maxSizeMb: number;
  multiple?: boolean;
  files: readonly UploadFile[];
  /** Picked or dropped files; the parent checks them (`checkUploadFile`) and uploads. */
  onAdd: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  className?: string;
};

const MB = 1024 * 1024;

/** "240 KB", "1,9 MB": Vietnamese decimal comma, one digit for MB. */
export function formatFileSize(bytes: number) {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1).replace('.', ',').replace(/,0$/, '')} MB`;
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * The two checks the sheet words before any upload starts: the type against
 * `accept` (extensions or MIME patterns like `audio/*`) and the size. `null`
 * when the file may go.
 */
export function checkUploadFile(file: { name: string; size: number; type?: string }, accept: string, acceptLabel: string, maxSizeMb: number): UploadFileError | null {
  const rules = accept.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  const ext = extensionOf(file.name);
  const type = (file.type ?? '').toLowerCase();
  const typeOk = rules.length === 0 || rules.some((rule) => (
    rule.startsWith('.') ? rule === ext : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : rule === type
  ));
  if (!typeOk) return { title: 'Sai định dạng.', body: `Ô này chỉ nhận ${acceptLabel.replace(/^File /, '')}.` };
  if (file.size > maxSizeMb * MB) {
    return { title: 'Quá cỡ.', body: `File ${formatFileSize(file.size)}, tối đa ${maxSizeMb} MB. Tách thành nhiều file nhỏ hơn.` };
  }
  return null;
}

function FileIcon({ status }: { status: UploadFileStatus }) {
  return (
    <svg width="28" height="32" viewBox="0 0 28 32" aria-hidden="true" className={cx(styles.icon, status === 'done' && styles.iconDone, status === 'error' && styles.iconError)}>
      <path d="M4 1.5h13L24.5 9v21.5h-20.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 1.5V9h7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === 'done' ? <path d="M9 19.5l3.5 3.5 7-7.5" fill="none" stroke="currentColor" strokeWidth="2" /> : null}
      {status === 'error' ? <path d="M14.5 14v6M14.5 23v1.5" fill="none" stroke="currentColor" strokeWidth="2" /> : null}
    </svg>
  );
}

/**
 * File upload of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanDuLieu §7):
 * says the formats and the size limit before anything is picked; a drop zone
 * on wide screens (the phone keeps only the 48px "Chọn file" button); each
 * file gets its own row with its status in words, a progress bar while it
 * uploads, and one next step (Huỷ, Tải lên lại, Gỡ file, Chọn file khác).
 * Errors are announced. The parent owns `files` and does the uploading.
 */
export function FileUpload({
  label, accept, acceptLabel, maxSizeMb, multiple = false, files, onAdd, onRemove, onCancel, onRetry, className,
}: FileUploadProps) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(0);
  const depth = useRef(0);
  const hint = `${acceptLabel} · tối đa ${maxSizeMb} MB mỗi file`;

  const pick = () => input.current?.click();

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    depth.current += 1;
    setDragging(event.dataTransfer?.items?.length || 1);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(0);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(0);
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (dropped.length) onAdd(multiple ? dropped : dropped.slice(0, 1));
  };

  const counts = {
    done: files.filter((f) => f.status === 'done').length,
    uploading: files.filter((f) => f.status === 'uploading').length,
    error: files.filter((f) => f.status === 'error').length,
  };
  const summary = [
    `${files.length} file`,
    counts.done ? `${counts.done} xong` : '',
    counts.uploading ? `${counts.uploading} đang tải` : '',
    counts.error ? `${counts.error} lỗi` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className={cx(styles.upload, className)}>
      <div
        className={cx(styles.zone, dragging > 0 && styles.zoneActive)}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className={styles.zoneIcon}>
          <path d="M16 21V5M9.5 11.5L16 5l6.5 6.5M5 21v6h22v-6" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        {dragging > 0 ? (
          <p className={styles.zoneStrong}>{`Thả để tải lên ${multiple ? dragging : 1} file`}</p>
        ) : (
          <>
            <p className={styles.zoneText}>Kéo file vào đây, hoặc</p>
            <label htmlFor={inputId} className={styles.pick}>Chọn file từ máy</label>
          </>
        )}
        <input
          ref={input}
          id={inputId}
          type="file"
          className={styles.visuallyHidden}
          accept={accept}
          multiple={multiple}
          aria-label={`${label}: chọn file từ máy`}
          aria-describedby={hintId}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            if (picked.length) onAdd(picked);
            event.target.value = '';
          }}
        />
        <p id={hintId} className={styles.hint}>{hint}</p>
      </div>

      {files.length > 0 ? (
        <>
          <ul className={styles.list} aria-label={`File đã chọn cho ${label.toLowerCase()}`}>
            {files.map((file) => (
              <li key={file.id} className={styles.item}>
                <FileIcon status={file.status} />
                <div className={styles.body}>
                  {file.status === 'uploading' ? (
                    <>
                      <p className={styles.line}>
                        <span className={styles.name}>{file.name}</span>
                        <span className={styles.meta}>
                          Đang tải lên{file.size ? ` · ${formatFileSize(file.loaded ?? 0)} trên ${formatFileSize(file.size)}` : '…'}
                        </span>
                      </p>
                      <div
                        role="progressbar"
                        aria-label={`Tải lên ${file.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={file.size ? Math.round(((file.loaded ?? 0) / file.size) * 100) : undefined}
                        aria-valuetext={file.size ? `${formatFileSize(file.loaded ?? 0)} trên ${formatFileSize(file.size)}` : 'Đang tải lên'}
                        className={styles.track}
                      >
                        <span className={styles.fill} style={{ width: `${file.size ? Math.min(100, ((file.loaded ?? 0) / file.size) * 100) : 0}%` }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={cx(styles.line, styles.name)}>{file.name}</p>
                      {file.status === 'done' ? (
                        <p className={styles.status}>
                          <strong className={styles.ok}>Đã tải lên</strong>
                          {file.size || file.detail ? <span className={styles.meta}> · {[file.size ? formatFileSize(file.size) : '', file.detail ?? ''].filter(Boolean).join(' · ')}</span> : null}
                        </p>
                      ) : null}
                      {file.status === 'cancelled' ? <p className={cx(styles.status, styles.meta)}>Đã huỷ tải lên. Chưa có gì được lưu.</p> : null}
                      {file.status === 'error' ? (
                        <p role="alert" className={styles.status}>
                          <strong className={styles.danger}>{file.error?.title ?? 'Chưa tải lên được.'}</strong> {file.error?.body ?? 'Kiểm tra kết nối mạng rồi thử lại.'}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                {file.status === 'uploading' && onCancel ? (
                  <button type="button" className={styles.button} aria-label={`Huỷ tải lên ${file.name}`} onClick={() => onCancel(file.id)}>Huỷ</button>
                ) : null}
                {file.status === 'cancelled' && onRetry ? (
                  <button type="button" className={styles.button} onClick={() => onRetry(file.id)}>Tải lên lại</button>
                ) : null}
                {file.status === 'done' && onRemove ? (
                  <button type="button" className={styles.textButton} aria-label={`Gỡ file ${file.name}`} onClick={() => onRemove(file.id)}>Gỡ file</button>
                ) : null}
                {file.status === 'error' ? (
                  <button type="button" className={styles.button} onClick={() => { onRemove?.(file.id); pick(); }}>Chọn file khác</button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.summary}>{summary}</p>
        </>
      ) : null}
    </div>
  );
}
