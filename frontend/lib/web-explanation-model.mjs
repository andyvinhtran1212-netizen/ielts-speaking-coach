function plain(value) {
  return String(value ?? '').trim();
}

function first(normalize, ...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return '';
}

/**
 * Normalize authored answer options into [submitted value, display text].
 * Object-array packages use either {value, label}, {label, text}, or
 * {letter, text}; the identifier must never fall back to the array index when
 * one of those canonical identifiers is present.
 */
export function answerOptions(object, normalize = plain) {
  const options = object?.item?.options;
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return Object.entries(options).map(([key, value]) => [normalize(key), normalize(value)]);
  }
  if (!Array.isArray(options)) return [];

  return options.map((value, index) => {
    if (!value || typeof value !== 'object') {
      const normalized = normalize(value);
      return [normalized, normalized];
    }

    const identifier = first(
      normalize,
      value.value,
      value.label,
      value.letter,
      value.id,
      value.key,
      index + 1,
    );
    const display = first(
      normalize,
      value.text,
      value.value != null ? value.label : null,
      value.label,
      value.value,
      value.letter,
      identifier,
    );
    return [identifier, display];
  });
}
