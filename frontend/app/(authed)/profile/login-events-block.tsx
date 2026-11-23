'use client';

// "Lần đăng nhập gần đây" (LEARNERCORE-0063 FR-064): three rows from
// G04-T16's `GET /api/account/login-events?limit=3`. `enabled=false`, no rows,
// an error, or the route not being there yet (404) hides this block and only
// this block: the rest of Hồ sơ still shows. No place column.
import { useEffect, useState } from 'react';

import { loginEventRows, type LoginEventRow } from '@/lib/profile-v2-model.mjs';

import styles from './profile-v2.module.css';

export function LoginEventsBlock() {
  const [rows, setRows] = useState<LoginEventRow[] | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    window.api
      .getWith<unknown>('/api/account/login-events?limit=3', undefined, { signal: abort.signal })
      .then(
        (raw) => { if (!abort.signal.aborted) setRows(loginEventRows(raw)); },
        () => { if (!abort.signal.aborted) setRows(null); },
      );
    return () => abort.abort();
  }, []);

  if (!rows) return null;
  return (
    <div className={styles.events}>
      <h3 className={styles.subTitle}>Lần đăng nhập gần đây</h3>
      <ul className={styles.rows}>
        {rows.map((row, i) => (
          <li key={i} className={styles.eventRow}>
            <p className={styles.eventDevice}>
              {row.device}
              {row.current ? <span className={styles.current}>Thiết bị này</span> : null}
            </p>
            <p className={styles.meta}>
              {row.at ? <span>{row.at}</span> : null}
              {row.method ? <span>{row.method}</span> : null}
              {row.outcome ? <span>{row.outcome}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
