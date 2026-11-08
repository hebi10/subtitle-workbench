import importlib.util
import json
import pathlib
import struct
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import publisher
spec = importlib.util.spec_from_file_location('listing', ROOT / 'listing.py')
listing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listing)


def inputs(root):
    text = {'language': 'ko-KR', 'title': '해비 자막', 'shortDescription': '자막 편집', 'fullDescription': '영상과 음성에서 자막을 생성하고 편집합니다.'}
    (root / 'listing.json').write_text(json.dumps(text), encoding='utf-8')
    images = {'icon': ['icon.png'], 'featureGraphic': ['feature.png'], 'phoneScreenshots': ['screen1.png', 'screen2.png']}
    (root / 'manifest.json').write_text(json.dumps({'language': 'ko-KR', 'images': images}), encoding='utf-8')
    for filename, size in [('icon.png', (512, 512)), ('feature.png', (1024, 500)), ('screen1.png', (540, 1080)), ('screen2.png', (540, 1080))]:
        (root / filename).write_bytes(b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR' + struct.pack('>II', *size) + b'png')
    return text


class ListingServer:
    def __init__(self, readback=True):
        self.calls = []
        self.text = {}
        self.images = {}
        self.readback = readback
        self.committed = False

    def __call__(self, method, path, body=None, content_type=None):
        import hashlib
        self.calls.append((method, path))
        if path == '/edits' and method == 'POST':
            return {'id': str(len(self.calls))}
        if ':commit' in path:
            self.committed = True
            return {}
        if ':validate' in path or method == 'DELETE':
            if '/listings/ko-KR/' in path:
                self.images[path.rsplit('/', 1)[1]] = []
            return {}
        if path.endswith('/listings/ko-KR'):
            if method == 'PUT':
                self.text = body
                return body
            return self.text if self.readback else {}
        kind = path.split('?')[0].rsplit('/', 1)[1]
        if method == 'POST':
            self.images.setdefault(kind, []).append({'sha256': hashlib.sha256(body).hexdigest()})
            return {'image': self.images[kind][-1]}
        if method == 'GET':
            return {'images': self.images.get(kind, []) if self.readback else []}
        raise AssertionError((method, path))


class ListingTests(unittest.TestCase):
    def test_invalid_listing_does_not_make_api_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            inputs(root)
            (root / 'listing.json').write_text(json.dumps({'language': 'ko-KR', 'title': 'x' * 31}), encoding='utf-8')
            with self.assertRaises(publisher.ReleaseError):
                listing.load_inputs(root / 'listing.json', root / 'manifest.json')

    def test_asset_path_cannot_escape_manifest_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            inputs(root)
            data = json.loads((root / 'manifest.json').read_text())
            data['images']['icon'] = ['../outside.png']
            (root / 'manifest.json').write_text(json.dumps(data))
            with self.assertRaisesRegex(publisher.ReleaseError, 'inside'):
                listing.load_inputs(root / 'listing.json', root / 'manifest.json')

    def test_listing_upload_replaces_explicit_categories_then_verifies_fresh_readback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            inputs(root)
            plan = listing.load_inputs(root / 'listing.json', root / 'manifest.json')
            server = ListingServer()
            result = listing.apply(publisher.Publisher(server), plan)
            self.assertEqual(result['status'], 'api_committed_and_verified')
            self.assertTrue(server.committed)
            self.assertEqual(sum(path == '/edits' and method == 'POST' for method, path in server.calls), 2)
            self.assertFalse(any('/tracks' in path or '/bundles' in path for _, path in server.calls))

    def test_failed_listing_readback_is_failure_after_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            inputs(root)
            plan = listing.load_inputs(root / 'listing.json', root / 'manifest.json')
            server = ListingServer(readback=False)
            with self.assertRaisesRegex(publisher.ReleaseError, 'committed.*readback'):
                listing.apply(publisher.Publisher(server), plan)
            self.assertTrue(server.committed)


if __name__ == '__main__':
    unittest.main()
