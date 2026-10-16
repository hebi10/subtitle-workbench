param(
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$BuildRoot = 'C:/Users/Public/HaebiSubtitleBuild',
    [string]$GradleExecutable = '',
    [switch]$DeviceTests
)

# Native Windows Android tools and Gradle test argument files can fail on Unicode paths.
# Build a source-only copy in a fresh ASCII directory; never move or erase the workspace.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$workspace = Split-Path -Parent $PSScriptRoot
if (-not $SdkPath -or -not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms/android-35/android.jar'))) {
    throw 'Set -SdkPath to an Android SDK with Platform 35 and Build Tools 35.0.0 installed.'
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) {
    throw 'Set -JavaHome to a JDK 17 or 21 installation.'
}
$buildBase = [System.IO.Path]::GetFullPath($BuildRoot)
if ($buildBase -match '[^\x00-\x7f]') { throw 'BuildRoot must use an ASCII path on Windows.' }
$snapshot = Join-Path $buildBase ('sources/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path "$snapshot/android/app", "$snapshot/src" | Out-Null
Copy-Item -LiteralPath "$workspace/android/app/src" -Destination "$snapshot/android/app" -Recurse
Copy-Item -LiteralPath "$workspace/android/web" -Destination "$snapshot/android" -Recurse
Copy-Item -LiteralPath "$workspace/android/gradle" -Destination "$snapshot/android" -Recurse
Copy-Item -LiteralPath "$workspace/android/app/build.gradle" -Destination "$snapshot/android/app"
foreach ($file in @('settings.gradle', 'build.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat')) {
    Copy-Item -LiteralPath "$workspace/android/$file" -Destination "$snapshot/android"
}
foreach ($file in @('core.js', 'subtitle-editor.js', 'subtitle-player.js', 'edit-history.js')) {
    Copy-Item -LiteralPath "$workspace/src/$file" -Destination "$snapshot/src"
}
$sdkResolved = (Resolve-Path -LiteralPath $SdkPath).Path
if ($sdkResolved -match '[^\x00-\x7f]') {
    $sdkLink = Join-Path $snapshot 'sdk'
    New-Item -ItemType Junction -Path $sdkLink -Target $sdkResolved | Out-Null
    $sdkResolved = $sdkLink
}
$previousJava = $env:JAVA_HOME
$previousSdk = $env:ANDROID_HOME
$previousGradle = $env:GRADLE_USER_HOME
$destination = Join-Path $workspace 'output/android'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
try {
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $sdkResolved
    $env:GRADLE_USER_HOME = Join-Path $buildBase 'gradle'
    $gradle = if ($GradleExecutable) { $GradleExecutable } else { "$snapshot/android/gradlew.bat" }
    $tasks = @('testDebugUnitTest', 'lintDebug', 'assembleDebug', 'assembleDebugAndroidTest')
    if ($DeviceTests) { $tasks += 'connectedDebugAndroidTest' }
    & $gradle -p "$snapshot/android" @tasks --console plain 2>&1 | Tee-Object -FilePath "$destination/build.log"
    if ($LASTEXITCODE -ne 0) { throw "Android build failed. Source snapshot: $snapshot" }
    Copy-Item -LiteralPath "$snapshot/android/app/build/outputs/apk/debug/app-debug.apk" -Destination "$destination/haebi-subtitles-debug.apk" -Force
    Copy-Item -LiteralPath "$snapshot/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" -Destination "$destination/haebi-subtitles-tests.apk" -Force
    Copy-Item -LiteralPath "$snapshot/android/app/build/reports/lint-results-debug.html" -Destination "$destination/lint-results.html" -Force
    Write-Output "APK: $destination/haebi-subtitles-debug.apk"
    Write-Output "Build reports and retained source snapshot: $snapshot/android/app/build/reports"
} finally {
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousSdk
    $env:GRADLE_USER_HOME = $previousGradle
}
