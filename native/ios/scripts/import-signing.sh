#!/usr/bin/env bash
# Import Apple Distribution cert + App Store profile on the CI runner.
set -euo pipefail

: "${IOS_DIST_CERTIFICATE_P12:?}"
: "${IOS_DIST_CERTIFICATE_PASSWORD:?}"
: "${IOS_PROVISIONING_PROFILE:?}"

CERTIFICATE_PATH="${RUNNER_TEMP:-/tmp}/aether_dist.p12"
PP_PATH="${RUNNER_TEMP:-/tmp}/aether.mobileprovision"
KEYCHAIN_PATH="${RUNNER_TEMP:-/tmp}/aether-signing.keychain-db"
KEYCHAIN_PASSWORD="${IOS_KEYCHAIN_PASSWORD:-aether-ci-keychain}"

echo -n "$IOS_DIST_CERTIFICATE_P12" | base64 --decode > "$CERTIFICATE_PATH"
echo -n "$IOS_PROVISIONING_PROFILE" | base64 --decode > "$PP_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERTIFICATE_PATH" \
  -P "$IOS_DIST_CERTIFICATE_PASSWORD" \
  -A -t cert -f pkcs12 \
  -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security list-keychain -d user -s "$KEYCHAIN_PATH"
security default-keychain -s "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

PP_HOME="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PP_HOME"

# Decode profile metadata without extra gems.
PP_PLIST="${RUNNER_TEMP:-/tmp}/aether-profile.plist"
security cms -D -i "$PP_PATH" > "$PP_PLIST"
PP_UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$PP_PLIST")
PP_NAME=$(/usr/libexec/PlistBuddy -c 'Print Name' "$PP_PLIST")
cp "$PP_PATH" "$PP_HOME/${PP_UUID}.mobileprovision"

{
  echo "IOS_PROFILE_UUID=$PP_UUID"
  echo "IOS_PROFILE_NAME=$PP_NAME"
} >> "${GITHUB_ENV:-/dev/null}"

echo "Imported profile '$PP_NAME' ($PP_UUID)"
