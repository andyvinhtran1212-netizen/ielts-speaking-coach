// PC-J437 — listed FIRST in the CI reporters of playwright.staging.config.js.
// Reporters receive the same TestResult objects, and github/json/html read
// errors and stdio when they serialize; redacting them here in onTestEnd
// covers errors that did not pass through the request fixture (e.g. a token
// in an assertion message). Files written by the worker (error-context.md)
// are covered by the fixture and by tooling/sanitize-artifacts.mjs.
const { redactSecrets } = require('../../tooling/redact-secrets.cjs');

const ERROR_FIELDS = ['message', 'stack', 'value', 'snippet'];

function redactTestError(error) {
  if (!error || typeof error !== 'object') return;
  for (const key of ERROR_FIELDS) {
    if (typeof error[key] === 'string') error[key] = redactSecrets(error[key]);
  }
  if (error.cause) redactTestError(error.cause);
}

function redactStdio(chunks) {
  if (!Array.isArray(chunks)) return;
  for (let i = 0; i < chunks.length; i += 1) {
    if (typeof chunks[i] === 'string') chunks[i] = redactSecrets(chunks[i]);
  }
}

function redactSteps(steps) {
  for (const step of steps || []) {
    redactTestError(step.error);
    redactSteps(step.steps);
  }
}

class RedactionReporter {
  printsToStdio() {
    return false;
  }

  onTestEnd(_test, result) {
    for (const error of result.errors || []) redactTestError(error);
    redactTestError(result.error);
    redactStdio(result.stdout);
    redactStdio(result.stderr);
    redactSteps(result.steps);
  }

  onError(error) {
    redactTestError(error);
  }
}

module.exports = RedactionReporter;
