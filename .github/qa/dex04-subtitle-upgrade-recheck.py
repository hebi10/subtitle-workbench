import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


PACKAGE = 'com.haebi.subtitle'
FIXTURE = 'dex04-fixture.srt'
CUE = 'DEX04 saved subtitle'
EVIDENCE = Path('../dex04-evidence')
EVIDENCE.mkdir(exist_ok=True)


def adb(*args, timeout=25, check=True):
    return subprocess.run(['adb', *args], check=check, capture_output=True, timeout=timeout).stdout


def shell(*args, timeout=25, check=True):
    return adb('shell', *args, timeout=timeout, check=check).decode('utf-8', 'replace').strip()


def capture(label):
    (EVIDENCE / f'{label}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    (EVIDENCE / f'{label}.xml').write_bytes(adb('exec-out', 'cat', '/sdcard/dex04-ui.xml', check=False))


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
        print('Closed the explicitly allowlisted Pixel Launcher system dialog', flush=True)
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
        nodes = list(root.iter('node'))
        navbar = next((n for n in nodes if n.get('text') == '주 메뉴'), None)
        nav_bounds = re.findall(r'\d+', navbar.get('bounds', '')) if navbar is not None else []
        top = int(nav_bounds[1]) if len(nav_bounds) == 4 else 0
        nav_labels = {'영상 추가', '작업', '결과', '설정', '주 메뉴'}
        for node in nodes:
            keys = [node.get(name, '') for name in ('text', 'content-desc', 'resource-id')]
            if any(expression.search(key) for key in keys for expression in expressions):
                bounds = re.findall(r'\d+', node.get('bounds', ''))
                if len(bounds) == 4:
                    x1, y1, x2, y2 = map(int, bounds)
                    if top and node.get('text') not in nav_labels and y1 < top:
                        y2 = min(y2, top - 1)
                    elif top and node.get('text') not in nav_labels and y1 >= top:
                        continue
                    if x2 > x1 and y2 > y1:
                        return (x1 + x2) // 2, (y1 + y2) // 2
        if swipe:
            x, y = map(int, re.findall(r'(\d+)x(\d+)', shell('wm', 'size'))[-1])
            shell('input', 'swipe', str(x // 2), str(y * 68 // 100), str(x // 2), str(y * 35 // 100), '350')
        time.sleep(0.5)
    raise AssertionError(f'UI element unavailable: {names}')


def tap(names, timeout=30, swipe=False):
    x, y = find(names, timeout, swipe)
    shell('input', 'tap', str(x), str(y))


def launch():
    assert 'Status: ok' in shell('am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    find([r'^작업$', r'^영상 추가$'], timeout=65)


def install(apk):
    assert b'Success' in adb('install', '-r', apk, timeout=75)


def import_fixture():
    local = EVIDENCE / FIXTURE
    local.write_text('1\n00:00:01,000 --> 00:00:03,000\n' + CUE + '\n', encoding='utf-8')
    adb('push', str(local), f'/sdcard/Download/{FIXTURE}')
    shell('am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
          '-d', f'file:///sdcard/Download/{FIXTURE}', check=False)
    tap([r'^영상 추가$'])
    tap([r'^자막 불러오기$'], swipe=True)
    try:
        tap([rf'^{re.escape(FIXTURE)}$'], timeout=10)
    except AssertionError:
        tap([r'Show roots', r'Open navigation drawer', r'탐색 창 열기', r'(?:^|:)id/toolbar_nav_button'])
        tap([r'^Downloads$', r'^다운로드$'])
        tap([rf'^{re.escape(FIXTURE)}$'])
    find([rf'{re.escape(CUE)}'], timeout=35)
    capture('01-previous-version-fixture')


def change_default():
    tap([r'^설정$'])
    assert shell('wm', 'size').splitlines()[-1].endswith('1080x2400')
    assert shell('wm', 'density').splitlines()[-1].endswith('440')
    tap([r'^기본값 수정$'])
    time.sleep(1.2)
    capture('02-baseline-defaults-before-change')
    # Coordinates are from the same Pixel 6/API 35 screen's recorded drawer and pinned viewport.
    shell('input', 'tap', '448', '792')
    time.sleep(0.5)
    shell('input', 'tap', '300', '1625')
    time.sleep(1.0)
    capture('03-baseline-defaults-after-save')
    shell('am', 'force-stop', PACKAGE)
    launch()
    tap([r'^설정$'])
    find([r'자동 감지\s*→\s*번역 안 함'], timeout=25)
    capture('04-baseline-restart-persistence')


def verify_upgrade():
    tap([r'^작업$'])
    find([rf'^{re.escape(FIXTURE)}$'], timeout=35)
    tap([r'^자막 편집$'], swipe=True)
    find([rf'{re.escape(CUE)}'], timeout=30)
    capture('05-optimized-version-captions')
    tap([r'^설정$'])
    find([r'자동 감지\s*→\s*번역 안 함'], timeout=30)
    capture('06-optimized-version-settings')


def offline_screen():
    tap([r'^영상 추가$'])
    tap([r'^오프라인 AI 모델 설치 후'], timeout=40)
    tap([r'로컬 AI 모델 관리 및 파일 전사'], timeout=35, swipe=True)
    find([r'^독립 로컬 AI 자막$', r'선택 모델 다운로드·설치'], timeout=35)
    state = shell('dumpsys', 'activity', 'activities')
    assert any('ResumedActivity' in line and '.OfflineVoskActivity' in line for line in state.splitlines())
    find([r'영상·오디오 파일 선택'], timeout=25, swipe=True)
    capture('07-optimized-native-offline-activity')


def run():
    shell('svc', 'wifi', 'disable')
    shell('cmd', 'connectivity', 'airplane-mode', 'enable')
    assert shell('settings', 'get', 'global', 'wifi_on') == '0'
    assert shell('settings', 'get', 'global', 'airplane_mode_on') == '1'
    install('../dex04-apks/baseline.apk')
    launch()
    import_fixture()
    print('PASS: baseline installed and stored SRT through the Android document picker', flush=True)
    change_default()
    print('PASS: baseline saved the changed subtitle translation default and retained it across restart', flush=True)
    shell('am', 'force-stop', PACKAGE)
    install('../dex04-apks/optimized.apk')
    launch()
    verify_upgrade()
    print('PASS: in-place install retained caption editor content and subtitle translation default', flush=True)
    offline_screen()
    print('PASS: optimized WebView opens native offline model management in airplane mode', flush=True)


try:
    run()
except BaseException:
    capture('failed-ui')
    (EVIDENCE / 'logcat.txt').write_bytes(adb('logcat', '-d', '-t', '1500', check=False))
    raise
