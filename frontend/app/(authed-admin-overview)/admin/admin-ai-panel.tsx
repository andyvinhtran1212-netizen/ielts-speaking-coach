'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import {
  getAdminAiFailures,
  getAdminAiModels,
  getAdminAiUsage,
  patchAdminAiModel,
  type AdminAiFailuresWire,
  type AdminAiModelsWire,
  type AdminAiUsageWire,
  type AiWindowKey,
} from '@/lib/admin-ai-api';

// AIOPS-0024 — models in use + per-feature control, token usage and the
// routing-layer failure log. Every value is canonical backend state: a save
// shows a pending row until the PATCH returns the refetched configuration.

type FeatureConfig = AdminAiModelsWire['features'][number];
type Draft = { provider: string; model: string };

const WINDOWS: readonly AiWindowKey[] = ['today', '7d', '30d'];
const WINDOW_LABELS: Record<AiWindowKey, string> = { today: 'Hôm nay', '7d': '7 ngày', '30d': '30 ngày' };
const SOURCE_LABELS: Record<string, string> = {
  db_override: 'DB override',
  env: 'env',
  code_default: 'mặc định code',
};
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  azure: 'Azure',
  unknown: 'Không rõ',
};
const STORE_MESSAGES: Record<string, string> = {
  stale: 'Bộ đệm cấu hình DB đã quá hạn — đang dùng env/mặc định code.',
  unavailable: 'Không đọc được cấu hình DB — đang dùng env/mặc định code.',
  not_migrated: 'Chưa áp dụng migration 321 — đang dùng env/mặc định code.',
  not_loaded: 'Chưa tải cấu hình DB — đang dùng env/mặc định code.',
};
const OUTCOME_LABELS: Record<string, string> = { retry: 'thử lại', fallback: 'chuyển dự phòng', final: 'thất bại cuối' };

const numberFormat = new Intl.NumberFormat('vi-VN');
const saigonTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '—';
}

function formatUsd(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(value !== 0 && value < 1 ? 4 : 2)}`;
}

export function formatSaigon(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : saigonTime.format(date);
}

function providerLabel(provider: string | null | undefined) {
  return PROVIDER_LABELS[provider || 'unknown'] || provider || '—';
}

function errorMessage(caught: unknown) {
  const error = caught as { status?: number; detail?: unknown; message?: string } | null;
  if (error?.status === 401 || error?.status === 403) return 'Không có quyền xem mục AI.';
  const detail = error?.detail as { message?: unknown } | string | null | undefined;
  if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message;
  if (typeof detail === 'string' && detail) return detail;
  return error?.message || 'Lỗi không xác định';
}

// Runtime guards: a malformed or empty body must become a visible error state,
// never a render-time crash of the dashboard.
const INVALID_PAYLOAD = 'Phản hồi không hợp lệ từ máy chủ.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelsPayload(value: unknown): value is AdminAiModelsWire {
  return isRecord(value)
    && Array.isArray(value.features)
    && value.features.every((feature) => isRecord(feature)
      && typeof feature.feature === 'string'
      && Array.isArray(feature.effective_order)
      && Array.isArray(feature.allowed_providers)
      && isRecord(feature.preferred_provider)
      && isRecord(feature.anthropic_model))
    && Array.isArray(value.anthropic_models)
    && isRecord(value.store)
    && Array.isArray(value.recent_changes);
}

function isUsagePayload(value: unknown): value is AdminAiUsageWire {
  return isRecord(value) && isRecord(value.window) && isRecord(value.totals)
    && Array.isArray(value.by_feature) && Array.isArray(value.by_provider) && isRecord(value.meta);
}

function isFailuresPayload(value: unknown): value is AdminAiFailuresWire {
  return isRecord(value) && isRecord(value.window) && typeof value.store_status === 'string'
    && isRecord(value.totals) && Array.isArray(value.by_provider_feature) && Array.isArray(value.recent);
}

function SourceBadge({ source }: { source: string }) {
  return <span className={`ai-badge is-${source}`}>{SOURCE_LABELS[source] || source}</span>;
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ai-error" role="alert">
      <span>{message}</span>
      <button type="button" className="btn-secondary" onClick={onRetry}>Thử lại</button>
    </div>
  );
}

function draftFor(feature: FeatureConfig): Draft {
  return {
    provider: feature.override?.preferred_provider ?? '',
    model: feature.override?.anthropic_model ?? '',
  };
}

function FeatureRow({
  feature,
  models,
  draft,
  saving,
  busy,
  rowError,
  onDraft,
  onSave,
}: {
  feature: FeatureConfig;
  models: string[];
  draft: Draft;
  saving: boolean;
  // Any save in flight: saves are serialized so an older full response can
  // never overwrite a newer one.
  busy: boolean;
  rowError: string | null;
  onDraft: (draft: Draft) => void;
  onSave: () => void;
}) {
  const saved = draftFor(feature);
  const changed = draft.provider !== saved.provider || draft.model !== saved.model;
  const controllable = feature.allowed_providers.length > 0;
  const providerId = `ai-pref-${feature.feature}`;
  const modelId = `ai-model-${feature.feature}`;
  return (
    <tr aria-busy={saving || undefined}>
      <th scope="row">
        <span className="ai-feature-label">{feature.label}</span>
        <code className="ai-code">{feature.feature}</code>
      </th>
      <td>
        <ol className="ai-chain">
          {feature.effective_order.map((step) => (
            <li key={`${step.slot}-${step.model}`} className={step.available ? undefined : 'is-unavailable'}>
              <strong>{providerLabel(step.provider)}</strong>
              {' · '}
              <code className="ai-code">{step.model || 'chưa cấu hình'}</code>
              {' '}<SourceBadge source={step.model_source} />
              {step.slot !== step.provider && <span className="ai-muted"> ({step.slot})</span>}
              {!step.available && <span className="ai-muted"> — thiếu khoá API/model, sẽ bị bỏ qua</span>}
              {step.note && <span className="ai-muted"> — {step.note}</span>}
            </li>
          ))}
        </ol>
        <p className="ai-muted">
          Ưu tiên: {providerLabel(feature.preferred_provider.value)} <SourceBadge source={feature.preferred_provider.source} />
          {' · '}Model Claude: <code className="ai-code">{feature.anthropic_model.value}</code>{' '}
          <SourceBadge source={feature.anthropic_model.source} />
        </p>
        {feature.routing_note && <p className="ai-warning">{feature.routing_note}</p>}
        {!!feature.override?.invalid_fields?.length && (
          <p className="ai-warning">
            Giá trị DB không hợp lệ đã bị bỏ qua: {(feature.override.invalid_fields ?? []).join(', ')}
          </p>
        )}
      </td>
      <td>
        <label className="ai-visually-hidden" htmlFor={providerId}>Nhà cung cấp ưu tiên cho {feature.label}</label>
        <select
          id={providerId}
          value={draft.provider}
          disabled={busy || !controllable}
          onChange={(event) => onDraft({ ...draft, provider: event.target.value })}
        >
          <option value="">Mặc định (env/code)</option>
          {feature.allowed_providers.map((provider) => (
            <option key={provider} value={provider}>{providerLabel(provider)}</option>
          ))}
        </select>
      </td>
      <td>
        <label className="ai-visually-hidden" htmlFor={modelId}>Model Claude cho {feature.label}</label>
        <select
          id={modelId}
          value={draft.model}
          disabled={busy || !controllable}
          onChange={(event) => onDraft({ ...draft, model: event.target.value })}
        >
          <option value="">Mặc định (env/code)</option>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </td>
      <td>
        <button
          type="button"
          className="btn-primary"
          disabled={!changed || busy}
          onClick={onSave}
          aria-label={`Lưu lựa chọn cho ${feature.label}`}
        >
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
        {rowError && <p className="ai-row-error" role="alert">{rowError}</p>}
      </td>
    </tr>
  );
}

function ModelsPanel({ onLabels }: { onLabels: (labels: Record<string, string>) => void }) {
  const [data, setData] = useState<AdminAiModelsWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const apply = useCallback((next: unknown) => {
    if (!isModelsPayload(next)) throw new Error(INVALID_PAYLOAD);
    setData(next);
    setDrafts(Object.fromEntries(next.features.map((feature) => [feature.feature, draftFor(feature)])));
    onLabels(Object.fromEntries(next.features.map((feature) => [feature.feature, feature.label])));
  }, [onLabels]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await getAdminAiModels());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const save = async (feature: FeatureConfig) => {
    if (saving !== null) return;
    const draft = drafts[feature.feature] || draftFor(feature);
    setSaving(feature.feature);
    setRowErrors((current) => ({ ...current, [feature.feature]: '' }));
    try {
      apply(await patchAdminAiModel(feature.feature, {
        preferred_provider: draft.provider || null,
        anthropic_model: draft.model || null,
      }));
    } catch (caught) {
      setRowErrors((current) => ({ ...current, [feature.feature]: errorMessage(caught) }));
    } finally {
      setSaving(null);
    }
  };

  const store = data?.store;
  return (
    <section className="ai-panel" aria-labelledby="ai-models-title" aria-busy={loading || undefined}>
      <header className="ai-panel__head">
        <h3 id="ai-models-title">Model đang dùng theo tính năng</h3>
        {store && (
          <span className={`ai-store is-${store.status}`} role="status">
            {store.status === 'ok'
              ? `Cấu hình DB đồng bộ · làm mới mỗi ${store.ttl_seconds}s · ${formatSaigon(store.last_refreshed_at)}`
              : STORE_MESSAGES[store.status] || store.status}
          </span>
        )}
      </header>
      {data && !data.anthropic_key_configured && (
        <p className="ai-warning">Thiếu ANTHROPIC_API_KEY — Claude bị bỏ khỏi mọi chuỗi gọi.</p>
      )}
      {error && <PanelError message={error} onRetry={load} />}
      {loading && !data && <div className="ai-loading" role="status">Đang tải cấu hình model…</div>}
      {data && (
        <div className="ai-table-wrap">
          <table className="ai-table">
            <caption className="ai-visually-hidden">Thứ tự nhà cung cấp và model theo tính năng</caption>
            <thead>
              <tr>
                <th scope="col">Tính năng</th>
                <th scope="col">Thứ tự gọi hiện hành (dự phòng theo sau)</th>
                <th scope="col">Ưu tiên</th>
                <th scope="col">Model Claude</th>
                <th scope="col"><span className="ai-visually-hidden">Lưu</span></th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature) => (
                <FeatureRow
                  key={feature.feature}
                  feature={feature}
                  models={data.anthropic_models}
                  draft={drafts[feature.feature] || draftFor(feature)}
                  saving={saving === feature.feature}
                  busy={saving !== null}
                  rowError={rowErrors[feature.feature] || null}
                  onDraft={(draft) => setDrafts((current) => ({ ...current, [feature.feature]: draft }))}
                  onSave={() => void save(feature)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="ai-changes">
          <h4>Thay đổi gần đây</h4>
          {data.recent_changes_error ? (
            <p className="ai-muted">
              {data.recent_changes_error === 'not_migrated'
                ? 'Chưa áp dụng migration 321 — chưa có lịch sử thay đổi.'
                : 'Không tải được lịch sử thay đổi.'}
            </p>
          ) : data.recent_changes.length === 0 ? (
            <p className="ai-muted">Chưa có thay đổi.</p>
          ) : (
            <ul>
              {data.recent_changes.map((change) => (
                <li key={change.id}>
                  <time dateTime={change.changed_at}>{formatSaigon(change.changed_at)}</time>{' · '}
                  <code className="ai-code">{change.feature}</code>{' · '}
                  ưu tiên {change.old_preferred_provider || 'mặc định'} → {change.new_preferred_provider || 'mặc định'},
                  {' '}model {change.old_anthropic_model || 'mặc định'} → {change.new_anthropic_model || 'mặc định'}
                  {' · '}{change.changed_by_email || change.changed_by || 'không rõ người sửa'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function useWindowed<T>(
  loader: (range: AiWindowKey) => Promise<unknown>,
  isValid: (value: unknown) => value is T,
  range: AiWindowKey,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loader(range);
      if (!isValid(next)) throw new Error(INVALID_PAYLOAD);
      if (request === sequence.current) setData(next);
    } catch (caught) {
      if (request === sequence.current) {
        setData(null);
        setError(errorMessage(caught));
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [loader, isValid, range]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, load };
}

type UsageRow = AdminAiUsageWire['totals'];

function UsageTable({ caption, rows, nameOf }: {
  caption: string;
  rows: Array<UsageRow & { key: string }>;
  nameOf: (key: string) => string;
}) {
  return (
    <div className="ai-table-wrap">
      <table className="ai-table is-numeric">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Nhóm</th>
            <th scope="col">Lượt gọi</th>
            <th scope="col">Lỗi</th>
            <th scope="col">Input</th>
            <th scope="col">Output</th>
            <th scope="col">Thinking</th>
            <th scope="col">Cache đọc</th>
            <th scope="col">Cache ghi</th>
            <th scope="col">Chi phí ước tính</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{nameOf(row.key)}</th>
              <td>{formatCount(row.calls)}</td>
              <td>{formatCount(row.failed_calls)}</td>
              <td>{formatCount(row.input_tokens)}</td>
              <td>{formatCount(row.output_tokens)}</td>
              <td>{formatCount(row.thinking_tokens)}</td>
              <td>{formatCount(row.cache_read_tokens)}</td>
              <td>{formatCount(row.cache_write_tokens)}</td>
              <td>{formatUsd(row.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsagePanel({ range, labels }: { range: AiWindowKey; labels: Record<string, string> }) {
  const { data, error, loading, load } = useWindowed(getAdminAiUsage, isUsagePayload, range);
  const featureName = (key: string) => (key === 'unattributed' ? 'Chưa gắn tính năng' : labels[key] || key);
  const totals = data?.totals;
  return (
    <section className="ai-panel" aria-labelledby="ai-usage-title" aria-busy={loading || undefined}>
      <header className="ai-panel__head">
        <h3 id="ai-usage-title">Token và chi phí — {WINDOW_LABELS[range]}</h3>
      </header>
      {error && <PanelError message={error} onRetry={load} />}
      {loading && !data && !error && <div className="ai-loading" role="status">Đang tải thống kê token…</div>}
      {data && totals && (totals.calls === 0 ? (
        <p className="ai-empty">Chưa có lượt gọi AI trong khoảng này.</p>
      ) : (
        <>
          <dl className="ai-totals">
            <div><dt>Lượt gọi</dt><dd>{formatCount(totals.calls)}</dd></div>
            <div><dt>Lỗi</dt><dd>{formatCount(totals.failed_calls)}</dd></div>
            <div><dt>Input</dt><dd>{formatCount(totals.input_tokens)}</dd></div>
            <div><dt>Output</dt><dd>{formatCount(totals.output_tokens)}</dd></div>
            <div><dt>Thinking</dt><dd>{formatCount(totals.thinking_tokens)}</dd></div>
            <div><dt>Cache đọc</dt><dd>{formatCount(totals.cache_read_tokens)}</dd></div>
            <div><dt>Cache ghi</dt><dd>{formatCount(totals.cache_write_tokens)}</dd></div>
            <div><dt>Chi phí ước tính</dt><dd>{formatUsd(totals.cost_usd)}</dd></div>
          </dl>
          {(totals.unpriced_calls > 0 || totals.legacy_calls > 0) && (
            <p className="ai-muted">
              {totals.unpriced_calls > 0 && `${formatCount(totals.unpriced_calls)} lượt chưa có giá (không tính vào chi phí). `}
              {totals.legacy_calls > 0 && `${formatCount(totals.legacy_calls)} lượt cũ được định giá lại theo bảng giá.`}
            </p>
          )}
          <UsageTable
            caption="Theo tính năng"
            rows={data.by_feature.map((row) => ({ ...row, key: row.feature }))}
            nameOf={featureName}
          />
          <UsageTable
            caption="Theo nhà cung cấp"
            rows={data.by_provider.map((row) => ({ ...row, key: row.provider }))}
            nameOf={providerLabel}
          />
          <p className="ai-muted">
            Từ {formatSaigon(data.window.start)} đến {formatSaigon(data.window.end)} (giờ Sài Gòn). {data.meta.note}
          </p>
        </>
      ))}
    </section>
  );
}

function FailuresPanel({ range, labels }: { range: AiWindowKey; labels: Record<string, string> }) {
  const { data, error, loading, load } = useWindowed(getAdminAiFailures, isFailuresPayload, range);
  const featureName = (key: string) => labels[key] || key;
  return (
    <section className="ai-panel" aria-labelledby="ai-failures-title" aria-busy={loading || undefined}>
      <header className="ai-panel__head">
        <h3 id="ai-failures-title">Lỗi gọi AI và chuyển dự phòng — {WINDOW_LABELS[range]}</h3>
      </header>
      {error && <PanelError message={error} onRetry={load} />}
      {loading && !data && !error && <div className="ai-loading" role="status">Đang tải nhật ký lỗi…</div>}
      {data && data.store_status === 'not_migrated' && (
        <p className="ai-warning">Chưa áp dụng migration 321 — chưa có nhật ký lỗi gọi AI.</p>
      )}
      {data && data.store_status === 'ok' && (data.totals.total === 0 ? (
        <p className="ai-empty">Không có lỗi gọi AI trong khoảng này.</p>
      ) : (
        <>
          <dl className="ai-totals">
            <div><dt>Tổng</dt><dd>{formatCount(data.totals.total)}</dd></div>
            <div><dt>Thử lại</dt><dd>{formatCount(data.totals.retry)}</dd></div>
            <div><dt>Chuyển dự phòng</dt><dd>{formatCount(data.totals.fallback)}</dd></div>
            <div><dt>Thất bại cuối</dt><dd>{formatCount(data.totals.final)}</dd></div>
          </dl>
          <div className="ai-table-wrap">
            <table className="ai-table">
              <caption>Theo nhà cung cấp và tính năng</caption>
              <thead>
                <tr>
                  <th scope="col">Nhà cung cấp</th>
                  <th scope="col">Tính năng</th>
                  <th scope="col">Tổng</th>
                  <th scope="col">Thử lại / Dự phòng / Cuối</th>
                  <th scope="col">Loại lỗi</th>
                </tr>
              </thead>
              <tbody>
                {data.by_provider_feature.map((group) => (
                  <tr key={`${group.provider}-${group.feature}`}>
                    <th scope="row">{providerLabel(group.provider)}</th>
                    <td>{featureName(group.feature)}</td>
                    <td>{formatCount(group.total)}</td>
                    <td>{formatCount(group.retry)} / {formatCount(group.fallback)} / {formatCount(group.final)}</td>
                    <td>
                      {Object.entries(group.by_error_type)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => `${type} × ${formatCount(count)}`)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ai-table-wrap">
            <table className="ai-table">
              <caption>{`${data.recent.length} lỗi gần nhất (giờ Sài Gòn)`}</caption>
              <thead>
                <tr>
                  <th scope="col">Thời điểm</th>
                  <th scope="col">Tính năng</th>
                  <th scope="col">Nhà cung cấp · model</th>
                  <th scope="col">Loại lỗi</th>
                  <th scope="col">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.id}>
                    <td><time dateTime={row.created_at}>{formatSaigon(row.created_at)}</time></td>
                    <td>{featureName(row.feature)}</td>
                    <td>
                      {providerLabel(row.provider)}
                      {row.model && <> · <code className="ai-code">{row.model}</code></>}
                      {row.route_slot && <span className="ai-muted"> ({row.route_slot})</span>}
                    </td>
                    <td>
                      {row.error_type}
                      {row.error_code && row.error_code !== row.error_type && (
                        <span className="ai-muted"> ({row.error_code})</span>
                      )}
                    </td>
                    <td>{OUTCOME_LABELS[row.outcome] || row.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </section>
  );
}

export function AdminAiPanel() {
  const [range, setRange] = useState<AiWindowKey>('today');
  const [labels, setLabels] = useState<Record<string, string>>({});

  const onWindowKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = WINDOWS.indexOf(range);
    const next = event.key === 'Home' ? WINDOWS[0]
      : event.key === 'End' ? WINDOWS[WINDOWS.length - 1]
        : event.key === 'ArrowRight' ? WINDOWS[(index + 1) % WINDOWS.length]
          : WINDOWS[(index - 1 + WINDOWS.length) % WINDOWS.length];
    setRange(next);
    document.getElementById(`ai-window-${next}`)?.focus();
  };

  return (
    <section className="ai-section" aria-labelledby="ai-section-title">
      <h2 className="ov-section-title" id="ai-section-title">AI</h2>
      <ModelsPanel onLabels={setLabels} />
      <div className="ai-window" role="tablist" aria-label="Khoảng thời gian thống kê AI">
        {WINDOWS.map((key) => (
          <button
            key={key}
            id={`ai-window-${key}`}
            type="button"
            role="tab"
            className={`ov-tab${range === key ? ' is-active' : ''}`}
            aria-selected={range === key}
            aria-controls="ai-window-panels"
            tabIndex={range === key ? 0 : -1}
            onClick={() => setRange(key)}
            onKeyDown={onWindowKey}
          >
            {WINDOW_LABELS[key]}
          </button>
        ))}
      </div>
      <div id="ai-window-panels" role="tabpanel" aria-labelledby={`ai-window-${range}`} className="ai-window-panels">
        <UsagePanel range={range} labels={labels} />
        <FailuresPanel range={range} labels={labels} />
      </div>
    </section>
  );
}
