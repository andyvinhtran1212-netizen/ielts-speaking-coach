#!/usr/bin/env node
// PC-J437 — pre-upload guard. Exits 1 when any file about to be uploaded as a
// CI artifact still holds a bearer token, a JWT or the literal value of a
// secret environment variable (e.g. STAGING_BYPASS). Zips and the base64 zip
// embedded in a Playwright HTML report are opened and scanned too; an
// archive that cannot be opened counts as a failure (fail closed).
//
// Usage: node tooling/scan-artifact-secrets.mjs <file-or-dir> [...]
// Output is limited to file paths and match counts — never the matches.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import redaction from './redact-secrets.cjs';

const { PLAYWRIGHT_REPORT_RE, countSecretMatches, secretMatchRanges, resolveLiterals, readZip, isZip, isText } = redaction;

const MAX_DEPTH = 4;
// Inline attachments and protocol Binary fields must decode, even when binary.
const BASE64_BODY_RE = /\\*"(?:body|postData)\\*"\s*:\s*\\*"([A-Za-z0-9+/_-]{16,}={0,2})\\*"/g;
// A complete base64 JSON value is an identifiable payload regardless of key.
// Quote delimiters may themselves be JSON-escaped in trace/report strings.
// Incidental alphabet-only words embedded in ordinary text are handled below.
const BASE64_FIELD_RE = /\\*"(?<key>[^"\r\n]*?)\\*"\s*:\s*\\*"(?<encoded>[A-Za-z0-9+/_-]{24,}={0,2})\\*"/g;
const BASE64_DATA_RE = /\bdata:[^,\s"'<>]*;base64,([A-Za-z0-9+/_-]+={0,2})/g;
const BASE64_RUN_RE = /[A-Za-z0-9+/_-]{24,}={0,2}/g;

function isGzip(buffer) {
  return buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isImage(buffer) {
  return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    || buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
    || (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
}

function decodeBase64(encoded) {
  const compact = encoded.replace(/\s+/g, '');
  const bytes = Buffer.from(compact, 'base64');
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  // Buffer.from is permissive (it silently truncates malformed input).
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized) return null;
  return bytes;
}

// Provenance Git SHAs and trace IDs share the base64 alphabet. Recognize
// their schema role AND their digest/UUID format, without exempting payloads
// just because their property happens to be named "id" or "hash".
function isLiteralIdentifier(key, value) {
  if (!key) return false;
  const name = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (!/(?:^|_)(?:id|sha(?:1|256|384|512)?|hash|checksum|release|commit)$/.test(name)) return false;
  return /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/i.test(value)
    || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

/** { count, unscannable } for one buffer, recursing into archives. */
export function scanBuffer(buffer, options, depth = 0) {
  // Validate even empty archives/files or missing targets, not just text hits.
  if (depth === 0) options = { literals: resolveLiterals(options) };
  if (depth > MAX_DEPTH) return { count: 0, unscannable: true };
  if (isZip(buffer)) {
    let entries;
    try {
      entries = readZip(buffer);
    } catch {
      return { count: countSecretMatches(buffer.toString('latin1'), options), unscannable: true };
    }
    return entries.reduce((total, { data }) => {
      const inner = scanBuffer(data, options, depth + 1);
      return { count: total.count + inner.count, unscannable: total.unscannable || inner.unscannable };
    }, { count: 0, unscannable: false });
  }
  if (isGzip(buffer)) {
    let decoded;
    try {
      decoded = zlib.gunzipSync(buffer);
    } catch {
      return { count: 0, unscannable: true };
    }
    return scanBuffer(decoded, options, depth + 1);
  }
  if (!isText(buffer)) {
    return { count: countSecretMatches(buffer.toString('latin1'), options), unscannable: !isImage(buffer) };
  }
  const text = buffer.toString('utf8');
  const hits = secretMatchRanges(text, options);
  let count = hits.length;
  let unscannable = false;
  const decodedRegions = [];
  function addDecoded(start, end, inner) {
    // A stable base64 literal span and its decoded secret are the same leak.
    // Preserve distinct inner occurrences while avoiding overlapping counts.
    const direct = hits.filter(([a, b]) => a < end && b > start).length;
    count += Math.max(0, inner.count - direct);
    unscannable ||= inner.unscannable;
    decodedRegions.push([start, end]);
  }
  const overlapsDecoded = (start, end) => decodedRegions.some(([a, b]) => a < end && b > start);

  // Consume the report first so its ZIP is not scanned again as a generic run.
  for (const report of text.matchAll(new RegExp(PLAYWRIGHT_REPORT_RE.source, 'g'))) {
    const start = report.index + report[1].length;
    const zip = decodeBase64(report[2]);
    const inner = zip && isZip(zip) ? scanBuffer(zip, options, depth + 1) : { count: 0, unscannable: true };
    addDecoded(start, start + report[2].length, inner);
  }
  for (const { pattern, declaredEncoding } of [
    { pattern: BASE64_BODY_RE, declaredEncoding: true },
    { pattern: BASE64_FIELD_RE, declaredEncoding: false },
    { pattern: BASE64_DATA_RE, declaredEncoding: true },
  ]) {
    for (const match of text.matchAll(pattern)) {
      const encoded = match.groups?.encoded || match[1];
      const start = match.index + match[0].lastIndexOf(encoded);
      const end = start + encoded.length;
      if (overlapsDecoded(start, end)) continue;
      const decoded = decodeBase64(encoded);
      // An arbitrary word need not be valid base64. Explicit attachment/data
      // encodings must decode; a canonical full-field payload must be scanned
      // even when its bytes identify unsupported compression or opaque binary.
      if (!decoded && !declaredEncoding) continue;
      if (decoded && !declaredEncoding && isLiteralIdentifier(match.groups?.key, encoded)
        && !(isText(decoded) || isZip(decoded) || isGzip(decoded) || isImage(decoded))) {
        // Raw literal/JWT matches were counted above and are never exempted.
        decodedRegions.push([start, end]);
        continue;
      }
      addDecoded(start, end, decoded ? scanBuffer(decoded, options, depth + 1) : { count: 0, unscannable: true });
    }
  }
  // Protocol fields need not be named "body". Inspect every long base64 run,
  // including url-safe runs. Ordinary identifiers also match this alphabet;
  // recurse when their decoded bytes identify text, ZIP, gzip or an image.
  for (const match of text.matchAll(BASE64_RUN_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsDecoded(start, end)) continue;
    const decoded = decodeBase64(match[0]);
    if (!decoded || !(isText(decoded) || isZip(decoded) || isGzip(decoded) || isImage(decoded))) continue;
    addDecoded(start, end, scanBuffer(decoded, options, depth + 1));
  }
  return { count, unscannable };
}

function* walk(target) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    yield { file: target, missing: true };
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(target).sort()) yield* walk(path.join(target, name));
  } else if (stat.isFile()) {
    yield { file: target };
  }
}

/** Scan files/dirs. Returns { findings: [{ file, count, unscannable }], missing, scanned }. */
export function scanPaths(targets, options) {
  options = { literals: resolveLiterals(options) };
  const findings = [];
  const missing = [];
  let scanned = 0;
  for (const target of targets) {
    for (const { file, missing: isMissing } of walk(target)) {
      if (isMissing) {
        missing.push(file);
        continue;
      }
      scanned += 1;
      const { count, unscannable } = scanBuffer(readFileSync(file), options);
      if (count || unscannable) findings.push({ file, count, unscannable });
    }
  }
  return { findings, missing, scanned };
}

function main(argv) {
  if (!argv.length) {
    console.error('usage: scan-artifact-secrets.mjs <file-or-dir> [...]');
    return 2;
  }
  const { findings, missing, scanned } = scanPaths(argv);
  for (const file of missing) console.log(`skip (missing): ${file}`);
  for (const { file, count, unscannable } of findings) {
    const parts = [];
    if (count) parts.push(`${count} secret-like match(es)`);
    if (unscannable) parts.push('archive could not be opened');
    console.log(`${file}: ${parts.join(', ')}`);
  }
  console.log(`scan-artifact-secrets: ${scanned} file(s) scanned, ${findings.length} flagged`);
  if (findings.length) {
    console.log('::error::Artifact secret guard: secret-like values remain in files queued for upload; the upload is blocked.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch {
    console.error('::error::Artifact secret guard: invalid secret configuration or unreadable input; the upload is blocked.');
    process.exitCode = 1;
  }
}
