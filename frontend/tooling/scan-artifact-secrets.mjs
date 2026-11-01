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
// Only the places Playwright stores binary are decoded as declared base64:
// inline attachment `body`, protocol `postData` and `data:` URIs. These must
// decode, and unsupported bytes there fail closed. An arbitrary JSON value is
// not treated as a payload: paths and kebab-case ids share the base64 alphabet
// and decode to opaque bytes. Configured literals are still matched in every
// raw/escaped/URL/base64 form, and long runs are opened below when they decode
// to text, ZIP, gzip or an image.
const BASE64_BODY_RE = /\\*"(?:body|postData)\\*"\s*:\s*\\*"([A-Za-z0-9+/_-]{16,}={0,2})\\*"/g;
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

// Report and trace resources a browser run produces: images, web fonts,
// WebM/MP4 video and WebAssembly. Any other binary stays unscannable.
function isKnownMedia(buffer) {
  const head = buffer.subarray(0, 4);
  return isImage(buffer)
    || ['wOFF', 'wOF2', 'OTTO'].includes(head.toString('ascii'))
    || head.equals(Buffer.from([0x00, 0x01, 0x00, 0x00]))
    || head.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    || buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    || head.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
}

function decodeBase64(encoded) {
  const compact = encoded.replace(/\s+/g, '');
  const bytes = Buffer.from(compact, 'base64');
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  // Buffer.from is permissive (it silently truncates malformed input).
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized) return null;
  return bytes;
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
    return { count: countSecretMatches(buffer.toString('latin1'), options), unscannable: !isKnownMedia(buffer) };
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
  for (const pattern of [BASE64_BODY_RE, BASE64_DATA_RE]) {
    for (const match of text.matchAll(pattern)) {
      const encoded = match[1];
      const start = match.index + match[0].lastIndexOf(encoded);
      const end = start + encoded.length;
      if (overlapsDecoded(start, end)) continue;
      // A declared encoding must decode; its bytes are scanned even when binary.
      const decoded = decodeBase64(encoded);
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
