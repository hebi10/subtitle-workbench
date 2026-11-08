#!/usr/bin/env python3
"""Fail closed before release signing or Google authentication."""
import argparse
import base64
import binascii
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys

SIGNING_SECRETS = ('ANDROID_UPLOAD_KEYSTORE_B64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD')


class PreflightError(RuntimeError):
    pass


def validate_signing(env):
    missing = [name for name in SIGNING_SECRETS + ('ANDROID_UPLOAD_CERT_SHA256',) if not env.get(name, '').strip()]
    if missing:
        raise PreflightError('Missing signing configuration: ' + ', '.join(missing))
    fingerprint = env['ANDROID_UPLOAD_CERT_SHA256'].replace(':', '').lower()
    if not re.fullmatch(r'[a-f0-9]{64}', fingerprint):
        raise PreflightError('ANDROID_UPLOAD_CERT_SHA256 must match the original upload certificate SHA-256')
    return fingerprint


def auth_mode(env):
    provider = env.get('PLAY_WORKLOAD_IDENTITY_PROVIDER', '').strip()
    account = env.get('PLAY_SERVICE_ACCOUNT', '').strip()
    if provider or account:
        if not provider or not account:
            raise PreflightError('Both PLAY_WORKLOAD_IDENTITY_PROVIDER and PLAY_SERVICE_ACCOUNT are required for WIF')
        return 'wif'
    if env.get('PLAY_SERVICE_ACCOUNT_JSON', '').strip():
        return 'json'
    raise PreflightError('Play authentication is missing; configure WIF variables or PLAY_SERVICE_ACCOUNT_JSON')


def command_output(args):
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode:
        raise PreflightError('Upload certificate or signed bundle verification failed')
    return result.stdout


def prepare_signing(env):
    expected = validate_signing(env)
    directory = Path(env['RUNNER_TEMP'])
    target = directory / 'subtitle-upload-keystore.jks'
    try:
        decoded = base64.b64decode(''.join(env['ANDROID_UPLOAD_KEYSTORE_B64'].split()), validate=True)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(decoded)
        certificate = command_output(['keytool', '-exportcert', '-keystore', str(target), '-alias', env['ANDROID_KEY_ALIAS'],
                                      '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'])
        if hashlib.sha256(certificate).hexdigest() != expected:
            raise PreflightError('Signing key does not match ANDROID_UPLOAD_CERT_SHA256; original upload key is required')
    except (binascii.Error, OSError):
        target.unlink(missing_ok=True)
        raise PreflightError('Signing material could not be decoded or opened') from None
    except PreflightError:
        target.unlink(missing_ok=True)
        raise
    with open(env['GITHUB_ENV'], 'a', encoding='utf-8') as output:
        output.write(f'ANDROID_KEYSTORE_PATH={target}\n')


def verify_bundle(path, expected):
    expected = expected.replace(':', '').lower()
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise PreflightError('Original upload certificate fingerprint is required')
    command_output(['jarsigner', '-verify', str(path)])
    pem = command_output(['keytool', '-printcert', '-jarfile', str(path), '-rfc'])
    matches = re.findall(rb'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', pem, re.S)
    hashes = {hashlib.sha256(base64.b64decode(value)).hexdigest() for value in matches}
    if expected not in hashes:
        raise PreflightError('Signed AAB certificate does not match the original upload certificate')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['auth', 'signing', 'verify-bundle'])
    parser.add_argument('--bundle', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'auth':
            mode = auth_mode(os.environ)
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                output.write(f'auth_mode={mode}\n')
            print('Play authentication configuration present: ' + mode)
        elif args.command == 'signing':
            prepare_signing(os.environ)
            print('Original upload certificate verified')
        else:
            if not args.bundle:
                raise PreflightError('--bundle is required')
            verify_bundle(args.bundle, os.environ.get('ANDROID_UPLOAD_CERT_SHA256', ''))
            print('AAB signature verified against original upload certificate')
        return 0
    except (PreflightError, KeyError, OSError) as error:
        message = str(error) if isinstance(error, PreflightError) else 'Required release environment is missing'
        print('Release preflight failed: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
