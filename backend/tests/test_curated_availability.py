"""Entry points use the same read-only schema gate as the editorial tools."""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from services import curated_readiness


@pytest.mark.parametrize('ready', [False, True])
def test_availability_matches_schema_gate(ready):
    from main import app
    with patch('routers.vocab_units.require_admin', new=AsyncMock(return_value={'id': 'admin'})), \
         patch.object(curated_readiness, 'schema_available', return_value=ready):
        response = TestClient(app).get('/admin/vocabulary/curated-availability')
    if ready:
        assert response.status_code == 200
        assert response.json() == {'available': True}
    else:
        assert response.status_code == 503
        assert response.json()['detail']['error_code'] == 'feature_unavailable'


def test_availability_checks_admin_before_schema():
    from main import app
    with patch('routers.vocab_units.require_admin', new=AsyncMock(side_effect=HTTPException(403, 'denied'))), \
         patch.object(curated_readiness, 'schema_available') as schema:
        assert TestClient(app).get('/admin/vocabulary/curated-availability').status_code == 403
    schema.assert_not_called()
