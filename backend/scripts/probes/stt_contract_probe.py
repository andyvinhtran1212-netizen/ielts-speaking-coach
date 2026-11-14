#!/usr/bin/env python3
"""AUDIODEPR-0051 T001 — probe the /v1/audio/transcriptions response contract.

Read-only probe, staging only. Sends ONE planned request per invocation to
OpenAI's transcription endpoint and stores a *sanitized* view of the response
(field names, types, small non-sensitive samples) under --out-dir.

Hard limits (spec 0051 T001):
  * at most MAX_CALLS requests in total, counted in a fixed per-user T001 ledger
    BEFORE each send (a failed or timed-out call still counts); the 6th is
    refused. No automatic retry.
  * runs only when RAILWAY_ENVIRONMENT_NAME == "staging" and OPENAI_API_KEY is
    set; otherwise exits before any network call.
  * never prints or writes the key, request headers or any env value.

Usage (key injected by Railway, never printed):
  railway run -p <project> -e staging -s <service> -- \
      python3 backend/scripts/probes/stt_contract_probe.py \
      --step 1 --audio <fixture.mp3> --out-dir <dir>
"""
from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
# Direct script invocation must be able to import the canonical usage logger.
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
COUNTER_PATH = Path.home() / ".local/state/ielts-speaking-coach/audiodepr-0051-t001/call_counter.json"
FIXTURE_ROOTS = (REPO_ROOT / "frontend/public/assets", BACKEND_ROOT / "tests/fixtures")
MAX_CALLS = 5
MAX_AUDIO_SECONDS = 120
ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
TZ_VN = timezone(timedelta(hours=7))
PROMPT = "Um, well, I think... uh, you know, it's like, hmm."

# Planned requests. Values are multipart form fields; list values are sent as
# repeated ``key[]`` fields, matching the OpenAI SDK's array encoding.
PLAN: dict[str, dict] = {
    "1": {"model": "gpt-transcribe", "response_format": "json", "languages": ["en"]},
    "2": {"model": "gpt-transcribe", "response_format": "verbose_json", "languages": ["en"]},
    "3": {"model": "gpt-transcribe", "response_format": "json", "language": "en"},
    "4": {"model": "gpt-transcribe", "response_format": "json", "languages": ["en"],
          "timestamp_granularities": ["segment", "word"], "prompt": PROMPT},
    # Reserve options; at most one is used for the fifth call.
    "5-prompt": {"model": "gpt-transcribe", "response_format": "json", "languages": ["en"],
                 "prompt": PROMPT},
    "5-logprobs": {"model": "gpt-transcribe", "response_format": "json", "languages": ["en"],
                   "include": ["logprobs"]},
    "5-whisper": {"model": "whisper-1", "response_format": "verbose_json", "language": "en",
                  "timestamp_granularities": ["segment", "word"]},
}

LIST_SAMPLE = 2
TEXT_LIMIT = 300
SAFE_ERROR_KEYS = ("message", "type", "code", "param")


def check_environment(env: dict) -> str | None:
    """Return a refusal reason, or None when the probe may call the API."""
    if env.get("RAILWAY_ENVIRONMENT_NAME") != "staging":
        return "RAILWAY_ENVIRONMENT_NAME is not 'staging'"
    if not env.get("OPENAI_API_KEY"):
        return "OPENAI_API_KEY is missing"
    return None


def build_form(params: dict) -> list[tuple[str, str]]:
    form: list[tuple[str, str]] = []
    for key, value in params.items():
        if isinstance(value, list):
            form.extend((f"{key}[]", str(v)) for v in value)
        else:
            form.append((key, str(value)))
    return form


def sanitize(value, depth: int = 0):
    """Keep structure and short scalar samples; truncate lists and long text."""
    if isinstance(value, dict):
        return {k: sanitize(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        out = [sanitize(v, depth + 1) for v in value[:LIST_SAMPLE]]
        if len(value) > LIST_SAMPLE:
            out.append(f"... ({len(value)} items total)")
        return out
    if isinstance(value, str) and len(value) > TEXT_LIMIT:
        return value[:TEXT_LIMIT] + f"... ({len(value)} chars)"
    return value


def schema(value):
    """Field → type map (lists described by their first element)."""
    if isinstance(value, dict):
        return {k: schema(v) for k, v in value.items()}
    if isinstance(value, list):
        return [schema(value[0])] if value else []
    return type(value).__name__


def sanitize_error(body) -> dict:
    err = body.get("error") if isinstance(body, dict) else None
    if not isinstance(err, dict):
        return {"error": "<non-JSON or unexpected error body>"}
    return {"error": {k: err.get(k) for k in SAFE_ERROR_KEYS if k in err}}


class CallCounter:
    """Persistent hard cap; the slot is taken before the request is sent."""

    def __init__(self, path: Path, limit: int = MAX_CALLS, initial_calls: int = 0):
        self.path = path
        self.limit = limit
        self.initial_calls = initial_calls

    def used(self) -> int:
        if not self.path.exists():
            return self.initial_calls
        used = json.loads(self.path.read_text())["calls"]
        if type(used) is not int or used < 0:
            raise ValueError("invalid call counter")
        return used

    def take(self) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Lock a stable sidecar inode; atomically replace the data file so a
        # crash cannot expose a partial JSON write or restore a spent slot.
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            used = self.used()
            if used >= self.limit:
                raise RuntimeError(f"call budget exhausted ({used}/{self.limit}); refusing call")
            pending = self.path.with_suffix(".pending")
            with pending.open("w") as fh:
                json.dump({"calls": used + 1}, fh)
                fh.flush()
                os.fsync(fh.fileno())
            pending.replace(self.path)
            return used + 1


def audio_duration(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return float(out.stdout.strip())
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--step", required=True, choices=sorted(PLAN))
    ap.add_argument("--audio", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args(argv)

    reason = check_environment(os.environ)
    if reason:
        print(f"REFUSED: {reason}; no API call made", file=sys.stderr)
        return 2

    args.audio = args.audio.resolve()
    if not args.audio.is_file() or not any(
        args.audio.is_relative_to(root.resolve()) for root in FIXTURE_ROOTS
    ):
        print("REFUSED: audio must be a repo fixture file", file=sys.stderr)
        return 2

    duration = audio_duration(args.audio)
    if duration is None or not math.isfinite(duration) or not 0 < duration <= MAX_AUDIO_SECONDS:
        print(f"REFUSED: audio duration {duration} not in (0, {MAX_AUDIO_SECONDS}] s", file=sys.stderr)
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    # T001 already spent all five calls on 2026-11-10. Missing state must
    # never grant a fresh budget, including in another checkout/out-dir.
    counter = CallCounter(COUNTER_PATH, initial_calls=MAX_CALLS)
    try:
        call_no = counter.take()
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"REFUSED: counter unavailable or exhausted ({type(exc).__name__})", file=sys.stderr)
        return 3

    import requests  # local import: unit tests need no network stack

    params = PLAN[args.step]
    started = datetime.now(TZ_VN)
    t0 = time.monotonic()
    record = {
        "call_no": call_no,
        "step": args.step,
        "time_utc7": started.isoformat(timespec="seconds"),
        "params": params,
        "audio_file": args.audio.name,
        "audio_seconds": round(duration, 3),
    }
    try:
        with args.audio.open("rb") as fh:
            resp = requests.post(
                ENDPOINT,
                headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]},
                data=build_form(params),
                files={"file": (args.audio.name, fh, "audio/mpeg")},
                timeout=120,
            )
        record["http_status"] = resp.status_code
        try:
            body = resp.json()
        except ValueError:
            body = None
        if resp.ok and isinstance(body, dict):
            record["schema"] = schema(body)
            record["response"] = sanitize(body)
        elif resp.ok:
            record["response_text_chars"] = len(resp.text)
        else:
            record["response"] = sanitize_error(body)
    except Exception as exc:  # network error: still counted, never retried
        record["http_status"] = None
        record["exception"] = type(exc).__name__
    record["latency_s"] = round(time.monotonic() - t0, 2)
    try:
        from services.ai_usage_logger import log_whisper

        log_whisper(
            user_id=None, session_id=None, model=params["model"],
            audio_seconds=duration, feature="stt_contract_probe",
            operation="transcription", status=(
                "success" if record.get("http_status") is not None
                and 200 <= record["http_status"] < 300 else "error"
            ),
            latency_ms=round((time.monotonic() - t0) * 1000),
            error_code=record.get("exception"),
            metadata={"probe_run": "AUDIODEPR-0051-T001", "call_no": call_no,
                      "step": args.step, "http_status": record.get("http_status")},
        )
    except Exception as exc:
        # Never retry the provider or print an exception that may contain keys.
        print(f"WARNING: usage logging failed ({type(exc).__name__})", file=sys.stderr)

    out = args.out_dir / f"call{call_no}_step{args.step}.json"
    out.write_text(json.dumps(record, indent=2, ensure_ascii=False))
    print(json.dumps(record, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
