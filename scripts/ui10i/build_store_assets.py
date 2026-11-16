#!/usr/bin/env python3
"""Build UI-10-I Google Play image assets exclusively from verified Android emulator PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse
import hashlib
import json

SRC_SHA = "b57afccc2850f35cb675a837ff0d5437edad0936"
SRC_RUN = 43562836588
SCENES = [
    ("01-video.png", "영상과 음성 파일로 시작", "새 자막 작업", "output/editorial-5a/webview-light-font100/video-light-font100.png"),
    ("02-jobs.png", "작업 진행 상황을 한눈에", "작업 관리", "output/editorial-5a/webview-light-font100/jobs-light-font100.png"),
    ("03-results.png", "자막 결과 확인과 저장", "결과 확인", "output/editorial-5a/webview-light-font100/results-light-font100.png"),
    ("04-editor.png", "문장과 시간을 정밀하게 편집", "자막 편집", "output/editorial-5a/webview-light-font100/editor-light-font100.png"),
    ("05-settings.png", "연결과 인식 설정 관리", "설정", "output/editorial-5a/webview-light-font100/settings-expanded-light-font100.png"),
    ("06-on-device.png", "기기에서 직접 음성 인식", "온디바이스 자막", "output/editorial-native-3c/editorial-3c/on-device-light.png"),
    ("07-cloud-live.png", "실시간 마이크 음성 전사", "GPT 실시간 자막", "output/editorial-native-3c/editorial-3c/cloud-live-light.png"),
    ("08-vosk-local.png", "오프라인 로컬 AI 인식", "Vosk 로컬 AI", "output/editorial-native-3c/editorial-3c/vosk-local-light.png"),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def record(path, source):
    im = Image.open(path)
    return {"file":path.name,"width":im.width,"height":im.height,
            "sha256":sha(path.read_bytes()),"source":source}

def build(capture_dir, out, main_sha, font_path):
    capture_dir, out = Path(capture_dir), Path(out)
    if len(main_sha)!=40 or any(ch not in "0123456789abcdef" for ch in main_sha):
        raise ValueError("Invalid main SHA")
    out.mkdir(parents=True, exist_ok=True)
    title=ImageFont.truetype(font_path, 68)
    wordmark=ImageFont.truetype(font_path, 38)
    small=ImageFont.truetype(font_path, 26)
    assets=[]
    for filename, headline, category, sourcepath in SCENES:
        source_file = capture_dir / sourcepath
        raw=source_file.read_bytes()
        source=Image.open(source_file).convert("RGB")
        if source.size!=(1080,2400):
            raise ValueError(f"Unexpected original Android screenshot dimensions: {sourcepath}")
        page=Image.new("RGB",(1080,1920),"#f5f5f5")
        d=ImageDraw.Draw(page)
        d.text((70,54),"자막라인",font=wordmark,fill="#222222")
        d.text((70,123),headline,font=title,fill="#111111")
        d.text((72,220),category,font=small,fill="#555555")
        scale=min(920/source.width, 1620/source.height)
        target=(round(source.width*scale),round(source.height*scale))
        page.paste(source.resize(target,Image.Resampling.LANCZOS),
                   ((1080-target[0])//2,295))
        dst=out / filename
        page.save(dst,format="PNG",optimize=True)
        assets.append(record(dst,{"type":"real-android-emulator-capture",
            "sourceCommit":SRC_SHA,"mainEquivalentCommit":main_sha,
            "sourceRunId":SRC_RUN,"sourcePath":sourcepath,
            "sourceSHA256":sha(raw),"captionOutsideUncroppedCapture":True}))
    graphic=Image.new("RGB",(1024,500),"#f5f5f5")
    d=ImageDraw.Draw(graphic)
    d.rounded_rectangle((75,116,280,321),radius=12,fill="#171717")
    d.rectangle((123,174,233,238),outline="#f5f5f5",width=7)
    d.line((137,201,161,201),fill="white",width=6)
    d.line((172,201,218,201),fill="white",width=6)
    d.line((137,219,218,219),fill="white",width=5)
    d.text((330,150),"자막라인",font=ImageFont.truetype(font_path,105),fill="#171717")
    d.text((337,286),"음성 인식 · 번역 · 자막 편집",font=wordmark,fill="#515151")
    graphic.save(out/"feature-graphic.png",optimize=True)
    icon=Image.new("RGB",(512,512),"#171717")
    d=ImageDraw.Draw(icon)
    d.rounded_rectangle((94,132,418,380),radius=14,outline="white",width=19)
    for coords in ((154,211,207,211),(229,211,353,211),
                   (154,253,358,253),(154,296,321,296)):
        d.line(coords,fill="white",width=17)
    icon.save(out/"icon.png",optimize=True)
    for fname in ["icon.png","feature-graphic.png"]:
        assets.append(record(out/fname,{"type":"raster-brand-art","brand":"자막라인",
                                        "theme":"black-grey-flat"}))
    manifest={"language":"ko-KR","images":{
        "icon":["icon.png"],"featureGraphic":["feature-graphic.png"],
        "phoneScreenshots":[s[0] for s in SCENES]},
        "assets":assets,
        "screenshotCapture":{"status":"captured-for-review","count":8,
        "source":"Actual Android 15 API35 emulator, generated QA fixtures",
        "originalSourceCommit":SRC_SHA,"mainEquivalentCommit":main_sha,
        "sourceWorkflowRun":str(SRC_RUN),
        "provenanceFile":"capture-provenance-ui10.json"}}
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    provenance={"app":"자막라인","sourceGitSha":SRC_SHA,"equivalentMainSHA":main_sha,
                "emulatorRunId":SRC_RUN,"sourceScreenshots":[a for a in assets if a["file"].startswith("0")],
                "dataKind":"deterministic QA fixtures; no user content",
                "originalAppUISourceByteIdenticalToMain":True}
    (out/"capture-provenance-ui10.json").write_text(
        json.dumps(provenance,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("UI-10-I generated",len(assets),"PNG files for main",main_sha)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--capture-dir",required=True)
    p.add_argument("--main-sha",required=True)
    p.add_argument("--out",default="assets/play-store/ko-KR")
    p.add_argument("--font",default="/usr/share/fonts/truetype/nanum/NanumSquareB.ttf")
    args=p.parse_args()
    build(args.capture_dir,args.out,args.main_sha,args.font)
