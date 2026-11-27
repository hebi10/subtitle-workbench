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
    root = ET.fromstring(adb('exec-out', 'cat', remote))
    nodes = list(root.iter('node'))
    launcher_anr = any(node.get('package') == 'android'
                       and node.get('text') == "Pixel Launcher isn't responding" for node in nodes)
    if launcher_anr:
        close = next(node for node in nodes if node.get('package') == 'android'
                     and node.get('resource-id') == 'android:id/aerr_close')
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', close.get('bounds', '')))
        shell('input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
        print('Closed the explicitly allowlisted Pixel Launcher system ANR', flush=True)
        time.sleep(0.7)
        raise ET.ParseError('Needs fresh hierarchy after the system dialog closed')
    return root


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
    shell('cmd', 'connectivity', 'airplane-mode', 'enable')
    assert shell('settings', 'get', 'global', 'airplane_mode_on') == '1'
    assert 'Status: ok' in shell('am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    tap([r'^영상 추가$', r'(?:^|:)id/navVideo$', r'^navVideo$'], timeout=65)
    tap([r'^오프라인 AI 모델 설치 후', r'(?:^|:)id/(guideOffline|chooseOffline)$', r'^(guideOffline|chooseOffline)$'], timeout=45)
    find([r'로컬 AI 모델 관리 및 파일 전사'], timeout=30, swipe=True)
    capture('03-offline-disclosure')
    tap([r'로컬 AI 모델 관리 및 파일 전사', r'(?:^|:)id/openOfflineModel$', r'^openOfflineModel$'], timeout=30, swipe=True)
    find([r'^독립 로컬 AI 자막$', r'선택 모델 다운로드·설치'], timeout=35)
    state = shell('dumpsys', 'activity', 'activities')
    assert any('ResumedActivity' in line and '.OfflineVoskActivity' in line for line in state.splitlines())
    find([r'영상·오디오 파일 선택'], timeout=25, swipe=True)
    capture('04-native-offline-activity')
    print('PASS: native offline transcription entry opens through the WebView bridge', flush=True)


try:
    smoke()
except BaseException:
    capture('failed-ui')
    (EVIDENCE / 'logcat.txt').write_bytes(adb('logcat', '-d', '-t', '1500', check=False))
    raise
