// Draft savers a page registers so an auth interruption (the server says this
// device was displaced, FR-052) can keep unsaved work before the local
// sign-out. A saver must write locally (it runs after the server already
// refuses this device's token), resolve quickly, and never throw into the
// sign-out path. Savers run together; slow ones are cut off at the deadline.

const savers = new Set();

/** Adds a saver; returns the function that removes it. */
export function registerDraftSaver(saver) {
  if (typeof saver !== 'function') return () => {};
  savers.add(saver);
  return () => { savers.delete(saver); };
}

/**
 * Runs every saver; resolves within `timeoutMs` whatever they do, with the
 * number of savers that finished without error (a saver resolving `false`
 * means it had nothing to keep).
 */
export async function saveAllDrafts(timeoutMs = 1500) {
  let saved = 0;
  const runs = [...savers].map((saver) => Promise.resolve().then(saver).then(
    (result) => { if (result !== false) saved += 1; },
    () => undefined,
  ));
  if (!runs.length) return 0;
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([Promise.all(runs), deadline]);
  } finally {
    clearTimeout(timer);
  }
  return saved;
}

/** Test seam: forget every saver. */
export function resetDraftSavers() {
  savers.clear();
}
