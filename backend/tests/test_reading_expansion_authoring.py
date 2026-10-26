"""Regressions for prose lost while preparing the finite Reading content batch."""
import importlib.util
from pathlib import Path

import pytest


path = Path(__file__).parents[1] / 'content/reading-practice/expansion-20261015/compile_local.py'
spec = importlib.util.spec_from_file_location('reading_expansion_compile', path)
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


@pytest.mark.parametrize('body,expected', [
    ('## Title\nOpening prose. A second sentence.',
     {'p1-s1': 'Opening prose.', 'p1-s2': 'A second sentence.'}),
    ('## Title\n\nOpening prose.', {'p2-s1': 'Opening prose.'}),
    ('## Title\nThe word means "break the fast." After sleep, eat.',
     {'p1-s1': 'The word means "break the fast."', 'p1-s2': 'After sleep, eat.'}),
    ('## Title\nOpening prose.\n\n<!-- wordcount: 2 -->', {'p1-s1': 'Opening prose.'}),
])
def test_all_prose_survives_heading_and_quoted_punctuation(body, expected):
    assert compiler.source_sentences(body) == expected
