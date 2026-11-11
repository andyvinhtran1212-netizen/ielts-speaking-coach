"""Private exercise-book transport surfaces shared by logging boundaries."""
from urllib.parse import unquote_plus, urlsplit


def is_private_learning_url(value: str) -> bool:
    try:
        path = unquote_plus(urlsplit(str(value)).path).lower()
        return ("/listening" in path or path.startswith(("/admin/classes", "/admin/cohorts")))
    except (TypeError, ValueError):
        return True  # malformed diagnostic targets fail private
