"""Private Speaking recordings. Call only after authorizing the owning session.

Persist object paths, never expiring playback URLs. Legacy URLs are used solely
to recover a path on our configured Storage origin; they are never fetched.
"""

import asyncio
import logging
from urllib.parse import unquote, urlsplit

from config import settings

BUCKET = "audio-responses"
PLAYBACK_TTL = 3600
logger = logging.getLogger(__name__)


def _safe_path(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 1024:
        return None
    # Our recording keys are plain bucket-relative paths. Reject encoded path
    # separators/dot segments rather than letting a second decoder reinterpret.
    if any(ord(c) < 32 or ord(c) == 127 or c in "\\%?#:" for c in value):
        return None
    if any(part in {"", ".", ".."} for part in value.split("/")):
        return None
    return value


def recording_path(row: dict) -> str | None:
    """Resolve a server-loaded response, with canonical path taking precedence."""
    if row.get("audio_storage_path"):
        return _safe_path(row["audio_storage_path"])
    legacy = row.get("audio_url")
    if not isinstance(legacy, str) or any(ord(c) < 32 for c in legacy):
        return None
    try:
        url = urlsplit(legacy)
        origin = urlsplit(str(settings.SUPABASE_URL))
        if (url.scheme != "https" or url.netloc != origin.netloc
                or url.username or url.password or url.fragment):
            return None
        for access in ("public", "sign", "authenticated"):
            prefix = f"/storage/v1/object/{access}/{BUCKET}/"
            if url.path.startswith(prefix):
                return _safe_path(unquote(url.path[len(prefix):]))
    except ValueError:
        pass
    return None


async def attach_playback_urls(client, responses: list[dict]) -> bool:
    """Mask persisted URLs and attach short-lived URLs; false means unavailable.

    Batch signing avoids one blocking Storage request per answer. No exception
    may restore a persisted public URL. Callers can keep grades visible while
    separately surfacing a playback failure. No row or object is written here.
    """
    paths = [recording_path(row) for row in responses]
    references = [bool(row.get("audio_storage_path") or row.get("audio_url"))
                  for row in responses]
    for row in responses:
        row["audio_url"] = None
        row["audio_playback_url"] = None
        row["audio_available"] = False
    signed = {}
    unique_paths = list(dict.fromkeys(path for path in paths if path))
    for offset in range(0, len(unique_paths), 100):
        batch = unique_paths[offset:offset + 100]
        try:
            result = await asyncio.to_thread(
                client.storage.from_(BUCKET).create_signed_urls, batch, PLAYBACK_TTL,
            )
            for item in result:
                path = item.get("path")
                url = item.get("signedUrl") or item.get("signedURL")
                if path in batch and isinstance(url, str) and url and not item.get("error"):
                    signed[path] = url
        except (TypeError, ValueError) as exc:
            # Some storage3 releases cannot deserialize a batch with one
            # missing object (signedURL=null). Recover good objects individually,
            # bounded to this batch; never retry transport/auth outages this way.
            logger.warning("[recording-audio] Batch decoding failed (%s, %d paths)",
                           type(exc).__name__, len(batch))
            semaphore = asyncio.Semaphore(4)

            async def sign_one(path):
                async with semaphore:
                    try:
                        item = await asyncio.to_thread(
                            client.storage.from_(BUCKET).create_signed_url, path, PLAYBACK_TTL,
                        )
                        if hasattr(item, "data"):
                            item = item.data
                        if not isinstance(item, dict) or item.get("error"):
                            return
                        url = item.get("signedUrl") or item.get("signedURL")
                        if isinstance(url, str) and url:
                            signed[path] = url
                    except Exception as item_exc:
                        logger.warning("[recording-audio] Individual signing unavailable (%s)",
                                       type(item_exc).__name__)

            await asyncio.gather(*(sign_one(path) for path in batch))
        except Exception as exc:
            # Storage errors can include object names or signed tokens.
            logger.warning("[recording-audio] Playback signing unavailable (%s, %d paths)",
                           type(exc).__name__, len(batch))
    complete = True
    for row, path, referenced in zip(responses, paths, references):
        url = signed.get(path)
        row["audio_url"] = url
        row["audio_playback_url"] = url
        row["audio_available"] = bool(url)
        row["audio_lookup_failed"] = bool(referenced and not url)
        complete = complete and not row["audio_lookup_failed"]
    return complete
