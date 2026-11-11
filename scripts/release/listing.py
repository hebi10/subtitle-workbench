#!/usr/bin/env python3
"""Validate or submit the reviewed ko-KR store listing and its explicit PNG assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys

from publisher import HttpTransport, PACKAGE, Publisher, ReleaseError

CATEGORIES = {'icon', 'featureGraphic', 'phoneScreenshots'}
FIELDS = {'title': 30, 'shortDescription': 80, 'fullDescription': 4000}


def load_inputs(listing_path, manifest_path):
    text = json.loads(Path(listing_path).read_text(encoding='utf-8'))
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if text.get('language') != 'ko-KR' or manifest.get('language') != 'ko-KR':
        raise ReleaseError('Only the reviewed ko-KR listing is supported')
    for field, limit in FIELDS.items():
        if not isinstance(text.get(field), str) or not text[field].strip() or len(text[field]) > limit:
            raise ReleaseError(f'Listing {field} must contain 1–{limit} characters')
    images = manifest.get('images', {})
    if set(images) != CATEGORIES:
        raise ReleaseError('Manifest must explicitly contain icon, featureGraphic and phoneScreenshots')
    manifest_hashes = {
        item['file']: item['sha256'].lower()
        for item in manifest.get('assets', [])
        if isinstance(item, dict) and isinstance(item.get('file'), str)
        and isinstance(item.get('sha256'), str)
    }
    prepared = {}
    for kind, names in images.items():
        if not isinstance(names, list) or (len(names) != 1 if kind != 'phoneScreenshots' else not 2 <= len(names) <= 8):
            raise ReleaseError('Manifest image counts are invalid')
        prepared[kind] = []
        for name in names:
            if not isinstance(name, str):
                raise ReleaseError('Manifest image names must be relative strings')
            target = (manifest_path.parent / name).resolve()
            if not target.is_relative_to(manifest_path.parent):
                raise ReleaseError('Every asset must remain inside the manifest directory')
            raw = target.read_bytes()
            if len(raw) < 24 or raw[:8] != b'\x89PNG\r\n\x1a\n' or raw[12:16] != b'IHDR':
                raise ReleaseError('Store assets must be PNG images')
            width, height = struct.unpack('>II', raw[16:24])
            valid = (width, height) == ((512, 512) if kind == 'icon' else (1024, 500))
            if kind == 'phoneScreenshots':
                valid = 320 <= min(width, height) and max(width, height) <= 3840 and max(width, height) <= 2 * min(width, height)
            if not valid or len(raw) > 8 * 1024 * 1024:
                raise ReleaseError('Store image dimensions or file size are outside the supported Play bounds')
            sha256 = hashlib.sha256(raw).hexdigest()
            if manifest_hashes and manifest_hashes.get(name) != sha256:
                raise ReleaseError('Manifest SHA-256 mismatch for ' + name)
            prepared[kind].append({'data': raw, 'sha256': sha256, 'name': name})
    return {'listing': {key: text[key] for key in ('language', *FIELDS)}, 'images': prepared}


def apply(client, plan, changes_not_sent_for_review=True):
    with client.edit() as edit:
        client.request('PUT', edit + '/listings/ko-KR', plan['listing'])
        for kind, items in plan['images'].items():
            path = edit + '/listings/ko-KR/' + kind
            client.request('DELETE', path)
            for item in items:
                client.request('POST', path + '?uploadType=media', item['data'], 'image/png')
        client.commit(edit, changes_not_sent_for_review)
    try:
        with client.edit() as edit:
            actual = client.request('GET', edit + '/listings/ko-KR')
            if any(actual.get(key) != value for key, value in plan['listing'].items()):
                raise ReleaseError('Listing text mismatch')
            for kind, items in plan['images'].items():
                actual_images = client.request('GET', edit + '/listings/ko-KR/' + kind).get('images', [])
                if [item.get('sha256', '').lower() for item in actual_images] != [item['sha256'] for item in items]:
                    raise ReleaseError('Listing image readback mismatch')
    except ReleaseError:
        raise ReleaseError('Listing edit committed but fresh readback failed; inspect Console before retrying') from None
    return {'package': PACKAGE, 'language': 'ko-KR', 'status': 'api_committed_and_verified',
            'availability': 'requires_console_check', 'changesNotSentForReview': changes_not_sent_for_review,
            'imageCounts': {kind: len(items) for kind, items in plan['images'].items()}}




def apply_phone_screenshots(client, plan, changes_not_sent_for_review=True):
    """Replace only the reviewed phone screenshots; preserve all other Play listing fields."""
    prepared = plan['images']['phoneScreenshots']
    listing_path = '/listings/ko-KR'
    protected = ('icon', 'featureGraphic')
    with client.edit() as edit:
        previous_listing = client.request('GET', edit + listing_path)
        previous_protected = {
            kind: [image.get('sha256', '').lower()
                   for image in client.request('GET', edit + listing_path + '/' + kind).get('images', [])]
            for kind in protected
        }
        target = edit + listing_path + '/phoneScreenshots'
        before_screenshots = [
            image.get('sha256', '').lower()
            for image in client.request('GET', target).get('images', [])
        ]
        desired_screenshots = [image['sha256'] for image in prepared]
        if before_screenshots == desired_screenshots:
            return {'package': PACKAGE, 'language': 'ko-KR', 'status': 'already_matching_no_write',
                    'availability': 'requires_console_check', 'changesNotSentForReview': None,
                    'imageCounts': {'phoneScreenshots': len(prepared)},
                    'preserved': ['title', 'shortDescription', 'fullDescription', 'icon', 'featureGraphic']}
        client.request('DELETE', target)
        for item in prepared:
            uploaded = client.request('POST', target + '?uploadType=media', item['data'], 'image/png')
            server_sha = uploaded.get('image', {}).get('sha256', '').lower()
            if server_sha and server_sha != item['sha256']:
                raise ReleaseError('Play screenshot upload hash mismatch; edit was not committed')
        client.commit(edit, changes_not_sent_for_review)
    try:
        with client.edit() as edit:
            actual = client.request('GET', edit + listing_path + '/phoneScreenshots').get('images', [])
            if [image.get('sha256', '').lower() for image in actual] != [item['sha256'] for item in prepared]:
                raise ReleaseError('Phone screenshot image hash mismatch')
            if client.request('GET', edit + listing_path) != previous_listing:
                raise ReleaseError('Non-screenshot listing text changed')
            for kind, before in previous_protected.items():
                after = [image.get('sha256', '').lower()
                         for image in client.request('GET', edit + listing_path + '/' + kind).get('images', [])]
                if after != before:
                    raise ReleaseError('Protected listing image category changed: ' + kind)
    except ReleaseError:
        raise ReleaseError('Phone screenshot edit committed but fresh readback failed; inspect Console before retrying') from None
    return {'package': PACKAGE, 'language': 'ko-KR', 'status': 'api_committed_and_verified',
            'availability': 'requires_console_check', 'changesNotSentForReview': changes_not_sent_for_review,
            'imageCounts': {'phoneScreenshots': len(prepared)},
            'preserved': ['title', 'shortDescription', 'fullDescription', 'icon', 'featureGraphic']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'apply'])
    parser.add_argument('--listing', type=Path, default=Path('docs/play-store/listing-ko.json'))
    parser.add_argument('--manifest', type=Path, default=Path('assets/play-store/ko-KR/manifest.json'))
    parser.add_argument('--report', type=Path)
    parser.add_argument('--send-for-review', action='store_true')
    parser.add_argument('--phone-only', action='store_true', help='Only upload phone screenshots, preserving text/icon/feature graphic')
    parser.add_argument('--require-eight-screenshots', action='store_true',
                        help='STORE-03 gate: reject any image set other than eight screenshots')
    args = parser.parse_args()
    try:
        plan = load_inputs(args.listing, args.manifest)
        if args.require_eight_screenshots and (not args.phone_only or len(plan['images']['phoneScreenshots']) != 8):
            raise ReleaseError('STORE-03 requires exactly eight phone screenshots and --phone-only')
        result = {'package': PACKAGE, 'language': 'ko-KR', 'status': 'validated_not_submitted',
                  'imageCounts': {kind: len(items) for kind, items in plan['images'].items()}}
        if args.mode == 'apply':
            client = Publisher(HttpTransport(os.environ.get('PLAY_ACCESS_TOKEN', '')))
            result = (apply_phone_screenshots(client, plan, changes_not_sent_for_review=not args.send_for_review)
                      if args.phone_only else apply(client, plan, changes_not_sent_for_review=not args.send_for_review))
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ReleaseError, OSError, ValueError, KeyError) as error:
        message = str(error) if isinstance(error, ReleaseError) else 'Listing input or API response is invalid'
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps({
                'package': PACKAGE, 'language': 'ko-KR', 'status': 'failed',
                'operation': 'phoneScreenshots' if args.phone_only else 'listing',
                'error': message
            }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('Listing failed: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
