// MEDIAOUT-0078 option D (T002, G10-T18): same-origin rewrites from the legacy
// Advanced Vocabulary media URLs `/assets/advanced-vocab/<lesson>/…` to the
// checksum directory of the lesson's current version,
// `/assets/advanced-vocab/versions/<lesson>/<checksum>/…`.
//
// Off unless AVER_ADVANCED_VOCAB_LEGACY_REWRITE is exactly '1' (FR-006): an
// empty or any other value yields no rule, so routing stays as it is today.
// The rules belong in `beforeFiles`: while the legacy tree is still in
// public/, an `afterFiles` rewrite would never run because the static file wins.
//
// The lesson → checksum table is a static module written by
// backend/scripts/sync_advanced_vocab_core30.py from core30-manifest.json, so
// rewrites() never reads the filesystem.
import { ADVANCED_VOCAB_LEGACY_CHECKSUMS } from './advanced-vocab-legacy-table.mjs';

export const ADVANCED_VOCAB_LEGACY_REWRITE_FLAG = 'AVER_ADVANCED_VOCAB_LEGACY_REWRITE';
export const ADVANCED_VOCAB_ASSET_PREFIX = '/assets/advanced-vocab';

const LESSON_ID = /^ADV-T\d{2}$/;
const CHECKSUM = /^[0-9a-f]{64}$/;

export function advancedVocabLegacyRewriteEnabled(env = process.env) {
  return env[ADVANCED_VOCAB_LEGACY_REWRITE_FLAG] === '1';
}

export function buildAdvancedVocabLegacyRewrites(
  env = process.env,
  table = ADVANCED_VOCAB_LEGACY_CHECKSUMS,
) {
  if (!advancedVocabLegacyRewriteEnabled(env)) return [];
  return Object.entries(table).map(([lessonId, checksum]) => {
    if (!LESSON_ID.test(lessonId) || !CHECKSUM.test(checksum)) {
      throw new Error(`advanced-vocab legacy table: invalid entry ${lessonId} → ${checksum}`);
    }
    return {
      source: `${ADVANCED_VOCAB_ASSET_PREFIX}/${lessonId}/:path*`,
      destination: `${ADVANCED_VOCAB_ASSET_PREFIX}/versions/${lessonId}/${checksum}/:path*`,
    };
  });
}
