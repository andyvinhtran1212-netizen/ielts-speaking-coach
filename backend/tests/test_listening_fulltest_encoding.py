"""tests/test_listening_fulltest_encoding.py — listening-fulltest-md-import hotfix.

Root cause of the prod 500 (UnicodeEncodeError: 'ascii' codec can't encode …):
Railway can launch Python with an ASCII stdio encoding (UTF-8 Mode OFF); a
non-ASCII (Vietnamese) stdout write then raises and bubbles to a 500.

Lesson 20 — REAL encode path, real Vietnamese from the sample pack, real ASCII
stdout, NOT mocked. ASCII stdio is forced deterministically + cross-platform via
PYTHONIOENCODING=ascii (a locale trick is platform-dependent — it reproduced on
macOS but not Linux CI):
  • negative control: ascii stdout + NO fix → printing the sample's Vietnamese
    DOES raise (proves the test exercises the real failure);
  • fix B (sys.stdout.reconfigure, as main.py does at import): succeeds;
  • fix A (PYTHONUTF8=1, UTF-8 Mode): yields utf-8 stdio even under LC_ALL=C;
  • the fixes are actually present in main.py + nixpacks.toml.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

_REPO = Path(__file__).parent.parent.parent
_SOL = _REPO / "docs/content-samples/listening-full-test/ILR-LIS-001/ILR_LIS_001_Solution.md"


def _a_real_vietnamese_line() -> str:
    for ln in _SOL.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if len(s) > 12 and any(ord(c) > 127 for c in s) and "audio://" not in s:
            return s
    raise AssertionError("no Vietnamese line found in the sample Solution")


def _child(code: str, **env_extra) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.pop("PYTHONUTF8", None)
    env.update(env_extra)
    # bytes (no text=) so the PARENT locale never affects decoding
    return subprocess.run([sys.executable, "-c", code], env=env, capture_output=True)


_RECONFIGURE = (
    "for _s in (sys.stdout, sys.stderr):\n"
    "    try: _s.reconfigure(encoding='utf-8', errors='backslashreplace')\n"
    "    except Exception: pass\n"
)


def test_negative_control_ascii_stdout_without_fix_raises():
    viet = _a_real_vietnamese_line()
    cp = _child("import sys\nprint({!r})\n".format(viet), PYTHONIOENCODING="ascii")
    assert cp.returncode != 0          # the real failure mode
    err = cp.stderr.decode("utf-8", "replace")
    assert "UnicodeEncodeError" in err and "ascii" in err.lower()


def test_fix_stdout_reconfigure_makes_real_vietnamese_print_succeed():
    viet = _a_real_vietnamese_line()
    cp = _child("import sys\n" + _RECONFIGURE + "print({!r})\n".format(viet),
                PYTHONIOENCODING="ascii")
    assert cp.returncode == 0, cp.stderr.decode("utf-8", "replace")
    assert viet.encode("utf-8") in cp.stdout


def test_fix_pythonutf8_yields_utf8_stdio_under_c_locale():
    # UTF-8 Mode forces utf-8 stdio regardless of an ASCII locale (the Railway env).
    cp = _child("import sys\nsys.stdout.buffer.write(sys.stdout.encoding.encode())\n",
                PYTHONUTF8="1", LC_ALL="C", LANG="C")
    assert cp.returncode == 0, cp.stderr.decode("utf-8", "replace")
    assert cp.stdout.decode().lower().replace("-", "") == "utf8"


def test_fixes_are_present_in_source():
    main_py = (_REPO / "backend/main.py").read_text(encoding="utf-8")
    assert re.search(r"reconfigure\(encoding=[\"']utf-8[\"']", main_py), \
        "main.py must reconfigure stdio to utf-8"
    nixpacks = (_REPO / "backend/nixpacks.toml").read_text(encoding="utf-8")
    assert re.search(r'PYTHONUTF8\s*=\s*"1"', nixpacks), \
        "nixpacks.toml must set PYTHONUTF8=1"
