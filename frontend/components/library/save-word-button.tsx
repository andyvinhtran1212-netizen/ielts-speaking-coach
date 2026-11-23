'use client';

/**
 * "Lưu vào sổ từ" on a Vocabulary entry (LIBRARY-0061 T015, FR-053, open
 * question 5 default; tờ TuVung màn 2 và 3a).
 *
 * Who sees what is decided by `GET /api/vocabulary/bank/stats` for the viewer:
 * - 200: the word bank is on for them → a toggle ("Lưu vào sổ từ" ⇄ "Đã lưu
 *   vào sổ từ", "Đang lưu…" while the request runs). Saved state is read from
 *   the bank itself, never kept only in the page.
 * - 401: a guest → the button opens a prompt right under it (no pop-up) that
 *   leads to sign-in with `next` = this entry; the intent to save is kept in
 *   sessionStorage for 30 minutes and carried out when they come back, after
 *   checking it is for this same entry. Opening any entry clears it, so it
 *   runs at most once and never after the reader later removes the word.
 * - 409 on save with no visible row: the word is in the bank but hidden there
 *   (archived, pending, skipped or "cần xem lại"); the button says so and
 *   links to the notebook instead of silently showing "Lưu vào sổ từ".
 * - anything else (bank off, account not activated, lookup failed): no button.
 */
import { useCallback, useEffect, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import styles from './save-word-button.module.css';

export const PENDING_SAVE_KEY = 'aver-pending-save-word';
/** How long a guest's "save after sign-in" intent stays valid. */
export const PENDING_SAVE_TTL_MS = 30 * 60 * 1000;
export const NOTEBOOK_PATH = '/vocabulary/hub';

/** Raised when the bank already holds the word in a state GET /bank/ hides. */
class HiddenInBank extends Error {}

export type SaveWordTarget = {
  category: string;
  slug: string;
  headword: string;
  definitionVi: string;
  example: string;
};

type BankRow = { id?: string; headword?: string };
type Status =
  | { kind: 'checking' }
  | { kind: 'hidden' }
  | { kind: 'guest'; prompt: boolean }
  | { kind: 'ready'; savedId: string | null; busy: boolean; error: boolean; hidden?: boolean };

const NO_REDIRECT = { noRedirect: true };

function statusOf(caught: unknown): number | null {
  const value = (caught as { status?: unknown } | null)?.status;
  return typeof value === 'number' ? value : null;
}

/** Path of this entry, the one sign-in returns to. Exported for tests. */
export function entryPath(target: Pick<SaveWordTarget, 'category' | 'slug'>): string {
  return `/vocabulary?cat=${encodeURIComponent(target.category)}&slug=${encodeURIComponent(target.slug)}`;
}

/** Writes the intent to save this entry after sign-in. Exported for tests. */
export function storePendingSave(target: Pick<SaveWordTarget, 'category' | 'slug'>, now = Date.now()): void {
  try {
    window.sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ category: target.category, slug: target.slug, at: now }));
  } catch { /* no storage: sign-in still returns here, the reader saves by hand */ }
}

/**
 * Reads and ALWAYS clears the pending save; true only when it belongs to this
 * entry and is younger than PENDING_SAVE_TTL_MS. Exported for tests.
 */
export function takePendingSave(target: Pick<SaveWordTarget, 'category' | 'slug'>, now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(PENDING_SAVE_KEY);
    if (!raw) return false;
    window.sessionStorage.removeItem(PENDING_SAVE_KEY);
    const pending = JSON.parse(raw) as { category?: unknown; slug?: unknown; at?: unknown };
    if (pending?.category !== target.category || pending?.slug !== target.slug) return false;
    return typeof pending.at === 'number' && now - pending.at >= 0 && now - pending.at <= PENDING_SAVE_TTL_MS;
  } catch {
    return false;
  }
}

function findSaved(rows: unknown, headword: string): string | null {
  if (!Array.isArray(rows)) return null;
  const needle = headword.trim().toLowerCase();
  const row = (rows as BankRow[]).find((item) => typeof item?.headword === 'string' && item.headword.trim().toLowerCase() === needle);
  return row && typeof row.id === 'string' ? row.id : null;
}

export function SaveWordButton({ target }: { target: SaveWordTarget }) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  const readSaved = useCallback(async () => {
    const rows = await window.api.getWith('/api/vocabulary/bank/', undefined, NO_REDIRECT);
    return findSaved(rows, target.headword);
  }, [target.headword]);

  const save = useCallback(async () => {
    try {
      const row = await window.api.post('/api/vocabulary/bank/', {
        headword: target.headword,
        definition_vi: target.definitionVi || null,
        context_sentence: target.example || null,
        category: 'topic',
      }) as BankRow | null;
      return typeof row?.id === 'string' ? row.id : await readSaved();
    } catch (caught) {
      // Already in the bank (unique headword): show the canonical row. When
      // the list does not show it, the row is hidden there (archived,
      // pending, skipped, needs review): say so rather than look unsaved.
      if (statusOf(caught) === 409) {
        const id = await readSaved();
        if (id) return id;
        throw new HiddenInBank();
      }
      throw caught;
    }
  }, [readSaved, target.definitionVi, target.example, target.headword]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocabulary save)');
      if (cancelled) return;
      if (!ready) { setStatus({ kind: 'hidden' }); return; }
      try {
        await window.api.getWith('/api/vocabulary/bank/stats', undefined, NO_REDIRECT);
      } catch (caught) {
        if (!cancelled) setStatus(statusOf(caught) === 401 ? { kind: 'guest', prompt: false } : { kind: 'hidden' });
        return;
      }
      // Taken (and cleared) before anything else, so the intent never
      // outlives this visit, whatever the bank says.
      const pending = takePendingSave(target);
      try {
        let savedId = await readSaved();
        if (!savedId && pending) {
          if (!cancelled) setStatus({ kind: 'ready', savedId: null, busy: true, error: false });
          savedId = await save();
        }
        if (!cancelled) setStatus({ kind: 'ready', savedId, busy: false, error: false });
      } catch (caught) {
        if (!cancelled) setStatus({ kind: 'ready', savedId: null, busy: false, error: !(caught instanceof HiddenInBank), hidden: caught instanceof HiddenInBank });
      }
    })();
    return () => { cancelled = true; };
  }, [readSaved, save, target]);

  async function toggle(current: Extract<Status, { kind: 'ready' }>) {
    setStatus({ ...current, busy: true, error: false });
    try {
      if (current.savedId) {
        await window.api.delete(`/api/vocabulary/bank/${encodeURIComponent(current.savedId)}`);
        setStatus({ kind: 'ready', savedId: await readSaved(), busy: false, error: false });
      } else {
        setStatus({ kind: 'ready', savedId: await save(), busy: false, error: false });
      }
    } catch (caught) {
      if (caught instanceof HiddenInBank) setStatus({ ...current, busy: false, error: false, hidden: true });
      else setStatus({ ...current, busy: false, error: true });
    }
  }

  if (status.kind === 'checking' || status.kind === 'hidden') return null;

  if (status.kind === 'guest') {
    const next = entryPath(target);
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.button} aria-expanded={status.prompt} aria-controls="save-word-prompt"
          onClick={() => setStatus({ kind: 'guest', prompt: !status.prompt })}>
          Lưu vào sổ từ
        </button>
        {status.prompt ? (
          <div id="save-word-prompt" className={styles.prompt}>
            <p>Cần đăng nhập để lưu. Đọc và nghe mục từ không cần tài khoản.</p>
            <p>Đăng nhập xong, bạn quay lại đúng mục từ này và “{target.headword}” đã nằm trong sổ từ.</p>
            <p className={styles.actions}>
              <a href={`/login?next=${encodeURIComponent(next)}`} onClick={() => storePendingSave(target)}>Đăng nhập để lưu</a>
              <button type="button" className={styles.later} onClick={() => setStatus({ kind: 'guest', prompt: false })}>Để sau</button>
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  const saved = Boolean(status.savedId);
  return (
    <div className={styles.wrap}>
      <button type="button" className={saved ? `${styles.button} ${styles.saved}` : styles.button}
        aria-pressed={saved} disabled={status.busy} onClick={() => void toggle(status)}>
        {status.busy ? 'Đang lưu…' : saved ? 'Đã lưu vào sổ từ' : 'Lưu vào sổ từ'}
      </button>
      {status.error ? <p className={styles.error} role="alert">Không lưu được. Thử lại sau.</p> : null}
      {status.hidden ? (
        <p className={styles.error} role="status">
          “{target.headword}” đã có trong sổ từ của bạn nhưng đang ẩn (đã lưu trữ, đang chờ xác nhận hoặc cần xem lại).{' '}
          <a href={NOTEBOOK_PATH}>Mở sổ từ</a>
        </p>
      ) : null}
    </div>
  );
}
