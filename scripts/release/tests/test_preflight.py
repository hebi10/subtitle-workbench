import importlib.util
import pathlib
import unittest
import io
from email.message import Message
from urllib.error import HTTPError, URLError

SCRIPT = pathlib.Path(__file__).parents[1] / 'preflight.py'
spec = importlib.util.spec_from_file_location('preflight', SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def test_missing_signing_configuration_fails_and_hides_values(self):
        with self.assertRaisesRegex(preflight.PreflightError, 'ANDROID_UPLOAD_KEYSTORE_B64'):
            preflight.validate_signing({})

    def test_existing_four_signing_secrets_still_require_original_certificate(self):
        env = {name: 'secret' for name in preflight.SIGNING_SECRETS}
        with self.assertRaisesRegex(preflight.PreflightError, 'ANDROID_UPLOAD_CERT_SHA256'):
            preflight.validate_signing(env)

    def test_fingerprint_requires_sha256_hex(self):
        env = {name: 'secret' for name in preflight.SIGNING_SECRETS}
        env['ANDROID_UPLOAD_CERT_SHA256'] = 'new-key-please'
        with self.assertRaises(preflight.PreflightError):
            preflight.validate_signing(env)

    def test_auth_prefers_complete_wif_even_if_json_also_exists(self):
        self.assertEqual(preflight.auth_mode({'PLAY_WORKLOAD_IDENTITY_PROVIDER': 'provider', 'PLAY_SERVICE_ACCOUNT': 'account',
                                               'PLAY_SERVICE_ACCOUNT_JSON': 'json'}), 'wif')

    def test_partial_wif_fails_instead_of_using_legacy_json(self):
        with self.assertRaises(preflight.PreflightError):
            preflight.auth_mode({'PLAY_WORKLOAD_IDENTITY_PROVIDER': 'provider', 'PLAY_SERVICE_ACCOUNT_JSON': 'json'})

    def test_missing_auth_fails(self):
        with self.assertRaises(preflight.PreflightError):
            preflight.auth_mode({})

    def test_json_fallback_supported(self):
        self.assertEqual(preflight.auth_mode({'PLAY_SERVICE_ACCOUNT_JSON': 'json'}), 'json')

    def test_production_monetization_accepts_valid_values(self):
        env = {
            'SW_ADMOB_APP_ID': 'ca-app-pub-1234567890123456~1234567890',
            'SW_ADMOB_BANNER_ID': 'ca-app-pub-1234567890123456/1234567890',
            'SW_BILLING_VERIFIER_URL': 'https://billing.example.org',
            'SW_BILLING_CLOUD_PROJECT': '1234567890',
        }
        self.assertEqual(preflight.validate_monetization(env), env['SW_BILLING_VERIFIER_URL'])
        for name, bad in [
            ('SW_ADMOB_APP_ID', 'ca-app-pub-3940256099942544~3347511713'),
            ('SW_ADMOB_BANNER_ID', 'ca-app-pub-3940256099942544/9214589741'),
            ('SW_BILLING_VERIFIER_URL', 'http://not-production.example.org'),
            ('SW_BILLING_VERIFIER_URL', 'https://billing.example.org/path'),
            ('SW_BILLING_CLOUD_PROJECT', '0'),
            ('SW_BILLING_CLOUD_PROJECT', ''),
        ]:
            with self.subTest(name=name):
                with self.assertRaises(preflight.PreflightError) as error:
                    preflight.validate_monetization({**env, name: bad})
                self.assertIn(name, str(error.exception))
                if bad:
                    self.assertNotIn(bad, str(error.exception))

    def test_missing_variables_list_all_names_without_values(self):
        with self.assertRaises(preflight.PreflightError) as error:
            preflight.validate_monetization({})
        for name in ('SW_ADMOB_APP_ID', 'SW_ADMOB_BANNER_ID',
                     'SW_BILLING_VERIFIER_URL', 'SW_BILLING_CLOUD_PROJECT'):
            self.assertIn(name, str(error.exception))

    def test_billing_route_probe_is_unauthenticated_and_fails_closed(self):
        class Fake:
            def __init__(self, code, body=b'{}', cache='no-store'):
                self.code, self.body, self.cache = code, body, cache

            def open(self, req, timeout):
                assert req.get_method() == 'POST' and req.data == b'{}'
                assert req.get_header('Authorization') is None and timeout == 10
                headers = Message()
                headers['cache-control'] = self.cache
                raise HTTPError(req.full_url, self.code, 'not logged', headers, io.BytesIO(self.body))

        preflight.probe_billing('https://billing.example.org', Fake(400))
        for fake in (Fake(302), Fake(503), Fake(400, b'<html>'), Fake(400, cache='')):
            with self.assertRaises(preflight.PreflightError):
                preflight.probe_billing('https://billing.example.org', fake)

    def test_probe_never_follows_redirect(self):
        self.assertIsNone(preflight.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example.org'))


if __name__ == '__main__':
    unittest.main()
