// Process-group helpers for verifier-owned servers (next dev, fixture API).
//
// spawnGroup(cmd, args, opts) — child_process.spawn with detached: true, so the
//   child leads its own process group (PGID = child.pid).
// killGroup(child, signal = 'SIGTERM', { graceMs = 5000 }) — signals the whole
//   group (leader and workers such as next-server). The signal is sent
//   synchronously, so `void killGroup(child, 'SIGKILL')` is safe in an 'exit'
//   handler. The promise resolves once no group member remains; SIGKILL follows
//   after graceMs, then rejects if the group remains after another second.
//   The owner must reap orphaned descendants (e.g. a test-owned subreaper).
//   Repeat calls and never-spawned children are no-ops.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function spawnGroup(cmd, args, opts = {}) {
  return spawn(cmd, args, { ...opts, detached: true });
}

function signalGroup(child, signal) {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function killGroup(child, signal = 'SIGTERM', { graceMs = 5000 } = {}) {
  if (!signalGroup(child, signal)) return;
  const deadline = Date.now() + graceMs;
  // The leader can exit while a worker still owns the group and listening port.
  while (signalGroup(child, 0)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      signalGroup(child, 'SIGKILL');
      // SIGKILL delivery is asynchronous too: do not release the caller while
      // a worker still holds the port. Bound this wait so cleanup can report a
      // stuck group instead of hanging forever.
      const killDeadline = Date.now() + 1000;
      while (signalGroup(child, 0)) {
        if (Date.now() >= killDeadline) throw new Error(`Process group ${child.pid} remains after SIGKILL`);
        await delay(20);
      }
      return;
    }
    await delay(Math.min(50, remaining));
  }
}
