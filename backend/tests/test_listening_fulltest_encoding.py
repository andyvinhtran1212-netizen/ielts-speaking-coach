"""tests/test_listening_fulltest_encoding.py — listening-fulltest-md-import hotfix.

Root cause of the prod 500 (UnicodeEncodeError: 'ascii' codec can't encode …):
Railway can launch Python with an ASCII locale (UTF-8 Mode OFF → stdout=ascii);
a non-ASCII (Vietnamese) stdout write then raises and bubbles to a 500.

Lesson 20 — REAL encode path, real Vietnamese from the sample pack, real ascii
locale, real stdout. NOT mocked. We:
  • negative control: under an ASCII locale with NO fix, printing the sample's
    Vietnamese DOES raise (proves the test exercises the real failure);
  • fix A (PYTHONUTF8=1): the same print succeeds;
  • fix B (sys.stdout.reconfigure, as main.py does at import): succeeds even
    with PYTHONUTF8=0;
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
    """A genuine Vietnamese line from the committed sample (has diacritics)."""
    for ln in _SOL.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if len(s) > 12 and any(ord(c) > 127 for c in s) and "audio://" not in s:
            return s
    raise AssertionError("no Vietnamese line found in the sample Solution")


def _run_child(code: str, *, pythonutf8: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["LC_ALL"] = "C"            # the Railway-style ASCII locale
    env["LANG"] = "C"
    env["PYTHONUTF8"] = pythonutf8
    env["PYTHONCOERCECLOCALE"] = "0"
    return subprocess.run([sys.executable, "-c", code], env=env,
                          capture_output=True, text=True)


_PRINT_VIET = (
    "import sys\n"
    "{recfg}"
    "s = {viet!r}\n"
    "print(s)\n"
)
_RECONFIGURE = (
    "for _s in (sys.stdout, sys.stderr):\n"
    "    try: _s.reconfigure(encoding='utf-8', errors='backslashreplace')\n"
    "    except Exception: pass\n"
)


def test_negative_control_ascii_locale_without_fix_raises():
    viet = _a_real_vietnamese_line()
    cp = _run_child(_PRINT_VIET.format(recfg="", viet=viet), pythonutf8="0")
    # The real failure mode: ascii stdout + Vietnamese print → UnicodeEncodeError.
    assert cp.returncode != 0
    assert "UnicodeEncodeError" in cp.stderr and "ascii" in cp.stderr.lower()


def test_fix_pythonutf8_makes_real_vietnamese_print_succeed():
    viet = _a_real_vietnamese_line()
    cp = _run_child(_PRINT_VIET.format(recfg="", viet=viet), pythonutf8="1")
    assert cp.returncode == 0, cp.stderr
    assert viet in cp.stdout


def test_fix_stdout_reconfigure_makes_real_vietnamese_print_succeed():
    # Mirrors main.py's import-time reconfigure; works even with UTF-8 Mode off.
    viet = _a_real_vietnamese_line()
    cp = _run_child(_PRINT_VIET.format(recfg=_RECONFIGURE, viet=viet), pythonutf8="0")
    assert cp.returncode == 0, cp.stderr
    assert viet in cp.stdout


def test_fixes_are_present_in_source():
    main_py = (_REPO / "backend/main.py").read_text(encoding="utf-8")
    assert re.search(r"reconfigure\(encoding=[\"']utf-8[\"']", main_py), \
        "main.py must reconfigure stdio to utf-8"
    nixpacks = (_REPO / "backend/nixpacks.toml").read_text(encoding="utf-8")
    assert re.search(r'PYTHONUTF8\s*=\s*"1"', nixpacks), \
        "nixpacks.toml must set PYTHONUTF8=1"
