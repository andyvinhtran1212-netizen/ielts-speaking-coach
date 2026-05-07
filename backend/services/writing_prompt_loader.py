"""services/writing_prompt_loader.py — Compose system prompts for Gemini grader.

Loads + concatenates the 3 shared modules + the level-specific prompt, then
substitutes {{FORM_OF_ADDRESS}} with the user's chosen pronoun.

Sprint 2.6: version-aware loading. Both v1 (legacy) and v2 (band descriptors
+ chain-of-thought + validation rules + few-shot calibration) live alongside.
The loader picks the version per-instance; the singleton accessor honours
`settings.WRITING_PROMPT_VERSION` so production can A/B test by env var.

Cached file reads via per-instance dict; one cache per version so v1 and v2
loaders don't poison each other.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

PROMPTS_BASE_DIR = Path(__file__).parent.parent / "prompts" / "writing"

# Default version — v1 stays default until A/B testing confirms v2 is at
# least as good. Override per-instance via `WritingPromptLoader(version="v2")`
# or globally via `settings.WRITING_PROMPT_VERSION`.
DEFAULT_VERSION = "v1"


class WritingPromptLoader:
    """Loads + composes system prompts for the 5 grading levels.

    Args:
        version: "v1" or "v2" (or any future version). Determines which
            sub-directory of `prompts/writing/` is used. Falls back to
            DEFAULT_VERSION if not provided.
    """

    LEVEL_FILES: dict[int, str] = {
        1: "system_l1_strict_grammar_police.md",
        2: "system_l2_logic_coach.md",
        3: "system_l3_critical_debater.md",
        4: "system_l4_ruthless_editor.md",
        5: "system_l5_pedantic_linguist.md",
    }

    SHARED_FILES: list[str] = [
        "shared/persona_vn_examiner.md",
        "shared/strict_grammar_check.md",
        "shared/output_schema_instructions.md",
    ]

    def __init__(self, version: Optional[str] = None) -> None:
        self.version = version or DEFAULT_VERSION
        self.prompts_dir = PROMPTS_BASE_DIR / self.version
        if not self.prompts_dir.exists():
            raise FileNotFoundError(
                f"Prompt version directory not found: {self.prompts_dir}"
            )
        self._cache: dict[str, str] = {}

    # Stamped onto GradingResult.prompt_version + persisted to
    # writing_feedback.prompt_version. Values per version:
    #   v1 → "v1.0"  (legacy stamp, preserved for backwards-compat
    #                 with tests / dashboards that pin "v1.0")
    #   v2 → "v2.0"  (Sprint 2.6 — band descriptors + CoT + validation)
    # A/B query filters on this column. Bare-version directory layout
    # ("v1"/"v2") is internal — external observers see the dotted stamp.
    _VERSION_STAMPS: dict[str, str] = {
        "v1": "v1.0",
        "v2": "v2.0",
    }

    @property
    def PROMPT_VERSION(self) -> str:
        return self._VERSION_STAMPS.get(self.version, self.version)

    def _load_file(self, relative_path: str) -> str:
        if relative_path not in self._cache:
            path = self.prompts_dir / relative_path
            if not path.exists():
                raise FileNotFoundError(f"Prompt file not found: {path}")
            self._cache[relative_path] = path.read_text(encoding="utf-8")
        return self._cache[relative_path]

    def load(
        self,
        level: Literal[1, 2, 3, 4, 5],
        form_of_address: Literal["bạn", "em", "anh", "chị"] = "em",
    ) -> str:
        """Compose the full system prompt for one grading call."""

        if level not in self.LEVEL_FILES:
            raise ValueError(f"Invalid level: {level}. Must be 1-5.")

        components: list[str] = [self._load_file(f) for f in self.SHARED_FILES]

        # v2 prepends a level-specific calibration file (few-shot examples)
        # before the level prompt. Calibration is optional — if the file is
        # missing the loader falls back gracefully so a partial v2 directory
        # still works (useful during incremental rollout / per-level
        # iteration on calibration content).
        if self.version != "v1":
            cal_relative = f"calibration/l{level}_examples.md"
            cal_path = self.prompts_dir / cal_relative
            if cal_path.exists():
                components.append(self._load_file(cal_relative))

        components.append(self._load_file(self.LEVEL_FILES[level]))

        full_prompt = "\n\n---\n\n".join(components)
        full_prompt = full_prompt.replace("{{FORM_OF_ADDRESS}}", form_of_address)
        return full_prompt

    def list_available_levels(self) -> list[int]:
        return sorted(self.LEVEL_FILES.keys())


# ── Singleton accessor ───────────────────────────────────────────────

_loader_instances: dict[str, WritingPromptLoader] = {}


def get_prompt_loader(version: Optional[str] = None) -> WritingPromptLoader:
    """Return a process-wide cached loader for the given version.

    Reads `settings.WRITING_PROMPT_VERSION` if `version` is None so a
    production env-var flip switches the version without code changes. We
    cache one loader per version (rather than one global) so an A/B test
    that explicitly mixes versions in-process doesn't churn the file cache.
    """
    if version is None:
        # Defer import to avoid circular dependency on config at module load.
        try:
            from config import settings
            version = getattr(settings, "WRITING_PROMPT_VERSION", DEFAULT_VERSION)
        except Exception:
            version = DEFAULT_VERSION

    if version not in _loader_instances:
        _loader_instances[version] = WritingPromptLoader(version=version)
    return _loader_instances[version]
