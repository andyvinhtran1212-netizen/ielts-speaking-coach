"""Compile this finite, manually authored content batch; no network calls."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from services.reading_practice_support import digest, plain_source, validated_support


def source_sentences(body: str) -> dict[str, str]:
    result = {}
    for paragraph, block in enumerate(re.split(r"\n\s*\n", body.strip()), 1):
        if re.match(r'^\s*(?:#{1,6}\s|[-*_]{3,}\s*$)', block):
            continue
        # Do not split initials/abbreviations such as Dr. or U.S. into sentences.
        text = plain_source(block)
        cuts = [m.start() for m in re.finditer(r'(?<=[.!?])\s+(?=[A-Z“])', text)
                if not re.search(r'\b(?:Dr|Mr|Mrs|Ms|Prof|St|e\.g|i\.e|[A-Z])\.$', text[:m.start()])]
        bounds = [0, *[cut + 1 for cut in cuts], len(text) + 1]
        for sentence, (start, stop) in enumerate(zip(bounds, bounds[1:]), 1):
            result[f"p{paragraph}-s{sentence}"] = text[start:stop - 1].strip()
    return result


def compile_batch(snapshot: Path, destination: Path) -> list[dict]:
    passages = {p['slug']: p for p in json.loads(snapshot.read_text())}
    output = []
    for path in sorted((Path(__file__).parent / 'authored').glob('*.json')):
        authored = json.loads(path.read_text())
        passage = passages[authored['slug']]
        assert passage['library'] in ('l1_vocab', 'l2_skill')
        assert passage['status'] == 'published'
        assert not (passage['metadata'].get('practice_support') or {}).get('units'), (path.name, 'Already aligned; excluded from this expansion')
        assert authored['source_sha256'] == digest(passage['body_markdown']), (path.name, 'Reviewed source changed')
        assert authored['expected_translation_sha256'] == digest(passage['metadata'].get('translation_vi') or ''), (path.name, 'Existing translation changed')
        source = source_sentences(passage['body_markdown'])
        assert [row[0] for row in authored['sentences']] == list(source), path.name
        units, paragraphs = [], {}
        for unit_id, translation, *pairs in authored['sentences']:
            assert pairs, (path.name, unit_id, 'No manually authored phrase link')
            units.append({'id': unit_id, 'source': source[unit_id],
                          'translation_vi': translation, 'precision': 'sentence',
                          'phrases': [{'source': en, 'target': vi} for en, vi in pairs]})
            paragraphs.setdefault(unit_id.split('-')[0], []).append(translation)
        translation = '\n\n'.join(' '.join(rows) for rows in paragraphs.values())
        previous = passage['metadata'].get('practice_support') or {}
        support = {**previous, 'schema_version': 1,
                   'source_sha256': digest(passage['body_markdown']),
                   'translation_sha256': digest(translation), 'units': units,
                   'illustrations': [authored['illustration']] if authored.get('illustration') else previous.get('illustrations', [])}
        metadata = {**passage['metadata'], 'translation_vi': translation,
                    'practice_support': support}
        assert validated_support(metadata, passage['body_markdown']), path.name
        changes = {'metadata': {'translation_vi': translation, 'practice_support': support}}
        if authored.get('illustration'):
            asset = Path(__file__).resolve().parents[4] / 'frontend/public' / authored['illustration']['src'].lstrip('/')
            assert asset.is_file(), (path.name, 'Missing illustration', str(asset))
            changes['image_url'] = authored['illustration']['src']
        output.append({'passage_id': passage['id'], 'slug': passage['slug'],
                       'library': passage['library'],
                       'source_body_markdown': passage['body_markdown'],
                       'expected_metadata': passage['metadata'],
                       'expected_image_url': passage.get('image_url'),
                       'expected_metadata_sha256': digest(json.dumps(passage['metadata'], sort_keys=True, ensure_ascii=False)),
                       'changes': changes})
    destination.write_text(json.dumps({'authorship': 'Manually translated and phrase-linked by the agent. No translation/AI API.',
                                     'passages': output, 'questions': []}, ensure_ascii=False, indent=2))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    rows = compile_batch(args.snapshot, args.out)
    print(f"Validated {len(rows)} manually authored articles, "
          f"{sum(len(r['changes']['metadata']['practice_support']['units']) for r in rows)} sentences, "
          f"{sum(len(u['phrases']) for r in rows for u in r['changes']['metadata']['practice_support']['units'])} phrase pairs.")
