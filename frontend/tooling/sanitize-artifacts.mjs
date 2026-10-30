#!/usr/bin/env node
// PC-J437 — redact secrets in place in every file that is about to be
// uploaded as a CI artifact. Text files are redacted directly; zips (traces)
// and the base64 zip embedded in a Playwright HTML report are opened,
// redacted entry by entry and re-packed. An archive that cannot be opened is
// REMOVED (fail closed) and listed, so the guard and upload never see it.
//
// Usage: node tooling/sanitize-artifacts.mjs <file-or-dir> [...]
// Output lists paths only, never file contents.
import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import redaction from './redact-secrets.cjs';

const { PLAYWRIGHT_REPORT_RE, redactSecrets, readZip, writeZip, isZip, isText } = redaction;

const MAX_DEPTH = 4;
const BASE64_BODY_RE = /("body"\s*:\s*")([A-Za-z0-9+/]{16,}={0,2})(")/g;

class UnreadableArchive extends Error {}

function redactText(text, options, depth) {
  // JSON reporter stores inline attachments as base64 `body` fields.
  const withBodies = text.replace(BASE64_BODY_RE, (whole, open, body, close) => {
    const decoded = Buffer.from(body, 'base64');
    const next = sanitizeBuffer(decoded, options, depth + 1);
    return next === decoded ? whole : `${open}${next.toString('base64')}${close}`;
  });
  const report = withBodies.match(PLAYWRIGHT_REPORT_RE);
  if (!report) return redactSecrets(withBodies, options);
  let zip;
  try {
    zip = Buffer.from(report[2].replace(/\s+/g, ''), 'base64');
    zip = sanitizeBuffer(zip, options, depth + 1, { requireZip: true });
  } catch (error) {
    throw new UnreadableArchive(error.message);
  }
  // Outside the template is Playwright's static viewer app (inlined JS/CSS),
  // which holds no run data; rewriting it (e.g. `document.cookie=`) could
  // break the viewer. The guard still scans the whole file.
  const start = report.index;
  const end = start + report[0].length;
  return withBodies.slice(0, start)
    + report[1] + zip.toString('base64') + report[3]
    + withBodies.slice(end);
}

/** Return a sanitized copy of `buffer` (the same object when unchanged). */
export function sanitizeBuffer(buffer, options, depth = 0, { requireZip = false } = {}) {
  if (depth > MAX_DEPTH) throw new UnreadableArchive('archive nesting too deep');
  if (isZip(buffer)) {
    let entries;
    try {
      entries = readZip(buffer);
    } catch (error) {
      throw new UnreadableArchive(error.message);
    }
    let changed = false;
    const next = entries.map(({ name, data }) => {
      const clean = sanitizeBuffer(data, options, depth + 1);
      if (clean !== data) changed = true;
      return { name, data: clean };
    });
    return changed ? writeZip(next) : buffer;
  }
  if (requireZip) throw new UnreadableArchive('embedded report is not a zip');
  if (!isText(buffer)) return buffer;
  const text = buffer.toString('utf8');
  const clean = redactText(text, options, depth);
  return clean === text ? buffer : Buffer.from(clean, 'utf8');
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

/** Sanitize files/dirs in place. Returns { changed: [], removed: [], missing: [] }. */
export function sanitizePaths(targets, options) {
  const result = { changed: [], removed: [], missing: [] };
  for (const target of targets) {
    for (const { file, missing } of walk(target)) {
      if (missing) {
        result.missing.push(file);
        continue;
      }
      const original = readFileSync(file);
      try {
        const clean = sanitizeBuffer(original, options);
        if (clean !== original) {
          writeFileSync(file, clean);
          result.changed.push(file);
        }
      } catch (error) {
        if (!(error instanceof UnreadableArchive)) throw error;
        rmSync(file, { force: true });
        result.removed.push(file);
      }
    }
  }
  return result;
}

function main(argv) {
  if (!argv.length) {
    console.error('usage: sanitize-artifacts.mjs <file-or-dir> [...]');
    return 2;
  }
  const { changed, removed, missing } = sanitizePaths(argv);
  for (const file of missing) console.log(`skip (missing): ${file}`);
  for (const file of changed) console.log(`redacted: ${file}`);
  for (const file of removed) console.log(`removed (archive could not be opened for redaction): ${file}`);
  console.log(`sanitize-artifacts: ${changed.length} redacted, ${removed.length} removed`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
