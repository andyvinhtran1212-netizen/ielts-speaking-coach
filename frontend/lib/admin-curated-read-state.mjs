/** Preserve the server's explicit capability result instead of guessing from 503. */
export function curatedReadFailure(caught) {
  const detail = caught && typeof caught === 'object' ? caught.detail : null;
  const unavailable = detail && typeof detail === 'object' && detail.error_code === 'feature_unavailable';
  const message = typeof detail?.message === 'string' && detail.message.trim()
    ? detail.message : caught instanceof Error ? caught.message : 'Không đọc được dữ liệu. Vui lòng thử lại.';
  return { phase: unavailable ? 'unavailable' : 'error', message };
}
