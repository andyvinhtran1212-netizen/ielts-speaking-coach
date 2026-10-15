from __future__ import annotations

import hashlib
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services.vocab_speech_text import vocabulary_speech_text
import services.tts_audio as tts
import services.advanced_vocab_audio_builder as builder


@pytest.mark.parametrize(('display', 'spoken'), [
    ('They worship their **ancestors** on anniversaries.', 'They worship their ancestors on anniversaries.'),
    ('Build **long-term relationships**.', 'Build long-term relationships.'),
    ('Use __logic__ and *evidence*.', 'Use logic and evidence.'),
    ('An _important_ example.', 'An important example.'),
    ('  A five-star hotel.  ', 'A five-star hotel.'),
    ('A* search uses 3 * 4 and snake_case identifiers.', 'A* search uses 3 * 4 and snake_case identifiers.'),
    ('Unpaired **marker stays visible.', 'Unpaired **marker stays visible.'),
])
def test_display_formatting_is_not_spoken(display, spoken):
    assert vocabulary_speech_text(display) == spoken
    assert vocabulary_speech_text(spoken) == spoken


def test_kokoro_uses_new_clean_key_and_retains_existing_plain_keys():
    raw = 'They worship their **ancestors**.'
    plain = 'They worship their ancestors.'
    original_bad_key = hashlib.sha256(f'{raw}|bf_emma|kokoro-v1.0-pad1'.encode()).hexdigest() + '.mp3'
    expected_plain_key = hashlib.sha256(f'{plain}|bf_emma|kokoro-v1.0-pad1'.encode()).hexdigest() + '.mp3'
    assert tts.audio_path(raw, 'bf_emma', 'kokoro') == expected_plain_key
    assert tts.audio_path(raw, 'bf_emma', 'kokoro') != original_bad_key
    assert tts.audio_path(plain, 'bf_emma', 'kokoro') == expected_plain_key
    assert builder._clip_id(raw, 'bf_emma') + '.mp3' == expected_plain_key
    assert tts.audio_path(raw, 'nova', 'openai') != tts.audio_path(plain, 'nova', 'openai')


@pytest.mark.parametrize('renderer', ['operator', 'bundle'])
def test_each_kokoro_renderer_receives_plain_speech_before_phonemization(renderer):
    class Captured(Exception):
        pass

    calls = []
    def capture(text, *, voice):
        calls.append((text, voice))
        raise Captured

    with patch.dict(sys.modules, {'kokoro': SimpleNamespace(KPipeline=object)}), \
         patch.object(tts, '_kokoro_pipeline', return_value=capture), \
         patch.object(builder, '_PIPELINES', {'b': capture}), \
         pytest.raises(Captured):
        if renderer == 'operator':
            tts._synth_kokoro_sync('A **holistic approach** helps.', 'bf_emma')
        else:
            builder._default_renderer('A **holistic approach** helps.', 'bf_emma')
    assert calls == [('A holistic approach helps.', 'bf_emma')]


def test_bundle_deduplicates_display_variants_without_speaking_their_markup(tmp_path, monkeypatch):
    import json
    source = tmp_path / 'source'
    source.mkdir()
    monkeypatch.setattr(builder, 'collect_core_vocabulary_cards', lambda _: [
        {'lesson_lexeme_id': 'A', 'headword': 'Word', 'example': 'An **example**.'},
        {'lesson_lexeme_id': 'B', 'headword': 'Word', 'example': 'An example.'},
    ])
    spoken = []
    def render(text, voice):
        spoken.append(text)
        return b'ID3' + text.encode()
    out = tmp_path / 'audio'
    builder.generate_vocab_audio_bundle(source, out, renderer=render)
    manifest = json.loads((out / 'manifest.json').read_text())
    assert set(spoken) == {'Word', 'An example.'}
    assert manifest['clip_count'] == 2
    assert manifest['cards']['A']['example'] == manifest['cards']['B']['example']


def test_bundle_manifest_records_spoken_text_and_rejects_older_markup_audio(tmp_path, monkeypatch):
    import json
    from services import advanced_vocab_package_builder as package
    source = tmp_path / 'source'
    source.mkdir()
    monkeypatch.setattr(builder, 'collect_core_vocabulary_cards', lambda _: [
        {'lesson_lexeme_id': 'A', 'headword': 'Word', 'example': 'An **example**.'},
    ])
    out = tmp_path / 'audio'
    builder.generate_vocab_audio_bundle(source, out, renderer=lambda text, voice: b'ID3' + text.encode())
    _, manifest = package.load_vocab_audio_bundle(out)
    assert {clip['text'] for clip in manifest['clips'].values()} == {'Word', 'An example.'}
    example_id = manifest['cards']['A']['example']['clip_id']
    manifest['clips'][example_id]['text'] = 'An **example**.'
    manifest.pop('bundle_checksum')
    manifest['bundle_checksum'] = builder._sha256_bytes(builder._canonical_json(manifest))
    (out / 'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='display markup; regenerate'):
        package.load_vocab_audio_bundle(out)
