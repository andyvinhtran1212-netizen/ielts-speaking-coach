import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';


const BEHAVIOR = readFileSync(
  new URL('../app/(authed)/course-exercises/course-behavior.tsx', import.meta.url),
  'utf8',
);
const CSS = readFileSync(
  new URL('../public/css/course-exercises.css', import.meta.url),
  'utf8',
);


test('an MCQ with audio_url renders an optional native audio control', () => {
  assert.match(BEHAVIOR, /q\.audio_url && !isWrite/);
  assert.match(BEHAVIOR, /id="cx-question-audio" controls preload="none"/);
  assert.match(BEHAVIOR, /questionAudio\.src = String\(q\.audio_url\)/);
  assert.match(CSS, /\.cx-question-audio\s*\{/);
});


test('the URL is assigned through the DOM property, not interpolated into HTML', () => {
  assert.doesNotMatch(BEHAVIOR, /src="\$\{[^}]*q\.audio_url/);
});
