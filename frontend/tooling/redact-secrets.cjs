// PC-J437 — shared secret redaction for Playwright reports and CI artifacts.
//
// Leak path this closes: when a Playwright APIRequestContext call fails, its
// error message carries a "Call log:" that lists EVERY request header,
// including `Authorization: Bearer <JWT>` and `x-vercel-protection-bypass`.
// That message reaches the github/json/html reporters and the error-context
// markdown, and artifacts are not masked by the Actions log masker.
//
// CommonJS so the CJS staging-e2e fixture and Playwright config can require it;
// the ESM tooling (sanitize/scan) imports the same functions.
'use strict';

const zlib = require('node:zlib');

const REDACTED = '[REDACTED]';

// Environment variables whose literal values must never reach an artifact.
// Configured nonempty secrets shorter than the minimum fail closed rather
// than silently disabling literal protection.
const SECRET_ENV_NAMES = Object.freeze([
  'STAGING_BYPASS',
  'STAGING_PROTECTION_BYPASS',
  'E2E_PASSWORD',
  'STAGING_E2E_ADMIN_TOTP_SECRET',
]);
const MIN_LITERAL_LENGTH = 8;

const JWT_SOURCE = 'eyJ[A-Za-z0-9_-]{5,}\\.eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*';
const TOKEN_FIELDS = 'access_token|refresh_token|provider_token|provider_refresh_token|id_token|password';

// Header form, in plain text (`Authorization: Bearer x`), JSON
// (`"authorization":"Bearer x"`) and escaped JSON (`\"cookie\":\"sb-..\"`).
// The value stops at a quote, backslash, ESC (Playwright colours call-log
// lines) or newline, so the rest of the message stays readable.
const HEADER_RE = /(?<![\w-])(authorization|proxy-authorization|apikey|cookie|set-cookie|x-vercel-protection-bypass|x-api-key)(\\?["']?[ \t]*[:=][ \t]*\\?["']?)([^\r\n"'`\\\x1b<]+)/gi;
const JSON_FIELD_RE = new RegExp(`"(${TOKEN_FIELDS})"(\\s*:\\s*)"(?:[^"\\\\\\r\\n]|\\\\.)*"`, 'g');
// Encode both the delimiter and an inner JSON escape at the same depth.
// A value's escaped quote is E + D, whereas its closing delimiter is just D.
// Consuming E first prevents stopping at the first quote inside a password.
const ESCAPED_JSON_FIELDS = [3, 2, 1].map((level) => {
  let delimiter = '"';
  let escape = '\\';
  for (let n = 0; n < level; n += 1) {
    delimiter = jsonEscape(delimiter);
    escape = jsonEscape(escape);
  }
  const d = regexEscape(delimiter);
  const e = regexEscape(escape);
  const plain = '[^"\\\\\\r\\n]';
  return {
    pattern: new RegExp(`(${d}(?:${TOKEN_FIELDS})${d}\\s*:\\s*${d})(?:${plain}|${e}(?:${e}|${d}|${plain}))*${d}`, 'g'),
    delimiter,
  };
});
const QUERY_RE = /(?<![\w-])(access_token|refresh_token|provider_token|token_hash|apikey|x-vercel-protection-bypass)=([^&\s"'\\#\x1b<]+)/gi;
const COOKIE_RE = /(?<![\w-])(sb-[A-Za-z0-9_-]*auth-token(?:[.-][A-Za-z0-9]+)?|sb-access-token|sb-refresh-token|_vercel_jwt|__prerender_bypass|__vercel_live_token)=([^;\s"'\\\x1b<]+)/g;
const COOKIE_JSON_RE = /("name"\s*:\s*"(?:sb-[^"]*|_vercel_jwt|__prerender_bypass|__vercel_live_token)"\s*,\s*"value"\s*:\s*")(?:[^"\\]|\\.)*"/g;
const BEARER_RE = /\b(Bearer)[ \t]+(?!\[REDACTED)[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = new RegExp(JWT_SOURCE, 'g');

function validateLiteral(value) {
  if (typeof value !== 'string' || value.length < MIN_LITERAL_LENGTH) {
    // Never include the rejected value in the error (including CLI stacks).
    throw new Error(`Configured artifact secrets must contain at least ${MIN_LITERAL_LENGTH} characters`);
  }
  return value;
}

function secretLiteralsFromEnv(env = process.env) {
  const values = new Set();
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (value !== undefined && value !== '') values.add(validateLiteral(value));
  }
  return [...values];
}

function resolveLiterals(options) {
  return options && Array.isArray(options.literals)
    ? options.literals.map(validateLiteral)
    : secretLiteralsFromEnv();
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonEscape(value) {
  return JSON.stringify(value).slice(1, -1);
}

function htmlEscape(value, numeric = false) {
  const entities = numeric
    ? { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#x27;' }
    : { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}

// Only base64 characters depending entirely on secret bytes are stable when
// surrounding text changes. Include each of the three possible byte offsets.
function alignedBase64(literal, offset, alphabet) {
  const bytes = Buffer.from(literal, 'utf8');
  const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString(alphabet);
  return encoded.slice(Math.ceil(8 * offset / 6), Math.floor(8 * (offset + bytes.length) / 6));
}

function literalVariants(literal) {
  const uri = encodeURIComponent(literal);
  const variants = [literal, uri, encodeURIComponent(uri), uri.replace(/%20/g, '+'),
    new URLSearchParams({ v: literal }).toString().slice(2),
    htmlEscape(literal), htmlEscape(literal, true), htmlEscape(jsonEscape(literal))];
  let escaped = literal;
  for (let level = 0; level < 3; level += 1) {
    escaped = jsonEscape(escaped);
    variants.push(escaped);
  }
  for (const alphabet of ['base64', 'base64url']) {
    for (const offset of [0, 1, 2]) variants.push(alignedBase64(literal, offset, alphabet));
  }
  return variants;
}

// Serializers escape different subsets of characters. Each UTF-16 code unit
// may independently be raw, JSON-escaped, a Unicode escape, or an HTML entity.
function literalFlexSource(literal) {
  return literal.split('').map((char) => {
    const hex = char.charCodeAt(0).toString(16).padStart(4, '0');
    const alternatives = new Set([char, `\\u${hex}`, `\\u${hex.toUpperCase()}`,
      htmlEscape(char), htmlEscape(char, true)]);
    if (char === "'") alternatives.add('&apos;');
    let escaped = char;
    for (let level = 0; level < 3; level += 1) {
      escaped = jsonEscape(escaped);
      alternatives.add(escaped);
    }
    const fixed = [...alternatives].sort((a, b) => b.length - a.length).map(regexEscape);
    const hexPattern = hex.replace(/[a-f]/g, (c) => `[${c}${c.toUpperCase()}]`);
    const numericHex = hexPattern.replace(/^0+/, '');
    fixed.push(`\\\\u${hexPattern}`, `&#0*${char.charCodeAt(0)};`, `&#[xX]0*${numericHex || '0'};`);
    return `(?:${fixed.join('|')})`;
  }).join('');
}

/** One shared, non-overlapping regex for all literal forms, longest first. */
function literalPattern(options) {
  const literals = [...new Set(resolveLiterals(options))];
  if (!literals.length) return null;
  const variants = [...new Set(literals.flatMap(literalVariants))].sort((a, b) => b.length - a.length);
  return new RegExp([...variants.map(regexEscape), ...literals.map(literalFlexSource)].join('|'), 'g');
}

/** Redact bearer tokens, JWTs, auth cookies, bypass values and known env secrets. */
function redactSecrets(text, options) {
  const literals = literalPattern(options);
  if (typeof text !== 'string' || text === '') return text;
  let out = literals ? text.replace(literals, REDACTED) : text;
  for (const { pattern, delimiter } of ESCAPED_JSON_FIELDS) {
    out = out.replace(pattern, (_, prefix) => `${prefix}${REDACTED}${delimiter}`);
  }
  return out
    .replace(HEADER_RE, (_, name, sep) => `${name}${sep}${REDACTED}`)
    .replace(JSON_FIELD_RE, (_, name, sep) => `"${name}"${sep}"${REDACTED}"`)
    .replace(QUERY_RE, (_, name) => `${name}=${REDACTED}`)
    .replace(COOKIE_RE, (_, name) => `${name}=${REDACTED}`)
    .replace(COOKIE_JSON_RE, (_, prefix) => `${prefix}${REDACTED}"`)
    .replace(BEARER_RE, (_, word) => `${word} ${REDACTED}`)
    .replace(JWT_RE, REDACTED);
}

/** Redact an Error (message, stack, cause chain) in place and return it. */
function redactError(error, options, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return error;
  seen.add(error);
  for (const key of ['message', 'stack']) {
    try {
      if (typeof error[key] === 'string') error[key] = redactSecrets(error[key], options);
    } catch {
      // A frozen/getter-only property cannot leak more than it already holds.
    }
  }
  if (error.cause) redactError(error.cause, options, seen);
  return error;
}

// ---------------------------------------------------------------------------
// Detection (used by the pre-upload guard). The Supabase anon key is a public
// JWT shipped in every browser bundle (tooling/runtime-origins.mjs); it is
// still redacted by redactSecrets but does not fail the guard.

function isPublicAnonJwt(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && payload.role === 'anon';
  } catch {
    return false;
  }
}

/** Match spans are internal metadata; callers never print matched values. */
function secretMatchRanges(text, options) {
  const literals = literalPattern(options);
  if (typeof text !== 'string' || text === '') return [];
  const ranges = [];
  for (const match of text.matchAll(/Bearer\s+(ey[A-Za-z0-9._-]*)/g)) {
    const token = match[1];
    const whole = token.match(new RegExp(`^${JWT_SOURCE}$`));
    if (!(whole && isPublicAnonJwt(token))) ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(new RegExp(JWT_SOURCE, 'g'))) {
    if (!isPublicAnonJwt(match[0])) ranges.push([match.index, match.index + match[0].length]);
  }
  if (literals) {
    for (const match of text.matchAll(literals)) ranges.push([match.index, match.index + match[0].length]);
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
    const last = merged[merged.length - 1];
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

/** Number of secret-looking occurrences, with overlapping detectors counted once. */
function countSecretMatches(text, options) {
  return secretMatchRanges(text, options).length;
}

// ---------------------------------------------------------------------------
// Minimal ZIP read/write. Playwright's HTML report embeds its data as a
// base64 zip inside index.html, and traces are zips; both must be opened to be
// redacted or scanned. Only stored/deflate entries without zip64/encryption
// are supported; anything else throws so callers fail closed.

const PLAYWRIGHT_REPORT_RE = /(<template id="playwrightReportBase64">data:application\/zip;base64,)([A-Za-z0-9+/=\s]*)(<\/template>)/;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(buffer) {
  const minEocd = Math.max(0, buffer.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip: zip64 not supported');
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (flags & 0x1) throw new Error('zip: encrypted entries not supported');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('zip: zip64 not supported');
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip: bad local header');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`zip: compression method ${method} not supported`);
    if (data.length !== size) throw new Error('zip: size mismatch');
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, compressed);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function isZip(buffer) {
  return buffer.length >= 4 && [0x04034b50, 0x06054b50].includes(buffer.readUInt32LE(0));
}

/** True for valid UTF-8 without binary control bytes (ANSI logs are text). */
function isText(buffer) {
  if (buffer.some((byte) => byte < 0x20 && ![9, 10, 13, 27].includes(byte))) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  REDACTED,
  SECRET_ENV_NAMES,
  PLAYWRIGHT_REPORT_RE,
  secretLiteralsFromEnv,
  resolveLiterals,
  secretMatchRanges,
  redactSecrets,
  redactError,
  countSecretMatches,
  isPublicAnonJwt,
  readZip,
  writeZip,
  isZip,
  isText,
};
