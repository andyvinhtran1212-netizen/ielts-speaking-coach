"""services/writing_prompt_loader.py — Compose system prompts for Gemini grader.

Loads + concatenates the 3 shared modules + the level-specific prompt, then
substitutes {{FORM_OF_ADDRESS}} with the user's chosen pronoun.

Cached file reads via per-instance dict; singleton accessor `get_prompt_loader()`
shares the cache across the app.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

PROMPTS_DIR = Path(__file__).parent.parent / "prompts" / "writing" / "v1"


class WritingPromptLoader:
    """Loads + composes system prompts for the 5 grading levels."""

    PROMPT_VERSION = "v1.0"

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

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}

    def _load_file(self, relative_path: str) -> str:
        if relative_path not in self._cache:
            path = PROMPTS_DIR / relative_path
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
        components.append(self._load_file(self.LEVEL_FILES[level]))

        full_prompt = "\n\n---\n\n".join(components)
        full_prompt = full_prompt.replace("{{FORM_OF_ADDRESS}}", form_of_address)
        return full_prompt

    def list_available_levels(self) -> list[int]:
        return sorted(self.LEVEL_FILES.keys())


# ── Singleton accessor ───────────────────────────────────────────────

_loader_instance: WritingPromptLoader | None = None


def get_prompt_loader() -> WritingPromptLoader:
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = WritingPromptLoader()
    return _loader_instance
