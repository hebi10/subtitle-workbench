import importlib.util
import re
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / 'publisher.py'
spec = importlib.util.spec_from_file_location('publisher', SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PlayServer:
    def __init__(self, bundles=(), apks=(), tracks=None, readback=True):
        self.bundles = [{'versionCode': code} for code in bundles]
        self.apks = [{'versionCode': code} for code in apks]
        self.tracks = tracks or []
        self.calls = []
        self.pending = None
        self.committed = False
        self.readback = readback

    def __call__(self, method, path, body=None, content_type=None):
        self.calls.append((method, path, body))
        if method == 'POST' and path == '/edits':
            return {'id': str(len(self.calls))}
        if method == 'DELETE':
            return {}
        if method == 'GET' and path.endswith('/bundles'):
            return {'bundles': self.bundles}
        if method == 'GET' and path.endswith('/apks'):
            return {'apks': self.apks}
        if method == 'GET' and path.endswith('/tracks'):
            return {'tracks': self.tracks}
        if method == 'GET' and '/tracks/' in path:
            target = path.rsplit('/', 1)[1]
            if self.committed and self.readback and self.pending and self.pending['track'] == target:
                return self.pending
            return next((track for track in self.tracks if track['track'] == target), {'track': target, 'releases': []})
        if method == 'POST' and path.endswith('/bundles?uploadType=media'):
            return {'versionCode': 35}
        if method == 'PUT' and '/tracks/' in path:
            self.pending = body
            return body
        if method == 'POST' and ':validate' in path:
            return {}
        if method == 'POST' and ':commit' in path:
            self.committed = True
            return {}
        raise AssertionError((method, path))


def track(name, code, status='completed'):
    return {'track': name, 'releases': [{'status': status, 'versionCodes': [str(code)]}]}


class PublisherTests(unittest.TestCase):
    def test_track_label_matches_android_version_name(self):
        gradle = (SCRIPT.parents[2] / 'android' / 'app' / 'build.gradle').read_text(encoding='utf-8')
        match = re.search(r"\\bversionName\\s+'([^']+)'", gradle)
        self.assertIsNotNone(match, 'Android versionName must remain readable')
        self.assertEqual(publisher.RELEASE_VERSION_NAME, match.group(1))

    def test_allocation_includes_unassigned_bundles_apks_and_draft_tracks(self):
        server = PlayServer(bundles=[9, 32], apks=[34], tracks=[track('internal', 20), track('alpha', 33, 'draft')])
        self.assertEqual(publisher.Publisher(server).allocate_version(), 35)
        self.assertTrue(any(method == 'DELETE' for method, _, _ in server.calls))

    def test_allocation_never_drops_below_release_default(self):
        self.assertEqual(publisher.Publisher(PlayServer()).allocate_version(), 10)

    def test_collision_fails_before_upload_even_when_version_is_only_draft(self):
        server = PlayServer(tracks=[track('alpha', 35, 'draft')])
        with tempfile.NamedTemporaryFile() as bundle:
            with self.assertRaisesRegex(publisher.ReleaseError, 'already used'):
                publisher.Publisher(server).deploy(bundle.name, 35)
        self.assertFalse(any('uploadType' in path for _, path, _ in server.calls))
        self.assertFalse(server.committed)

    def test_upload_commits_and_reads_back_in_new_edit(self):
        server = PlayServer(bundles=[9])
        with tempfile.NamedTemporaryFile() as bundle:
            result = publisher.Publisher(server).deploy(bundle.name, 35)
        self.assertEqual(result['versionCode'], 35)
        self.assertEqual(server.pending['releases'][0]['name'], '0.10.0 (35)')
        self.assertEqual(result['status'], 'api_committed_and_verified')
        self.assertEqual(result['availability'], 'requires_console_check')
        self.assertEqual(sum(method == 'POST' and path == '/edits' for method, path, _ in server.calls), 2)

    def test_failed_readback_is_failure_after_commit(self):
        server = PlayServer(readback=False)
        with tempfile.NamedTemporaryFile() as bundle:
            with self.assertRaisesRegex(publisher.ReleaseError, 'committed.*readback'):
                publisher.Publisher(server).deploy(bundle.name, 35)
        self.assertTrue(server.committed)

    def test_closed_promotion_reuses_internal_code_without_upload(self):
        server = PlayServer(bundles=[35], tracks=[track('internal', 35)])
        result = publisher.Publisher(server).promote(35, 'alpha')
        self.assertEqual(result['track'], 'alpha')
        self.assertFalse(any('uploadType' in path for _, path, _ in server.calls))
        self.assertEqual(server.pending['releases'][0]['versionCodes'], ['35'])

    def test_promotion_requires_exact_completed_internal_version(self):
        for tracks in ([track('internal', 34)], [track('internal', 35, 'draft')]):
            server = PlayServer(bundles=[35], tracks=tracks)
            with self.assertRaisesRegex(publisher.ReleaseError, 'completed internal'):
                publisher.Publisher(server).promote(35, 'alpha')
            self.assertFalse(server.committed)

    def test_production_open_and_arbitrary_tracks_fail_without_api_mutation(self):
        for target in ('production', 'beta', 'open', 'internal', 'custom-closed'):
            server = PlayServer()
            with self.assertRaises(publisher.ReleaseError):
                publisher.Publisher(server).promote(35, target)
            self.assertEqual(server.calls, [])

    def test_bundle_upload_cannot_target_closed_track(self):
        server = PlayServer()
        with self.assertRaises(publisher.ReleaseError):
            publisher.Publisher(server).deploy('unused.aab', 35, 'alpha')
        self.assertEqual(server.calls, [])

    def test_invalid_version_codes_rejected_before_api(self):
        for code in (0, -1, 2100000001, True, '10x'):
            server = PlayServer()
            with self.assertRaises(publisher.ReleaseError):
                publisher.Publisher(server).promote(code, 'alpha')
            self.assertEqual(server.calls, [])

    def test_missing_access_token_fails_without_network(self):
        with self.assertRaisesRegex(publisher.ReleaseError, 'PLAY_ACCESS_TOKEN'):
            publisher.HttpTransport('')

    def test_http_errors_identify_stage_without_exposing_messages(self):
        import io
        import json
        import urllib.error
        secret = 'user-private-key-value'
        payload = {'error': {'status': 'FAILED_PRECONDITION',
                             'message': 'Sensitive: ' + secret,
                             'errors': [{'reason': 'invalidRelease', 'message': secret}]}}
        def fail(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 400, 'Bad Request', {},
                                         io.BytesIO(json.dumps(payload).encode()))
        client = publisher.HttpTransport(secret, opener=fail)
        with self.assertRaises(publisher.ReleaseError) as error:
            client('POST', '/edits/123:validate', {})
        message = str(error.exception)
        self.assertIn('validate_edit HTTP 400', message)
        self.assertIn('status=FAILED_PRECONDITION', message)
        self.assertIn('reason=invalidRelease', message)
        self.assertNotIn(secret, message)
        self.assertNotIn('Sensitive:', message)

    def test_http_errors_ignore_unsafe_reason_and_raw_payload(self):
        import io
        import urllib.error
        secret = 'confidential-token'
        def fail(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 400, secret, {},
                                         io.BytesIO(('{"error":{"status":"BAD\\n' + secret + '"}}').encode()))
        with self.assertRaises(publisher.ReleaseError) as error:
            publisher.HttpTransport(secret, opener=fail)('POST', '/edits/123:commit', {})
        self.assertIn('commit_edit HTTP 400', str(error.exception))
        self.assertNotIn(secret, str(error.exception))

    def test_http_errors_do_not_echo_server_or_credentials(self):
        import io
        import urllib.error
        secret = 'private-token-should-never-appear'
        def fail(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 403, secret, {}, io.BytesIO(secret.encode()))
        with self.assertRaises(publisher.ReleaseError) as error:
            publisher.HttpTransport(secret, opener=fail)('POST', '/edits', {})
        self.assertNotIn(secret, str(error.exception))
        self.assertIn('403', str(error.exception))


if __name__ == '__main__':
    unittest.main()
