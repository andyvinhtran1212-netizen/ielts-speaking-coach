"""services/file_extract_service.py — Phase 2.3c-2 essay-file parser.

Extracts plain text from a student-uploaded essay file so the submit
form can append it to the textarea.  The endpoint that calls into here
(`POST /api/writing/extract-text`) is intentionally stateless — the
textarea remains the single source of truth for draft state, so a
parse failure can't corrupt the saved draft.

Format scope (Phase 2.3c-2):
  •  .docx — `python-docx` (already pinned at 1.1.2 for the Word
     export pipeline; we reuse it).  Paragraphs joined with blank
     lines; tables flattened into ` | `-delimited rows so simple
     two-column "task description / chart figures" tables don't get
     dropped.
  •  .txt  — try a fallback chain of encodings (UTF-8, UTF-8 BOM,
     latin-1, cp1252).  Vietnamese students export from a mix of
     Word/Pages/Notepad and the trailing fallbacks save us from a
     stray cp1252 file blowing up at decode time.

Size cap: 2 MB.  Plenty of headroom for an essay (10k chars × 2 bytes
= 20 KB) — the 2 MB cap is really there to swat away PDFs renamed to
`.docx` and copy-pasted screenshot blobs.

Char cap: 15 000.  The Pydantic `essay_text` validator on submit caps
at 10 k; we leave 5 k of slack so the UI can show a truncation hint
without rejecting outright.  `MAX_EXTRACTED_CHARS` is the contract
the test suite pins.
"""

from __future__ import annotations

import io
import logging

import docx  # python-docx — same dep used by services/word_export.py

logger = logging.getLogger(__name__)


MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
ALLOWED_EXTENSIONS = {".docx", ".txt"}
MAX_EXTRACTED_CHARS = 15_000


class FileExtractError(Exception):
    """Raised on any user-facing extraction failure (bad file, bad
    encoding, oversize, empty).  The router maps every instance to a
    400 with the original Vietnamese message intact."""


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Concatenate paragraphs + flattened table rows from a .docx.

    Falls over with `FileExtractError` if python-docx can't open the
    bytes — the SDK raises a mix of `PackageNotFoundError`,
    `BadZipFile`, and the occasional plain `Exception`, so we catch
    broadly here and surface a single user-readable message instead
    of leaking the SDK internals."""
    try:
        document = docx.Document(io.BytesIO(file_bytes))
    except Exception as exc:
        raise FileExtractError(f"Không đọc được file .docx: {exc}")

    parts: list[str] = []

    for para in document.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)

    # Tables flattened best-effort — we don't try to preserve column
    # alignment, just rescue any text that lives inside a table cell.
    for table in document.tables:
        for row in table.rows:
            row_text = " | ".join(
                cell.text.strip() for cell in row.cells if cell.text.strip()
            )
            if row_text:
                parts.append(row_text)

    return "\n\n".join(parts).strip()


def extract_text_from_txt(file_bytes: bytes) -> str:
    """Try a fallback chain of encodings — UTF-8 first (incl. BOM
    variant), then the two encodings most often produced by Vietnamese
    Windows installs (latin-1, cp1252).  latin-1 will always succeed
    on any byte stream, so it's the implicit safety net."""
    encodings = ["utf-8-sig", "utf-8", "latin-1", "cp1252"]
    for enc in encodings:
        try:
            return file_bytes.decode(enc).strip()
        except UnicodeDecodeError:
            continue
    raise FileExtractError("Không đọc được file .txt — encoding không hỗ trợ.")


def extract_text(filename: str, file_bytes: bytes) -> str:
    """Validate then dispatch to the right extractor.

    Validation order matters: we check size BEFORE extension so a
    100 MB renamed PDF gets the friendlier "quá lớn" message and we
    never spend memory parsing it.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise FileExtractError(
            f"File quá lớn. Tối đa {MAX_FILE_SIZE_BYTES // 1024 // 1024}MB."
        )
    if len(file_bytes) == 0:
        raise FileExtractError("File rỗng.")

    fname_lower = (filename or "").lower()

    if fname_lower.endswith(".docx"):
        text = extract_text_from_docx(file_bytes)
    elif fname_lower.endswith(".txt"):
        text = extract_text_from_txt(file_bytes)
    else:
        raise FileExtractError(
            "Định dạng không hỗ trợ. Chỉ chấp nhận: "
            + ", ".join(sorted(ALLOWED_EXTENSIONS))
        )

    if not text:
        raise FileExtractError("File không có nội dung text.")

    if len(text) > MAX_EXTRACTED_CHARS:
        logger.info(
            "file_extract truncated: orig=%d → max=%d",
            len(text), MAX_EXTRACTED_CHARS,
        )
        text = text[:MAX_EXTRACTED_CHARS]

    return text
