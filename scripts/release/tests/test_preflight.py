import importlib.util
import pathlib
import unittest

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


if __name__ == '__main__':
    unittest.main()
