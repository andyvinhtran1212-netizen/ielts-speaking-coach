import { readFileSync } from 'node:fs';
import { validateSpeakingRealDeviceEvidencePair } from './gate-e-speaking-real-device-evidence-lib.mjs';

const files = process.argv.slice(2);
if (files.length !== 2) {
  console.error('usage: node tooling/verify-gate-e-speaking-real-device-pair.mjs <safari.json> <ios.json>');
  process.exit(2);
}

const evidence = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const result = validateSpeakingRealDeviceEvidencePair(
  evidence,
  process.env.GATE_E_EXPECTED_SOURCE_SHA || '',
);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
