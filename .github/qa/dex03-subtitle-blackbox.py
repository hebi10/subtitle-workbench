import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


PACKAGE = 'com.haebi.subtitle'
FIXTURE = 'dex03-fixture.srt'
CUE = 'DEX03 sample caption'
EVIDENCE = Path('../dex03-evidence')
EVIDENCE.mkdir(exist_ok=True)


def adb(*args, timeout=25, check=True):
    return subprocess.run(['adb', *args], check=check, capture_output=True, timeout=timeout).stdout


def shell(*args, timeout=25, check=True):
    return adb('shell', *args, timeout=timeout, check=check).decode('utf-8', 'replace').strip()


def capture(label):
    (EVIDENCE / f'{label}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    (EVIDENCE / f'{label}.xml').write_bytes(adb('exec-out', 'cat', '/sdcard/dex03-ui.xml', check=False))


def xml():
    remote = '/sdcard/dex03-ui.xml'
    shell('rm', '-f', remote)
    shell('uiautomator', 'dump', remote, timeout=15)
    return ET.fromstring(adb('exec-out', 'cat', remote))


def find(names, timeout=30, swipe=False):
    expressions = [re.compile(name, re.I) for name in names]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            root = xml()
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(1)
            continue
        for node in root.iter('node'):
            keys = [node.get(name, '') for name in ('text', 'content-desc', 'resource-id')]
            if any(expression.search(key) for key in keys for expression in expressions):
                bounds = re.findall(r'\d+', node.get('bounds', ''))
                if len(bounds) == 4:
                    x1, y1, x2, y2 = map(int, bounds)
                    if x2 > x1 and y2 > y1:
                        return (x1 + x2) // 2, (y1 + y2) // 2
        if swipe:
            x, y = map(int, re.findall(r'(\d+)x(\d+)', shell('wm', 'size'))[-1])
            shell('input', 'swipe', str(x // 2), str(y * 72 // 100), str(x // 2), str(y * 34 // 100), '350')
        time.sleep(0.5)
    raise AssertionError(f'UI element unavailable: {names}')


def tap(names, timeout=30, swipe=False):
    x, y = find(names, timeout, swipe)
    shell('input', 'tap', str(x), str(y))


def smoke():
    shell('svc', 'wifi', 'disable')
    assert shell('settings', 'get', 'global', 'wifi_on') == '0'
    apk = 'app/build/outputs/apk/dex03Qa/app-dex03Qa.apk'
    assert b'Success' in adb('install', '-r', apk, timeout=75)
    local = EVIDENCE / FIXTURE
    local.write_text('1\n00:00:01,000 --> 00:00:03,000\n' + CUE + '\n', encoding='utf-8')
    adb('push', str(local), f'/sdcard/Download/{FIXTURE}')
    shell('am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
          '-d', f'file:///sdcard/Download/{FIXTURE}', check=False)
    assert 'Status: ok' in shell('am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    tap([r'^영상 추가$', r'(?:^|:)id/navVideo$', r'^navVideo$'], timeout=65)
    find([r'작업 방식 선택', r'파일에서 자막 만들기', r'사용할 작업 방식'], timeout=40)
    capture('01-webview')
    print('PASS: installed optimized APK launches and renders real WebView navigation', flush=True)
    tap([r'^자막 불러오기$', r'(?:^|:)id/importSubtitles$', r'^importSubtitles$'], swipe=True)
    try:
        tap([rf'^{re.escape(FIXTURE)}$'], timeout=10)
    except AssertionError:
        tap([r'Show roots', r'Open navigation drawer', r'탐색 창 열기', r'(?:^|:)id/toolbar_nav_button'])
        tap([r'^Downloads$', r'^다운로드$'])
        tap([rf'^{re.escape(FIXTURE)}$'])
    find([r'^자막 편집$', r'(?:^|:)id/editorHeading$', r'^editorHeading$'], timeout=40)
    find([rf'{re.escape(CUE)}'], timeout=25, swipe=True)
    capture('02-import-editor')
    print('PASS: Android document picker imports SRT and displays its caption in the WebView editor', flush=True)
    tap([r'^영상 추가$', r'(?:^|:)id/navVideo$', r'^navVideo$'])
    tap([r'독립 로컬 AI · 영상/음성 파일'], timeout=32, swipe=True)
    tap([r'로컬 AI 모델 관리 및 파일 전사', r'(?:^|:)id/openOfflineModel$', r'^openOfflineModel$'], timeout=30, swipe=True)
    find([r'^독립 로컬 AI 자막$', r'선택 모델 다운로드·설치'], timeout=35)
    capture('03-offline-activity')
    print('PASS: native offline transcription entry opens through the WebView bridge', flush=True)


try:
    smoke()
except BaseException:
    capture('failed-ui')
    (EVIDENCE / 'logcat.txt').write_bytes(adb('logcat', '-d', '-t', '1500', check=False))
    raise
