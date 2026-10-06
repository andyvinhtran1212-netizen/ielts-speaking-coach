"""Generated figures remain private and bound to exact reviewed task content."""
from copy import deepcopy
import hashlib
import struct
import pytest
from services import listening_source_figures as figures
from services import listening_source_native as native
from services.listening_source_collection import sign_source_block
from services.listening_package_import import PackageValidationError
from tests.test_listening_source_native import BINDINGS, SOURCE_MANIFEST


def test_all_generated_figures_bind_to_the_reviewed_native_catalog():
    seen = set()
    for row in native.revision()['blocks'].values():
        presentation = row['presentation']
        paths = []
        images = figures.signed_figures(presentation, SOURCE_MANIFEST, lambda path: paths.append(path) or 'https://private.example/signed')
        assert len(images) == len(presentation['figures'])
        for image, figure, path in zip(images, presentation['figures'], paths):
            assert image['asset_id'] == 'gpt-v1:' + figure['figure_id']
            assert '/figures/gpt-v1/' in path and path.endswith('.png')
            seen.add(figure['figure_id'])
    assert len(seen) == 31 and seen == set(figures.figure_catalog()['figures'])


@pytest.mark.parametrize('mutation', [lambda p: p['figures'][0].update(svg='<svg/>'), lambda p: p['figures'][0].update(figure_id='UNTRUSTED')])
def test_changed_reference_cannot_be_signed(mutation):
    presentation = deepcopy(next(row['presentation'] for row in native.revision()['blocks'].values() if row['presentation']['figures']))
    mutation(presentation)
    with pytest.raises(ValueError):
        figures.signed_figures(presentation, SOURCE_MANIFEST, lambda _: pytest.fail('Do not sign altered reference'))


def test_authenticated_block_delivers_generated_images_without_svg_or_crop_fallback():
    block = next(deepcopy(b) for b in BINDINGS.values() if native.native_presentation(b, manifest_sha256=SOURCE_MANIFEST) and native.native_presentation(b, manifest_sha256=SOURCE_MANIFEST)['figures'])
    paths = []
    output = sign_source_block(block, lambda p: paths.append(p) or None, manifest_sha256=SOURCE_MANIFEST)
    assert output['native']['figures'] == []
    assert output['images'] and all(image['url'] == '' for image in output['images'])
    assert all('/figures/gpt-v1/' in path for path in paths)


def test_upload_rejects_changed_bytes_before_any_storage_write(tmp_path, monkeypatch):
    from scripts import upload_listening_source_figures as uploader
    data = b'\x89PNG\r\n\x1a\n' + b'\0'*8 + struct.pack('>II', 100, 80)
    asset = {'file': 'figure.png', 'width': 100, 'height': 80, 'sha256': hashlib.sha256(data).hexdigest()}
    monkeypatch.setattr(uploader, 'figure_catalog', lambda: {'figures': {'figure': asset}})
    (tmp_path / 'figure.png').write_bytes(data)
    assert len(uploader.validated_assets(tmp_path)) == 1
    (tmp_path / 'figure.png').write_bytes(data + b'tampered')
    with pytest.raises(PackageValidationError, match='hash mismatch'):
        uploader.validated_assets(tmp_path)
