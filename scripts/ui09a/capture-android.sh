#!/usr/bin/env bash
set -euo pipefail

# Invoked once by android-emulator-runner, not as separate shell lines.
chmod +x ./gradlew
./gradlew assembleDebug assembleDebugAndroidTest --no-daemon
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
mkdir -p ../output/ui09a/device ../output/ui09a/native

for scale in 100 160; do
  if [[ "$scale" == "100" ]]; then
    adb shell settings put system font_scale 1.0
  else
    adb shell settings put system font_scale 1.6
  fi
  for mode in light dark; do
    if [[ "$mode" == "light" ]]; then
      adb shell cmd uimode night no
    else
      adb shell cmd uimode night yes
    fi
    label="$mode-font$scale"
    echo "UI09A capturing Android 15 state matrix: $label"
    adb shell pm clear com.haebi.subtitle
    adb shell am instrument -w -e class com.haebi.subtitle.EditorialUi09aStateMatrixDeviceTest \
      com.haebi.subtitle.test/androidx.test.runner.AndroidJUnitRunner \
      > ../output/ui09a/device/"$label".log
    cat ../output/ui09a/device/"$label".log
    grep -q 'OK (1 test)' ../output/ui09a/device/"$label".log
    adb pull /sdcard/Android/data/com.haebi.subtitle/files/ui09a-state-matrix/. ../output/ui09a/device/

    adb shell pm clear com.haebi.subtitle
    adb shell am instrument -w -e class com.haebi.subtitle.EditorialNativeScreensDeviceTest \
      com.haebi.subtitle.test/androidx.test.runner.AndroidJUnitRunner \
      > ../output/ui09a/device/native-"$label".log
    cat ../output/ui09a/device/native-"$label".log
    grep -q 'OK (3 tests)' ../output/ui09a/device/native-"$label".log
    mkdir -p ../output/ui09a/native/"$label"
    adb pull /sdcard/Android/data/com.haebi.subtitle/files/editorial-3c/. ../output/ui09a/native/"$label"/
  done
done

echo "UI09A Android API35 all four theme/font configurations passed."
