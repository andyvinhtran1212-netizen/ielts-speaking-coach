/** @param {string | undefined | null} value @returns {Record<string,string>} */
export function readSourceGapAnswers(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry) => typeof entry[1] === 'string'));
  } catch { return {}; }
}

/** @param {Record<string,string>} values */
export function writeSourceGapAnswers(values) {
  return Object.values(values).some((value) => value.trim()) ? JSON.stringify(values) : '';
}

/** @param {string | undefined | null} value @param {string} responseType @param {Array<{field_id:string,prompt:string}>} fields */
export function displaySourceAnswer(value, responseType, fields = []) {
  if (responseType !== 'multi_gap_completion') return value || '—';
  const parsed = readSourceGapAnswers(value);
  const rows = fields.length ? fields.map((field) => [field.prompt, parsed[field.field_id]]) : Object.entries(parsed).map(([, answer], index) => [`Chỗ trống ${index + 1}`, answer]);
  return rows.map(([label, answer]) => `${label}: ${answer || '—'}`).join(' · ') || '—';
}
