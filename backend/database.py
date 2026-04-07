import logging
from supabase import create_client, Client
from config import settings

_url = settings.SUPABASE_URL
_key = settings.SUPABASE_SERVICE_KEY
logging.warning("[DB INIT] SUPABASE_URL loaded: %s", bool(_url))
logging.warning("[DB INIT] SUPABASE_URL value: %s", _url)
logging.warning("[DB INIT] SUPABASE_SERVICE_KEY prefix: %s", (_key or "")[:12])
logging.warning("[DB INIT] SUPABASE_SERVICE_KEY length: %d", len(_key or ""))

supabase_admin: Client = create_client(_url, _key)
