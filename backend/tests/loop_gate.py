"""Prove a route keeps the event loop free without measuring wall-clock time.

PC-J425/PC-J428 tests used to stub a service with ``time.sleep(0.5)`` and assert
that /ping or a heartbeat stayed under 0.1–0.2 s. CI runners can freeze the
whole interpreter for longer than that (a full ``gc`` pass holds the GIL; ~0.4 s
pauses were seen on PR #2073/#2112 runs while the routes were correct), so the bound
flaked without telling us anything about the route.

A ``LoopGate`` instead parks each stubbed call inside the worker until the test,
running on the loop, has done other work and calls ``release``. That ordering
is the proof: a call made on the loop thread blocks the loop, so the test
cannot run until the call returns, and the call only returns after release.
With a route that blocks, the parked call gives up after ``WAIT`` seconds and
records ``timed_out``, and the caller's order assertions fail.
"""
import asyncio
import threading
import time

# Liveness cap only, not a latency budget: a passing test is released within
# milliseconds. 10 s is far above the longest interpreter pause we saw (0.475 s
# in CI, 1.44 s gen-2 GC under a 16-process CPU burner locally), and it is also
# how long a regressed (blocking) route takes to fail.
WAIT = 10.0


class LoopGate:
    def __init__(self):
        self.lock = threading.Lock()
        self.threads = []  # one ident per parked call, in arrival order
        self.release_event = threading.Event()
        self.timed_out = False

    @property
    def inside(self):
        with self.lock:
            return len(self.threads)

    def park(self):
        with self.lock:
            self.threads.append(threading.get_ident())
        if not self.release_event.wait(WAIT):
            self.timed_out = True
            self.release_event.set()  # a later parked call must not add another WAIT

    def release(self):
        self.release_event.set()

    @property
    def released(self):
        return self.release_event.is_set()


async def until(predicate, *, stop=None):
    """Yield to the loop until ``predicate()`` holds, ``stop`` is done or WAIT passes."""
    deadline = time.monotonic() + WAIT
    while not predicate() and not (stop is not None and stop.done()) and time.monotonic() < deadline:
        await asyncio.sleep(0.001)
    return predicate()
