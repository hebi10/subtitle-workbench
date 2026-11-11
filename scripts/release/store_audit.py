#!/usr/bin/env python3
"""Audit committed Play listing hashes and release tracks; never commit a Play edit."""
import argparse
import json
import os
from pathlib import Path
import sys

from publisher import HttpTransport, PACKAGE, Publisher, ReleaseError


def expected_files(manifest):
    images = manifest.get('images', {})
    files = {entry['file']: entry['sha256'].lower() for entry in manifest.get('assets', [])}
    required = {'icon': 1, 'featureGraphic': 1, 'phoneScreenshots': 8}
    if set(images) != set(required) or any(len(images[category]) != count for category, count in required.items()):
        raise ReleaseError('STORE-04 requires exactly one icon, one feature graphic and eight phone screenshots')
    if any(name not in files for names in images.values() for name in names):
        raise ReleaseError('STORE-04 manifest lacks required image SHA-256')
    return {category: [files[name] for name in images[category]] for category in required}


def audit(client, manifest, listing, expected_internal_code=22):
    expected = expected_files(manifest)
    if manifest.get('language') != 'ko-KR' or listing.get('language') != 'ko-KR':
        raise ReleaseError('STORE-04 may audit only ko-KR')
    if not isinstance(expected_internal_code, int) or expected_internal_code < 1:
        raise ReleaseError('Invalid expected internal version code')
    with client.edit() as edit:
        remote_listing = client.request('GET', edit + '/listings/ko-KR')
        if not isinstance(remote_listing, dict):
            raise ReleaseError('Invalid Play listing readback')
        texts = {name: remote_listing.get(name) == listing.get(name)
                 for name in ('title', 'shortDescription', 'fullDescription')}
        images = {}
        for category, expected_hashes in expected.items():
            remote = client.request('GET', edit + '/listings/ko-KR/' + category).get('images', [])
            if not isinstance(remote, list):
                raise ReleaseError('Invalid Play image response for ' + category)
            actual_hashes = [item.get('sha256', '').lower() for item in remote]
            images[category] = {
                'count': len(remote), 'expectedCount': len(expected_hashes),
                'hashesAvailable': all(len(h) == 64 for h in actual_hashes),
                'matchesRepositoryAssets': actual_hashes == expected_hashes,
                'actualSha256': actual_hashes,
                'expectedSha256': expected_hashes,
            }
        tracks = client.request('GET', edit + '/tracks').get('tracks', [])
        if not isinstance(tracks, list):
            raise ReleaseError('Invalid Play tracks readback')
        internal = next((t for t in tracks if t.get('track') == 'internal'), None)
        closed = next((t for t in tracks if t.get('track') == 'alpha'), None)
        def release_summary(track):
            if track is None:
                return {'exists': False, 'releases': []}
            return {'exists': True, 'releases': [
                {'status': release.get('status'), 'versionCodes': [str(v) for v in release.get('versionCodes', [])]}
                for release in track.get('releases', [])
            ]}
        internal_summary = release_summary(internal)
        closed_summary = release_summary(closed)
    internal_22 = any(
        str(expected_internal_code) in release['versionCodes'] and release['status'] == 'completed'
        for release in internal_summary['releases']
    )
    screenshots_match = images['phoneScreenshots']['matchesRepositoryAssets']
    images_all_match = all(item['matchesRepositoryAssets'] for item in images.values())
    texts_match = all(texts.values())
    return {
        'package': PACKAGE, 'language': 'ko-KR',
        'status': 'api_listing_matches_repository' if images_all_match and texts_match else 'api_listing_differs_from_repository',
        'availability': 'requires_play_console_review_and_visibility_check',
        'readOnly': True, 'playEditCommitted': False,
        'expectedInternalVersionCode': expected_internal_code,
        'internalVersionCompleted': internal_22,
        'images': images, 'listingTextMatches': texts,
        'internalTrack': internal_summary, 'closedTrack': closed_summary,
        'screenshotsMatch': screenshots_match,
        'allRepositoryAssetsMatch': images_all_match,
        'reviewState': 'not_available_from_edits_api',
        'note': 'Android Publisher edits API shows committed listing/release data, not Play Console review or actual tester visibility.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path('assets/play-store/ko-KR/manifest.json'))
    parser.add_argument('--listing', type=Path, default=Path('docs/play-store/listing-ko.json'))
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--internal-version-code', type=int, default=22)
    args = parser.parse_args()
    report = {'package': PACKAGE, 'language': 'ko-KR',
              'status': 'audit_not_completed', 'readOnly': True, 'playEditCommitted': False}
    try:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
        listing = json.loads(args.listing.read_text(encoding='utf-8'))
        report = audit(Publisher(HttpTransport(os.environ.get('PLAY_ACCESS_TOKEN', ''))),
                       manifest, listing, args.internal_version_code)
        report['sourceSha'] = os.environ.get('SOURCE_SHA', '')
        report['workflowRunId'] = os.environ.get('GITHUB_RUN_ID', '')
        if report['status'] != 'api_listing_matches_repository' or not report['internalVersionCompleted']:
            print('STORE-04 Play API readback completed, but not all expected assets and internal release match')
            return_code = 2
        else:
            print('STORE-04 Play API assets and internal test release match; Console review state still unknown')
            return_code = 0
    except (ReleaseError, KeyError, OSError, TypeError, ValueError) as error:
        report['status'] = 'audit_failed'
        report['error'] = str(error) if isinstance(error, ReleaseError) else 'Invalid audit input or Play API response'
        print('STORE-04 Play audit failed: ' + report['error'], file=sys.stderr)
        return_code = 1
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return return_code


if __name__ == '__main__':
    sys.exit(main())
