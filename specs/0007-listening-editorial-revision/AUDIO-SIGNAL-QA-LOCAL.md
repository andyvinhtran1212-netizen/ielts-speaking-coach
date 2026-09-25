# Listening v1.0 audio — automated signal screen

Read-only check on 2026-09-24 against the immutable
`/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY` release.
This is **not** perceptual listening, transcript verification or approval to
publish a new revision. No source audio or manifest was changed.

| Check | General | IELTS | Result |
| --- | ---: | ---: | --- |
| Manifest-declared WAV files present with no unlisted WAV | 273/273 | 117/117 | Pass |
| WAV decode errors | 0 | 0 | Pass |
| Format | 24 kHz, mono, 16-bit PCM | 24 kHz, mono, 16-bit PCM | Consistent |

Across all **390** recordings: duration 2.25–185.82 seconds (median 19.61);
zero silent files; zero overall RMS levels below −35 dBFS; zero detected peaks
at or above 32,760/32,768; zero leading or trailing silent runs above two
seconds; and zero silent runs above five seconds anywhere in a file.

All **1,474 declared timing segments** were also measured inside their own
start/end windows: zero read errors, zero windows shorter than 0.1 seconds,
and zero segment RMS values below −35 dBFS. Segment RMS ranged from −29.5 to
−21.8 dBFS (median −26.1). This reduces the risk of an obviously silent
declared timing window but does not prove it contains the *right*
spoken words.

Method: decode each PCM WAV with Python `wave`, inspect consecutive 100 ms
windows with `audioop.rms`/`audioop.max`, and treat RMS below 100/32,768 as a
silent window. Duration, level and peak thresholds are screening heuristics,
not a mastering standard. Manifest inventory was compared with the files on
disk by relative path. Segment RMS used the timing JSON start/end bounds and
the corresponding WAV frame range; package validation separately checks hashes
and timing structure.

Still required: listen to representative accents/voices, verify each prompt
against what is actually heard, inspect clipping/noise that these thresholds
cannot establish, and review segment-level timing on real playback. A clean
signal screen must not be marked as perceptual audio QA.
