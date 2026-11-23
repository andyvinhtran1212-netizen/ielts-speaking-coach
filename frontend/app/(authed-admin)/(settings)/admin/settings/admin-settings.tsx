'use client';

// Trang Cài đặt (ADMINIA-0074 FR-080, FR-081, FR-084; sheet AdminCaiDat §7–9;
// G09-T23). Seven tabs on ?tab=; the operations-threshold table is the one
// open today, the others say in one line what they wait on. Every save goes
// through PATCH /admin/settings/thresholds (admin, AAL2), which writes the
// value and its settings-log row together; the page then shows the values the
// server answered and reads the log again. It never shows a value as saved
// that the server did not confirm.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Dialog, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { useThresholds } from '@/components/admin/thresholds-provider';
import {
  getSettingsLog,
  getThresholds,
  saveThresholds,
  type SettingsLogItemWire,
  type ThresholdItemWire,
} from '@/lib/admin-settings-api';
import {
  SETTINGS_TABS,
  changeLine,
  draftsOf,
  logRow,
  parseSettingsTab,
  patchBody,
  rangeText,
  retentionWarning,
  settingsTabHref,
  thresholdChanges,
  thresholdGroups,
  thresholdSaveError,
  valueText,
} from '@/lib/admin-settings-model.mjs';

type Banner = { kind: 'success' | 'error'; text: string } | null;

export function AdminSettings() {
  const search = useSearchParams();
  const tab = parseSettingsTab(search?.toString() ?? '');
  const current = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[SETTINGS_TABS.length - 1];
  const [logToken, setLogToken] = useState(0);
  const logChanged = useCallback(() => setLogToken((n) => n + 1), []);

  return (
    <div className="st-shell">
      <header className="st-header">
        <nav className="st-breadcrumb" aria-label="Vị trí">Hệ thống › Cài đặt</nav>
        <h1>Cài đặt</h1>
        <p className="subtitle">Thay đổi áp ngay trên môi trường này và được ghi vào nhật ký cài đặt.</p>
      </header>

      <nav className="st-tabs" aria-label="Các thẻ cài đặt">
        {SETTINGS_TABS.map((t) => (
          <Link key={t.id} href={settingsTabHref(t.id)} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label}{t.pending ? <span className="st-soon">Chưa mở</span> : null}
          </Link>
        ))}
      </nav>

      {current.pending
        ? <p className="st-note" role="status">{current.pending}</p>
        : <ThresholdsTab onSaved={logChanged} />}

      <SettingsLog token={logToken} />
    </div>
  );
}

function ThresholdsTab({ onSaved }: { onSaved: () => void }) {
  const frame = useThresholds();
  const [items, setItems] = useState<ThresholdItemWire[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<{ key: string; text: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoadError(null);
    try {
      const body = await getThresholds();
      if (mine !== seq.current) return;
      const rows = Array.isArray(body?.items) ? body.items : [];
      setItems(rows);
      setDrafts(draftsOf(rows));
      setServerError(null);
      setShowErrors(false);
    } catch (caught) {
      if (mine !== seq.current) return;
      setLoadError(messageOf(caught));
    }
  }, []);

  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load]);

  const { changes, errors } = useMemo(() => thresholdChanges(items ?? [], drafts), [items, drafts]);
  const errorCount = Object.keys(errors).length;
  const warning = retentionWarning(changes);

  const ask = () => {
    if (errorCount) { setShowErrors(true); return; }
    if (!changes.length) return;
    setReason('');
    setDialogError('');
    setConfirming(true);
  };

  const close = () => { if (!busy) { setConfirming(false); setDialogError(''); } };

  const save = async () => {
    const body = patchBody(changes, reason);
    if (!body.reason) { setDialogError('Ghi lý do thay đổi.'); return; }
    setBusy(true);
    setDialogError('');
    try {
      const out = await saveThresholds(body);
      const rows = Array.isArray(out?.items) ? out.items : [];
      setItems(rows);
      setDrafts(draftsOf(rows));
      setServerError(null);
      setConfirming(false);
      setBanner({ kind: 'success', text: `Đã lưu ${changes.length} ngưỡng vận hành. Đã ghi vào nhật ký cài đặt.` });
      onSaved();
      void frame.reload();
    } catch (caught) {
      const err = thresholdSaveError(caught);
      if (err.refused) {
        // Refused before anything was written: keep the dialog and the typed values.
        setDialogError(err.text);
        if (err.key) setServerError({ key: err.key, text: err.text });
      } else {
        setConfirming(false);
        setBanner({ kind: 'error', text: err.text });
        await load();
        onSaved();
        void frame.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="st-block" aria-labelledby="st-thresholds">
        <h2 id="st-thresholds">Ngưỡng vận hành</h2>
        <p className="st-warning" role="alert">Chưa đọc được bảng ngưỡng: {loadError}</p>
        <button type="button" className="adm-btn-secondary" onClick={() => void load()}>Tải lại</button>
      </section>
    );
  }
  if (!items) return <p className="st-note" role="status">Đang tải cài đặt…</p>;

  return (
    <section className="st-block" aria-labelledby="st-thresholds">
      <h2 id="st-thresholds">Ngưỡng vận hành</h2>
      <p className="st-note">Mọi trang đọc ngưỡng từ bảng này; không trang nào đặt ngưỡng riêng. Mỗi dòng ghi mốc tính.</p>
      <StatusBanner banner={banner} />
      {showErrors && errorCount ? (
        <p className="st-warning" role="alert">Chưa lưu: {errorCount} ô cần sửa. Các ô khác giữ nguyên chữ đã gõ.</p>
      ) : null}

      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr><th scope="col">Nhóm</th><th scope="col">Ngưỡng</th><th scope="col">Giá trị</th></tr>
          </thead>
          <tbody>
            {thresholdGroups(items).map((g) => g.rows.map((row, i) => {
              const fieldError = (showErrors ? errors[row.key] : null) ?? (serverError && serverError.key === row.key ? serverError.text : null);
              const inputId = `st-${row.key}`;
              return (
                <tr key={row.key} data-key={row.key}>
                  {i === 0 ? <th scope="rowgroup" rowSpan={g.rows.length}>{g.group}</th> : null}
                  <td>
                    <label htmlFor={row.fixed ? undefined : inputId}><strong>{row.label}</strong></label>
                    <span className="st-anchor"> · {row.anchor}</span>
                  </td>
                  <td>
                    {row.fixed ? (
                      <span>{valueText(row)} <span className="st-hint">{rangeText(row)}</span></span>
                    ) : (
                      <>
                        <span className="st-field">
                          <input
                            id={inputId}
                            inputMode="numeric"
                            value={drafts[row.key] ?? ''}
                            aria-invalid={fieldError ? true : undefined}
                            aria-describedby={`${inputId}-hint`}
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.value;
                              setDrafts((d) => ({ ...d, [row.key]: next }));
                              if (serverError?.key === row.key) setServerError(null);
                            }}
                          />
                          <span>{row.unit}</span>
                        </span>
                        <span id={`${inputId}-hint`} className={fieldError ? 'st-field-error' : 'st-hint'}>
                          {fieldError ?? rangeText(row)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      <div className="st-actions">
        <button type="button" className="adm-btn-primary" disabled={busy || (!changes.length && !errorCount)} onClick={ask}>Lưu…</button>
        <button type="button" className="adm-btn-secondary" disabled={busy || (!changes.length && !errorCount)}
          onClick={() => { setDrafts(draftsOf(items)); setShowErrors(false); setServerError(null); }}>Huỷ thay đổi</button>
        <span className="st-hint">{changes.length ? `${changes.length} thay đổi chưa lưu` : 'Chưa có thay đổi'}</span>
      </div>

      <Dialog
        open={confirming}
        title={`Lưu ${changes.length} thay đổi?`}
        onClose={close}
        busy={busy}
        actions={(
          <>
            <button type="button" className="adm-btn-secondary" disabled={busy} onClick={close}>Huỷ</button>
            <button type="button" className="adm-btn-primary" disabled={busy} onClick={() => void save()}>Lưu thay đổi</button>
          </>
        )}
      >
        <ul className="st-change-list">
          {changes.map((c) => <li key={c.key}>{changeLine(c)}</li>)}
        </ul>
        <p>Nhãn &quot;Quá hạn xử lý&quot; và số đếm ở Việc cần làm tính lại theo giá trị mới.</p>
        {warning ? <p className="st-warning" role="alert">{warning}</p> : null}
        <label className="st-reason">Lý do (ghi vào nhật ký)
          <textarea value={reason} maxLength={500} rows={2} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        </label>
        {dialogError ? <p className="st-warning" role="alert">{dialogError}</p> : null}
      </Dialog>
    </section>
  );
}

function SettingsLog({ token }: { token: number }) {
  const [items, setItems] = useState<SettingsLogItemWire[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const body = await getSettingsLog();
      if (mine !== seq.current) return;
      setItems(Array.isArray(body?.items) ? body.items : []);
      setNext(body?.next_cursor ?? null);
    } catch (caught) {
      if (mine !== seq.current) return;
      setError(messageOf(caught));
    }
  }, []);

  useEffect(() => { void load(); return () => { seq.current += 1; }; }, [load, token]);

  const loadMore = async () => {
    if (!next) return;
    const mine = seq.current;
    setMore(true);
    try {
      const body = await getSettingsLog(next);
      if (mine !== seq.current) return;
      setItems((prev) => [...(prev ?? []), ...(Array.isArray(body?.items) ? body.items : [])]);
      setNext(body?.next_cursor ?? null);
    } catch (caught) {
      if (mine === seq.current) setError(messageOf(caught));
    } finally {
      setMore(false);
    }
  };

  return (
    <section className="st-block" aria-labelledby="st-log">
      <h2 id="st-log">Nhật ký thay đổi cài đặt</h2>
      {error ? (
        <p className="st-warning" role="alert">Chưa đọc được nhật ký cài đặt: {error}{' '}
          <button type="button" className="adm-btn-secondary" onClick={() => void load()}>Tải lại</button>
        </p>
      ) : null}
      {items === null && !error ? <p className="st-note" role="status">Đang tải nhật ký…</p> : null}
      {items && !items.length ? <p className="st-note">Chưa có thay đổi nào.</p> : null}
      {items && items.length ? (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr><th scope="col">Lúc</th><th scope="col">Ai</th><th scope="col">Thẻ</th><th scope="col">Thay đổi</th><th scope="col">Lý do</th></tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const r = logRow(item);
                return (
                  <tr key={r.id}>
                    <td>{r.at}</td><td>{r.who}</td><td>{r.tab}</td>
                    <td>{r.what.map((line) => <div key={line}>{line}</div>)}</td>
                    <td>{r.why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {next ? <button type="button" className="adm-btn-secondary" disabled={more} onClick={() => void loadMore()}>Xem thêm</button> : null}
      <p className="st-hint">Chỉ ghi thêm, không sửa hay xoá. Giá trị bí mật không hiện ở đây.</p>
    </section>
  );
}
