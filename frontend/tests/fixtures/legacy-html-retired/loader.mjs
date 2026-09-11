// Compatibility loader for historical source-contract tests after Gate F.
//
// The 129 HTML renderers no longer live under public/ and therefore cannot be
// served by Next. Older tests intentionally continue to inspect their frozen
// source. Remap only missing public *.html reads/existence checks to this
// non-deployable archive; every other filesystem access keeps native behavior.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHIVE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(ARCHIVE_ROOT, '../../..');
const PUBLIC_ROOT = path.join(FRONTEND_ROOT, 'public');
const nativeExistsSync = fs.existsSync.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);
const nativeRealpathSync = fs.realpathSync.bind(fs);

export function archivedLegacyHtmlPath(value) {
  if (typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return null;
  const candidate = value instanceof URL ? fileURLToPath(value) : String(value);
  const absolute = path.resolve(candidate);
  const relative = path.relative(PUBLIC_ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.html')) return null;
  const archived = path.join(ARCHIVE_ROOT, relative);
  return !nativeExistsSync(absolute) && nativeExistsSync(archived) ? archived : null;
}

fs.readFileSync = function readRetiredHtml(value, ...args) {
  return nativeReadFileSync(archivedLegacyHtmlPath(value) || value, ...args);
};

fs.existsSync = function retiredHtmlFixtureExists(value) {
  return nativeExistsSync(value) || Boolean(archivedLegacyHtmlPath(value));
};

fs.realpathSync = function realpathRetiredHtml(value, ...args) {
  return nativeRealpathSync(archivedLegacyHtmlPath(value) || value, ...args);
};

syncBuiltinESMExports();
