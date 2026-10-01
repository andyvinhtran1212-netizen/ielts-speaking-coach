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

/** @param {Array<{field_id:string,prompt:string}> | undefined} fields */
export function isCanonicalSourceFields(fields) {
  return !!fields?.length && fields.every((field) => field && typeof field.field_id === 'string' && !!field.field_id.trim() && typeof field.prompt === 'string' && !!field.prompt.trim())
    && new Set(fields.map((field) => field.field_id)).size === fields.length;
}

/** @param {Record<string,string>} values @param {Array<{field_id:string,prompt:string}> | undefined} fields */
function displayGapValues(values, fields) {
  if (!fields || !isCanonicalSourceFields(fields)) return '—';
  return fields.map((field) => `${field.prompt}: ${Object.prototype.hasOwnProperty.call(values, field.field_id) ? values[field.field_id] || '—' : '—'}`).join(' · ');
}

/** @param {string | undefined | null} value @param {string} responseType @param {Array<{field_id:string,prompt:string}>} fields */
export function displaySourceAnswer(value, responseType, fields = []) {
  if (responseType !== 'multi_gap_completion') return value || '—';
  return displayGapValues(readSourceGapAnswers(value), fields);
}

/** @param {string | string[] | Record<string,string> | null | undefined} value @param {Array<{field_id:string,prompt:string}> | undefined} fields */
export function displaySourceReferenceAnswer(value, fields) {
  if (Array.isArray(value)) return value.join(' · ');
  if (value && typeof value === 'object') {
    const values = Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'));
    return fields === undefined ? Object.entries(values).map(([label, answer]) => `${label}: ${answer}`).join(' · ') : displayGapValues(values, fields);
  }
  return value || '';
}
