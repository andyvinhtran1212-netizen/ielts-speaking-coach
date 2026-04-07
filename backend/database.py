import logging
import sys
from supabase import create_client, Client
from config import settings

logging.warning("[PKG VERSION] Python: %s", sys.version)
import supabase as _supabase_pkg
logging.warning("[PKG VERSION] supabase: %s", getattr(_supabase_pkg, "__version__", "unknown"))
try:
    import postgrest as _postgrest_pkg
    logging.warning("[PKG VERSION] postgrest: %s", getattr(_postgrest_pkg, "__version__", "unknown"))
except ImportError:
    logging.warning("[PKG VERSION] postgrest: not importable")
try:
    import storage3 as _storage3_pkg
    logging.warning("[PKG VERSION] storage3: %s", getattr(_storage3_pkg, "__version__", "unknown"))
except ImportError:
    logging.warning("[PKG VERSION] storage3: not importable")

_url = settings.SUPABASE_URL
_key = settings.SUPABASE_SERVICE_KEY
logging.warning("[DB INIT] SUPABASE_URL loaded: %s", bool(_url))
logging.warning("[DB INIT] SUPABASE_URL value: %s", _url)
logging.warning("[DB INIT] SUPABASE_SERVICE_KEY prefix: %s", (_key or "")[:12])
logging.warning("[DB INIT] SUPABASE_SERVICE_KEY length: %d", len(_key or ""))

supabase_admin: Client = create_client(_url, _key)
