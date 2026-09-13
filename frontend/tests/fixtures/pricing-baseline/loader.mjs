// Node test-runner only: no browser route or runtime fallback.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const expected = new Map([
  ['pricing.html', '/pricing.html'],
  ['pricing.css', '/css/pricing.css'],
  ['index.html', '/index.html'],
]);

function entryFor(name) {
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.files)
      || manifest.files.length !== expected.size
      || new Set(manifest.files.map((entry) => entry.file)).size !== expected.size
      || manifest.files.some((entry) => !expected.has(entry.file)
        || entry.url !== expected.get(entry.file)
        || entry.source !== `frontend/public${entry.url}`)) {
    throw new Error('Invalid Pricing fixture manifest');
  }
  if (!expected.has(name)) throw new Error('Unknown archived Pricing fixture');
  return manifest.files.find((entry) => entry.file === name);
}

export function verifyPricingFixture(name, body) {
  const entry = entryFor(name);
  if (!Buffer.isBuffer(body)) throw new TypeError('Pricing fixture verification requires a Buffer');
  if (body.length !== entry.bytes
      || createHash('sha256').update(body).digest('hex') !== entry.sha256) {
    throw new Error(`Pricing fixture integrity mismatch: ${name}`);
  }
  return body;
}

export function readPricingFixture(name) {
  entryFor(name); // Validate the fixed allowlist before constructing a path.
  const file = new URL(`./${name}`, import.meta.url);
  if (!lstatSync(file).isFile()) throw new Error('Pricing fixture must be a regular file');
  return verifyPricingFixture(name, readFileSync(file)).toString('utf8');
}
