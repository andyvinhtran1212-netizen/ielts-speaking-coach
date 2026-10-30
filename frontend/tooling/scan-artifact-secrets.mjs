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
import redaction from './redact-secrets.cjs';

const { PLAYWRIGHT_REPORT_RE, countSecretMatches, readZip, isZip, isText } = redaction;

const MAX_DEPTH = 4;
const BASE64_BODY_RE = /"body"\s*:\s*"([A-Za-z0-9+/]{16,}={0,2})"/g;

/** { count, unscannable } for one buffer, recursing into archives. */
export function scanBuffer(buffer, options, depth = 0) {
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
  const text = isText(buffer) ? buffer.toString('utf8') : buffer.toString('latin1');
  let count = countSecretMatches(text, options);
  let unscannable = false;
  const report = text.match(PLAYWRIGHT_REPORT_RE);
  if (report) {
    const zip = Buffer.from(report[2].replace(/\s+/g, ''), 'base64');
    if (!isZip(zip)) {
      unscannable = true;
    } else {
      const inner = scanBuffer(zip, options, depth + 1);
      count += inner.count;
      unscannable = unscannable || inner.unscannable;
    }
  }
  for (const match of text.matchAll(BASE64_BODY_RE)) {
    const inner = scanBuffer(Buffer.from(match[1], 'base64'), options, depth + 1);
    count += inner.count;
    unscannable = unscannable || inner.unscannable;
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
  process.exitCode = main(process.argv.slice(2));
}
