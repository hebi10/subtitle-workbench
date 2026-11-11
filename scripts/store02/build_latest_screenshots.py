#!/usr/bin/env python3
"""Build STORE-02 Play images from verified original Android 15 emulator screenshots."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

CAPTURE_SHA = 'a0116043a2187da368c2cae57c6e8976bf023466'
CAPTURE_RUN = 42790689154
W, H = 1080, 1920
SPECS = (
    ('01-video.png','video-light-font100.png','editorial-5a/webview-light-font100/','영상과 음성 파일로 시작','파일 선택부터 자막 생성 준비까지','light'),
    ('02-jobs.png','jobs-dark-font100.png','editorial-5a/webview-dark-font100/','작업 기록을 한눈에','저장된 자막과 작업 상태 관리','dark'),
    ('03-results.png','results-light-font100.png','editorial-5a/webview-light-font100/','원하는 형식으로 저장','SRT · VTT · JSON 내보내기','light'),
    ('04-editor.png','editor-dark-font100.png','editorial-5a/webview-dark-font100/','문장과 시간을 직접 편집','원문 · 번역 · 시간 수정','dark'),
    ('05-settings.png','settings-expanded-light-font100.png','editorial-5a/webview-light-font100/','연결과 언어 설정 관리','개인 API 및 기본 설정 확인','light'),
    ('06-on-device.png','on-device-light.png','editorial-native-3c/editorial-3c/','온디바이스 마이크 자막','기기에서 제공하는 음성 인식 사용','light'),
    ('07-cloud-live.png','cloud-live-dark.png','editorial-native-3c/editorial-3c/','GPT 실시간 마이크 자막','별도 API 연결과 이용 요금이 필요합니다','dark'),
    ('08-vosk-local.png','vosk-local-light.png','editorial-native-3c/editorial-3c/','Vosk 오프라인 로컬 AI','모델 설치 후 기기 내부에서 파일 전사','light'),
)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def locate(root, directory, basename):
    options = [root / directory / basename, root / 'output' / directory / basename]
    matches = [p for p in options if p.is_file()]
    if not matches:
        matches = [p for p in root.rglob(basename) if str(p).replace('\\', '/').endswith(directory + basename)]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one real Android capture for {directory + basename}: {matches}')
    return matches[0]

def font(size, bold=False):
    bases = ('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
             '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc') if bold else (
             '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',)
    path = next((Path(p) for p in bases if Path(p).exists()), None)
    if not path:
        raise FileNotFoundError('Noto Sans CJK font required to render correct Korean captions')
    return ImageFont.truetype(str(path), size)

def render(source, heading, tagline, mode, index):
    with Image.open(source) as img:
        img.verify()
    with Image.open(source) as img:
        if img.format != 'PNG' or img.width < 320 or img.height < 640:
            raise ValueError(f'Invalid original Android PNG: {source}')
        original = img.convert('RGB')
    bg, fg, secondary = ('#141414', '#F2F2F2', '#BDBDBD') if mode == 'dark' else ('#F5F5F5', '#171717', '#555555')
    target = Image.new('RGB', (W, H), bg)
    draw = ImageDraw.Draw(target)
    small = font(27, True)
    title = font(61, True)
    sub = font(33)
    draw.text((72, 66), 'SUBTITLE WORKBENCH', fill=secondary, font=small)
    draw.text((W-160, 65), index, fill=secondary, font=small)
    draw.text((72, 132), heading, fill=fg, font=title)
    draw.text((74, 238), tagline, fill=secondary, font=sub)
    y0, max_width, max_height = 343, 936, 1505
    scale = min(max_width / original.width, max_height / original.height)
    dims = (round(original.width * scale), round(original.height * scale))
    if min(dims) < 300:
        raise ValueError(f'Captured image unreadably small: {source} {dims}')
    scaled = original.resize(dims, Image.Resampling.LANCZOS)
    box_x, box_y = (W - dims[0])//2, y0 + (max_height - dims[1])//2
    target.paste(scaled, (box_x, box_y))
    draw.rectangle((box_x-1, box_y-1, box_x+dims[0], box_y+dims[1]), outline='#888888', width=2)
    return target, {'x': box_x, 'y': box_y, 'width': dims[0], 'height': dims[1]}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--capture-root', required=True, type=Path)
    p.add_argument('--store-root', default=Path('assets/play-store/ko-KR'), type=Path)
    args = p.parse_args()
    root, store = args.capture_root.resolve(), args.store_root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f'Android CI artifact directory not found: {root}')
    manifest_path, provenance_path = store/'manifest.json', store/'capture-provenance-5b.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    existing = {a['file']: a for a in manifest['assets']}
    assert len(SPECS) == 8 and [a[0] for a in SPECS] == manifest['images']['phoneScreenshots']
    assert list(manifest['images']['icon']) == ['icon.png']
    assert list(manifest['images']['featureGraphic']) == ['feature-graphic.png']
    updated, records = [], []
    for ix, (name, basename, directory, heading, tagline, mode) in enumerate(SPECS, start=1):
        source = locate(root, directory, basename)
        source_digest = digest(source.read_bytes())
        image, placement = render(source, heading, tagline, mode, str(ix).zfill(2))
        output = store/name
        image.save(output, format='PNG', optimize=True)
        raw = output.read_bytes()
        record = {
            'file': name, 'heading': heading, 'tagline': tagline,
            'category': 'Android WebView' if ix <= 5 else 'Android native',
            'mode': mode, 'size': len(raw), 'sha256': digest(raw),
            'sourcePath': 'output/' + directory + basename,
            'sourceSHA256': source_digest, 'rendering':
            'Actual Android 15 emulator screenshot, uniformly scaled with no crop or synthetic UI; static caption outside the original screenshot',
            'placement': placement,
        }
        records.append(record)
        original = existing[name]
        updated.append({
            'file': name, 'purpose': original['purpose'], 'width': W, 'height': H,
            'sha256': digest(raw),
            'source': {'type': 'android-15-emulator-screenshot-with-editorial-caption',
                       'stage': 'Editorial Studio 5-A', 'sourceCommit': CAPTURE_SHA,
                       'sourceRunId': CAPTURE_RUN, 'sourcePath': record['sourcePath'],
                       'sourceSHA256': source_digest, 'provenanceFile': provenance_path.name,
                       'export': record['rendering']}
        })
    preserved = [existing[name] for name in (*manifest['images']['icon'], *manifest['images']['featureGraphic'])]
    manifest['assets'] = preserved + updated
    manifest['screenshotCapture'] = {
        'status': 'prepared-for-STORE-03-Play-submission', 'created': '2026-11-11',
        'count': len(SPECS), 'source': 'Actual Android 15 API35 emulator capture, UI equivalent to main 85faa5a',
        'originalSourceCommit': CAPTURE_SHA, 'sourceWorkflowRun': CAPTURE_RUN,
        'provenanceFile': provenance_path.name,
        'note': 'Five live Android WebView screens with deterministic QA data; three live native screens before microphone recording or paid inference. Not a claim of Play publication.',
        'visualReview': {'status': 'automated-source-and-integrity-verified', 'imageCount': 8,
                         'canvas': '1080x1920', 'unchangedCategories': ['icon', 'featureGraphic'],
                         'notes': 'Screenshots uniformly scaled whole-frame; no crop or reconstruction. Visual reviewer confirmation is separate.'}
    }
    provenance = {
        'created': '2026-11-11', 'sourceStage': 'Editorial Studio 5-A',
        'sourceCommit': CAPTURE_SHA, 'sourceWorkflowRun': CAPTURE_RUN,
        'sourceKind': 'Android 15 (API35) emulator actual screenshots: 5 WebView and 3 native',
        'canvas': [W, H], 'phoneScreenshots': records,
        'style': {'bgLight': '#F5F5F5', 'bgDark': '#141414', 'textLight': '#171717',
                  'textDark': '#F2F2F2', 'shadow': False, 'roundedCorners': False,
                  'graphics': 'No generative content or fabricated UI'},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Prepared {len(records)} verified Android screenshots. No Play API requests and no icon or featureGraphic edits.')
    for rec in records:
        print(rec['file'], rec['sha256'], rec['sourceSHA256'])

if __name__ == '__main__':
    main()
