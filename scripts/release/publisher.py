#!/usr/bin/env python3
"""Restricted Google Play test-track publisher. Uses only Python's standard library."""
import argparse
import contextlib
import hashlib
import json
import os
import re
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

PACKAGE = 'com.haebi.subtitle'
RELEASE_VERSION_NAME = '0.10.0'
API = 'https://androidpublisher.googleapis.com'
BASE = f'/androidpublisher/v3/applications/{PACKAGE}'
MIN_VERSION = 10
MAX_VERSION = 2100000000


class ReleaseError(RuntimeError):
    pass


def version_code(value):
    if isinstance(value, bool) or not str(value).isascii() or not str(value).isdigit():
        raise ReleaseError('versionCode must be a positive integer')
    code = int(value)
    if not 1 <= code <= MAX_VERSION:
        raise ReleaseError('versionCode outside Android supported range')
    return code


class HttpTransport:
    def __init__(self, token, opener=urllib.request.urlopen):
        if not token or not token.strip():
            raise ReleaseError('PLAY_ACCESS_TOKEN is required; deployment was not attempted')
        self.token = token
        self.opener = opener

    def __call__(self, method, path, body=None, content_type=None):
        if not path.startswith('/edits') or '\n' in path:
            raise ReleaseError('Unsupported Play API path')
        upload = content_type is not None
        url = API + ('/upload' if upload else '') + BASE + path
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        headers = {'Authorization': 'Bearer ' + self.token}
        if data is not None:
            headers['Content-Type'] = content_type or 'application/json; charset=utf-8'
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener(request, timeout=300 if upload else 60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            # Never print raw Play messages, request URLs, or credentials.
            if path == '/edits':
                stage = 'create_edit'
            elif path.endswith(':validate'):
                stage = 'validate_edit'
            elif ':commit' in path:
                stage = 'commit_edit'
            elif '/tracks/' in path and method == 'PUT':
                stage = 'update_track'
            elif '/tracks/' in path:
                stage = 'read_track'
            elif '/bundles' in path:
                stage = 'bundle_request'
            else:
                stage = 'other_edit_request'
            detail = []
            try:
                payload = json.loads(error.read(32768))
                problem = payload.get('error', {})
                if isinstance(problem, dict):
                    status = problem.get('status')
                    if isinstance(status, str) and re.fullmatch(r'[A-Z_]{1,64}', status):
                        detail.append('status=' + status)
                    errors = problem.get('errors', [])
                    if isinstance(errors, list):
                        for item in errors[:3]:
                            reason = item.get('reason') if isinstance(item, dict) else None
                            if isinstance(reason, str) and re.fullmatch(r'[A-Za-z0-9_]{1,64}', reason):
                                detail.append('reason=' + reason)
            except (ValueError, TypeError, AttributeError, OSError):
                pass
            suffix = (' (' + ', '.join(dict.fromkeys(detail)) + ')') if detail else ''
            raise ReleaseError(f'Play API {stage} HTTP {error.code}{suffix}; inspect Console for full validation details') from None
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise ReleaseError('Play API request or response failed; no successful deployment can be claimed') from None


class Publisher:
    def __init__(self, transport):
        self.request = transport

    @contextlib.contextmanager
    def edit(self):
        edit_id = self.request('POST', '/edits', {})['id']
        if not str(edit_id).isalnum():
            raise ReleaseError('Invalid edit id from Play')
        path = '/edits/' + str(edit_id)
        try:
            yield path
        finally:
            try:
                self.request('DELETE', path)
            except ReleaseError:
                pass  # A committed edit no longer exists; do not hide the original failure.

    def used_versions(self, edit):
        bundles = self.request('GET', edit + '/bundles').get('bundles', [])
        apks = self.request('GET', edit + '/apks').get('apks', [])
        tracks = self.request('GET', edit + '/tracks').get('tracks', [])
        values = [item['versionCode'] for item in bundles + apks]
        for track in tracks:
            for release in track.get('releases', []):
                values.extend(release.get('versionCodes', []))
        return {version_code(value) for value in values}

    def allocate_version(self):
        with self.edit() as edit:
            code = max(self.used_versions(edit) | {MIN_VERSION - 1}) + 1
            return version_code(code)

    def commit(self, edit, changes_not_sent_for_review=False):
        self.request('POST', edit + ':validate', {})
        query = '?changesNotSentForReview=true' if changes_not_sent_for_review else ''
        self.request('POST', edit + ':commit' + query, {})

    def verify_track(self, track, code, status):
        try:
            with self.edit() as edit:
                result = self.request('GET', edit + '/tracks/' + track)
                if not any(release.get('status') == status and str(code) in [str(value) for value in release.get('versionCodes', [])]
                           for release in result.get('releases', [])):
                    raise ReleaseError('release absent')
        except ReleaseError:
            raise ReleaseError('Play edit committed but fresh readback failed; inspect Console before retrying') from None
        return {'package': PACKAGE, 'track': track, 'versionCode': code,
                'releaseStatus': status, 'status': 'api_committed_and_verified',
                'availability': 'requires_console_check'}

    def deploy(self, bundle, code, track='internal', release_status='completed', changes_not_sent_for_review=False):
        if track != 'internal':
            raise ReleaseError('New bundles may only be deployed to internal')
        if release_status not in ('draft', 'completed'):
            raise ReleaseError('Only draft or completed test releases are supported')
        code = version_code(code)
        with self.edit() as edit:
            if code in self.used_versions(edit):
                raise ReleaseError(f'versionCode {code} is already used; allocate a fresh version before building')
            uploaded = self.request('POST', edit + '/bundles?uploadType=media', Path(bundle).read_bytes(), 'application/octet-stream')
            if version_code(uploaded['versionCode']) != code:
                raise ReleaseError('Uploaded bundle versionCode does not match the allocated version')
            self.request('PUT', edit + '/tracks/internal', {'track': 'internal', 'releases': [
                {'name': f'{RELEASE_VERSION_NAME} ({code})', 'versionCodes': [str(code)], 'status': release_status}]})
            self.commit(edit, changes_not_sent_for_review)
        return self.verify_track(track, code, release_status)

    def promote(self, code, track='alpha', changes_not_sent_for_review=False):
        if track != 'alpha':
            raise ReleaseError('Only the alpha closed-testing track is permitted for promotion')
        code = version_code(code)
        with self.edit() as edit:
            source = self.request('GET', edit + '/tracks/internal')
            release = next((release for release in source.get('releases', [])
                            if release.get('status') == 'completed' and str(code) in [str(value) for value in release.get('versionCodes', [])]), None)
            if release is None:
                raise ReleaseError('The exact versionCode must exist in a completed internal release')
            if code not in self.used_versions(edit):
                raise ReleaseError('Requested uploaded versionCode was not found')
            promoted = {'name': release.get('name', f'{RELEASE_VERSION_NAME} ({code})'), 'versionCodes': [str(code)], 'status': 'completed'}
            if release.get('releaseNotes'):
                promoted['releaseNotes'] = release['releaseNotes']
            self.request('PUT', edit + '/tracks/alpha', {'track': 'alpha', 'releases': [promoted]})
            self.commit(edit, changes_not_sent_for_review)
        return self.verify_track(track, code, 'completed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('allocate')
    deploy = sub.add_parser('deploy')
    deploy.add_argument('--bundle', required=True)
    deploy.add_argument('--version-code', required=True, type=version_code)
    deploy.add_argument('--status', choices=['completed', 'draft'], default='completed')
    deploy.add_argument('--changes-not-sent-for-review', action='store_true')
    promote = sub.add_parser('promote')
    promote.add_argument('--version-code', required=True, type=version_code)
    promote.add_argument('--track', choices=['alpha'], default='alpha')
    promote.add_argument('--changes-not-sent-for-review', action='store_true')
    args = parser.parse_args()
    try:
        client = Publisher(HttpTransport(os.environ.get('PLAY_ACCESS_TOKEN', '')))
        if args.command == 'allocate':
            code = client.allocate_version()
            result = {'package': PACKAGE, 'versionCode': code, 'status': 'version_allocated_not_uploaded'}
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                    output.write(f'version_code={code}\n')
        elif args.command == 'deploy':
            result = client.deploy(args.bundle, args.version_code, release_status=args.status,
                                   changes_not_sent_for_review=args.changes_not_sent_for_review)
        else:
            result = client.promote(args.version_code, args.track, args.changes_not_sent_for_review)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ReleaseError, KeyError, OSError) as error:
        message = str(error) if isinstance(error, ReleaseError) else 'Release input or API response is invalid'
        print('Release failed: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
