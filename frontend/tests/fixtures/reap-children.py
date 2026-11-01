"""Test-owned supervisor: reap orphaned workers even without a working init.

fd 3 reports the command's exit independently of leaked workers holding pipes.
stdin EOF requests independent teardown, then waits for every owned child.
Python 3's standard library is sufficient; prctl is needed only on Linux.
"""
import ctypes
import json
import os
import select
import signal
import subprocess
import sys

if sys.platform == 'linux':
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0):  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')

command = subprocess.Popen(sys.argv[1:])
closing = False


def forward(signum, _frame):
    if command.returncode is None:
        try:
            os.kill(command.pid, signum)
        except ProcessLookupError:
            pass


for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(signum, forward)


def kill_descendants():
    # Recompute ownership each time. Never signal historical PIDs or PGIDs.
    ps = subprocess.Popen(['ps', '-A', '-o', 'pid=,ppid='], stdout=subprocess.PIPE, text=True)
    rows, _ = ps.communicate()
    if ps.returncode:
        raise RuntimeError('Could not inspect owned descendants')
    parents = [tuple(map(int, row.split())) for row in rows.splitlines() if int(row.split()[0]) != ps.pid]
    owned = {os.getpid()}
    while True:
        found = {pid for pid, ppid in parents if ppid in owned}
        if found <= owned:
            break
        owned.update(found)
    for pid in owned - {os.getpid()}:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


while True:
    if closing:
        kill_descendants()
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            if closing:
                os.write(3, b'{"clean":true}\n')
                sys.exit(0)
            break
        if pid == 0:
            break
        if pid == command.pid:
            command.returncode = os.waitstatus_to_exitcode(status)
            result = {'code': command.returncode if command.returncode >= 0 else None,
                      'signal': signal.Signals(-command.returncode).name if command.returncode < 0 else None}
            os.write(3, (json.dumps(result) + '\n').encode())
    if not closing and select.select([sys.stdin], [], [], 0.02)[0]:
        closing = not os.read(sys.stdin.fileno(), 1024)
    elif closing:
        select.select([], [], [], 0.02)
