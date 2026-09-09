# AETHER native shells

GitHub Actions builds three installable wrappers around the live AETHER console:

| Artifact | Platform | File |
|---|---|---|
| Android | phone / tablet | `AETHER-1.0.0.apk` |
| Windows | desktop | `AETHER-Setup-1.0.0.exe` |
| iOS | iPhone / iPad | `AETHER-1.0.0.ipa` |

Each shell is a native WebView (WKWebView / Android WebView / Electron) pointed at the live tracker. Fusion, optics, and live AI stay on the server.

## Point the shells at your console

Default URL is `https://aether-global-uap-tracker.vercel.app`. Override it:

1. Repo **Settings → Secrets and variables → Actions → Variables** → `AETHER_APP_URL`
2. Or **Actions → Native packages → Run workflow** and paste a URL
3. Or edit `native/app-url.txt`

## Install

- **Android** — download the APK, enable Install unknown apps, tap to install.
- **Windows** — run the `.exe` installer. SmartScreen may warn because the build is unsigned; choose Run anyway.
- **iOS** — the IPA on the GitHub release is unsigned (simulator). For phones, use **TestFlight** (see [`native/ios/TESTFLIGHT.md`](ios/TESTFLIGHT.md)).

## Local builds

```bash
# Android (needs JDK 17)
cd native/android && gradle assembleRelease

# Windows (on Windows, or wine + electron-builder)
cd native/desktop && npm install && npm run pack:win

# iOS (macOS + Xcode)
brew install xcodegen
cd native/ios && xcodegen generate
xcodebuild -project Aether.xcodeproj -scheme Aether -destination 'generic/platform=iOS Simulator' build
```

## TestFlight

Signed App Store builds upload from **Actions → TestFlight**. Add the Apple secrets listed in [`native/ios/TESTFLIGHT.md`](ios/TESTFLIGHT.md), then run the workflow. Internal testers get the build after Apple processes it; no App Review required for internal testing.

