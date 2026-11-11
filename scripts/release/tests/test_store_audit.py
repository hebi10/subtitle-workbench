import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import publisher
spec = importlib.util.spec_from_file_location('store_audit', ROOT / 'store_audit.py')
store_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store_audit)


def input_data():
    images = {
        'icon': ['icon.png'], 'featureGraphic': ['feature.png'],
        'phoneScreenshots': [f'0{i}.png' for i in range(1, 9)]
    }
    assets = [{'file': name, 'sha256': str(i).zfill(64)}
              for i, name in enumerate(
                  images['icon'] + images['featureGraphic'] + images['phoneScreenshots'], 1)]
    manifest = {'language': 'ko-KR', 'images': images, 'assets': assets}
    listing = {'language': 'ko-KR', 'title': '해비 자막',
               'shortDescription': '자막 편집', 'fullDescription': '영상 음성 자막 생성 및 편집'}
    return manifest, listing


class FakePlay:
    def __init__(self, manifest, listing, deny_at=None, mismatched=False):
        self.calls = []
        self.committed = False
        self.deny_at = deny_at
        self.mismatched = mismatched
        self.expected = store_audit.expected_files(manifest)
        self.listing = listing

    def __call__(self, method, path, body=None, content_type=None):
        self.calls.append((method, path))
        if self.deny_at and self.deny_at in path:
            raise publisher.ReleaseError('Play API read denied HTTP 403 (status=PERMISSION_DENIED)')
        if method == 'POST' and path == '/edits':
            return {'id': '1'}
        if method == 'DELETE' and path == '/edits/1':
            return {}
        if method == 'GET' and path == '/edits/1/listings/ko-KR':
            return self.listing
        if method == 'GET' and path.startswith('/edits/1/listings/ko-KR/'):
            kind = path.rsplit('/', 1)[-1]
            values = list(self.expected[kind])
            if self.mismatched and kind == 'phoneScreenshots':
                values[0] = 'f' * 64
            return {'images': [{'sha256': sha} for sha in values]}
        if method == 'GET' and path == '/edits/1/tracks':
            return {'tracks': [
                {'track': 'internal', 'releases': [{'versionCodes': ['22'], 'status': 'completed'}]},
                {'track': 'alpha', 'releases': []}
            ]}
        raise AssertionError('Read-only audit issued unapproved request: ' + method + ' ' + path)


class StoreAuditTests(unittest.TestCase):
    def test_matching_assets_and_internal_version_read_only(self):
        manifest, listing = input_data()
        fake = FakePlay(manifest, listing)
        result = store_audit.audit(publisher.Publisher(fake), manifest, listing)
        self.assertTrue(result['screenshotsMatch'])
        self.assertTrue(result['internalVersionCompleted'])
        self.assertEqual(result['status'], 'api_listing_matches_repository')
        self.assertTrue(result['readOnly'])
        self.assertFalse(result['playEditCommitted'])
        self.assertEqual(set(method for method, _ in fake.calls), {'POST', 'GET', 'DELETE'})
        self.assertEqual(sum(method == 'POST' for method, _ in fake.calls), 1)
        self.assertFalse(any(':commit' in path or ':validate' in path or '/bundles' in path
                             or 'uploadType' in path for _, path in fake.calls))

    def test_mismatch_is_reported_not_uploaded(self):
        manifest, listing = input_data()
        fake = FakePlay(manifest, listing, mismatched=True)
        result = store_audit.audit(publisher.Publisher(fake), manifest, listing)
        self.assertEqual(result['status'], 'api_listing_differs_from_repository')
        self.assertFalse(result['screenshotsMatch'])
        self.assertFalse(result['playEditCommitted'])

    def test_permission_denied_is_not_treated_as_confirmation(self):
        manifest, listing = input_data()
        fake = FakePlay(manifest, listing, deny_at='/phoneScreenshots')
        with self.assertRaisesRegex(publisher.ReleaseError, 'HTTP 403'):
            store_audit.audit(publisher.Publisher(fake), manifest, listing)
        self.assertFalse(any(':commit' in path for _, path in fake.calls))

    def test_eight_screenshots_are_required(self):
        manifest, listing = input_data()
        manifest['images']['phoneScreenshots'].pop()
        with self.assertRaisesRegex(publisher.ReleaseError, 'exactly one icon'):
            store_audit.audit(publisher.Publisher(FakePlay(*input_data())), manifest, listing)


    def test_trusted_workflow_routes_exact_audit_marker_and_has_no_write_steps_for_audit(self):
        workflow = (ROOT.parents[1] / '.github/workflows/play-internal.yml').read_text(encoding='utf-8')
        self.assertIn("title\" == 'qa: STORE-04 read-only Play listing audit [audit-only]'", workflow)
        self.assertIn("echo 'mode=audit' >> \"$GITHUB_OUTPUT\"", workflow)
        self.assertIn("python3 scripts/release/store_audit.py --report output/play-store-audit.json", workflow)
        self.assertIn("if: needs.source.outputs.mode == 'audit'", workflow)
        self.assertIn("mode == 'build' || needs.source.outputs.mode == 'deploy'", workflow)
        self.assertIn("if: needs.source.outputs.mode == 'listing'", workflow)
        self.assertIn("if: needs.source.outputs.mode == 'deploy'", workflow)
        self.assertIn("if: needs.source.outputs.mode != 'check'", workflow)



if __name__ == '__main__':
    unittest.main()
