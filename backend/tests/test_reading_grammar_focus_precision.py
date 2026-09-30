"""Exact JSON number fidelity, independent of asyncpg's lossy JSONB decoder."""
import json
from decimal import Decimal
from uuid import uuid4
from datetime import datetime, timezone

import pytest
from services import reading_grammar_focus as service


def test_exact_json_numbers_keep_all_digits_and_do_not_alias_strings():
    first = Decimal('0.1234567890123456789012345678901')
    second = Decimal('0.1234567890123456789012345678902')
    assert float(first) == float(second)
    encoded = service._json({'nested': [first, {'integer': 123456789012345678901}], 'bool': True})
    assert json.loads(encoded, parse_float=Decimal)['nested'][0] == first
    assert service._hash({'value': first}) != service._hash({'value': second})
    assert service._hash({'value': first}) != service._hash({'value': str(first)})
    for value in [Decimal('NaN'), Decimal('Infinity'), Decimal('-Infinity')]:
        with pytest.raises(ValueError):
            service._json({'value': value})


def test_exact_row_recovers_nested_json_and_keeps_native_sql_scalar_parameters():
    number = Decimal('0.1234567890123456789012345678901')
    identity, timestamp = uuid4(), datetime(2026, 9, 30, tzinfo=timezone.utc)
    metadata = {'precision': number, 'grammar_focus': [{'point': 'Only a point'}]}
    row = {'id': identity, 'updated_at': timestamp, 'metadata': {'precision': float(number)},
           'glossary': [{'weight': float(number)}]}
    raw = {'id': str(identity), 'updated_at': timestamp.isoformat(), 'metadata': metadata,
           'glossary': [{'weight': number}]}
    exact = service._exact_row({**row, '_canonical_row_json': service._json(raw)})
    assert exact['id'] is identity and exact['updated_at'] is timestamp
    assert exact['metadata'] == metadata and exact['glossary'][0]['weight'] == number
    assert '_canonical_row_json' not in exact
    for incomplete in [{**row}, {**row, '_canonical_row_json': '{}'},
                       {**row, '_canonical_row_json': 'invalid'}]:
        with pytest.raises(service.ReadingGrammarFocusError):
            service._exact_row(incomplete)
