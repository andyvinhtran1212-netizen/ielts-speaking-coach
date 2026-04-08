import logging
import sys
from supabase import create_client, Client
from config import settings

import supabase as _supabase_pkg
try:
    import postgrest as _postgrest_pkg
except ImportError:
    pass
try:
    import storage3 as _storage3_pkg
except ImportError:
    pass

_url = settings.SUPABASE_URL
_key = settings.SUPABASE_SERVICE_KEY

supabase_admin: Client = create_client(_url, _key)
