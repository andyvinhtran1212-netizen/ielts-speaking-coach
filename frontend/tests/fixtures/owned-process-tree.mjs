import { spawnSync } from 'node:child_process';

// Inspect only descendants of the test-owned root, including zombie children.
export function descendants(root) {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8' });
  if (ps.error) throw ps.error;
  if (ps.status !== 0) throw new Error(ps.stderr);
  const rows = ps.stdout.trim().split('\n').map((line) => {
    const [pid, ppid, pgid, stat, ...command] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), stat, command: command.join(' ') };
  }).filter(({ pid }) => pid !== ps.pid);
  const owned = new Set([root]);
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size;
    for (const { pid, ppid } of rows) if (owned.has(ppid)) owned.add(pid);
  }
  return rows.filter(({ pid }) => pid !== root && owned.has(pid));
}
