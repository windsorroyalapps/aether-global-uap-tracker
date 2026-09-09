# TestFlight beta

GitHub Actions **TestFlight** signs an App Store IPA and uploads it. Internal testers see it in TestFlight after Apple processes the build (usually 5–15 minutes). External groups optionally go through Beta App Review.

Bundle ID: `app.aether.tracker`

## 1. Apple Developer

You need a paid Apple Developer Program membership.

1. [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → register `app.aether.tracker` (App ID, bundle ID explicit).
2. Certificates → create **Apple Distribution**.
3. Profiles → create **App Store Connect** provisioning profile for `app.aether.tracker` using that certificate. Download the `.mobileprovision`.
4. Export the distribution certificate from Keychain as `Certificates.p12` (set a password).

## 2. App Store Connect

1. [Apps](https://appstoreconnect.apple.com/apps) → New App.
   - Platform: iOS
   - Name: AETHER
   - Bundle ID: `app.aether.tracker`
   - SKU: `aether-global-uap-tracker`
2. Users and Access → Integrations → **App Store Connect API** → create a key with **App Manager**.
   - Download the `.p8` once.
   - Note **Key ID** and **Issuer ID**.
3. TestFlight → Internal Testing → add yourself / testers (no review).

## 3. GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `APP_STORE_CONNECT_API_KEY` | Full `.p8` text (`-----BEGIN PRIVATE KEY-----` …) |
| `APP_STORE_CONNECT_KEY_ID` | Key ID from App Store Connect |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (UUID) |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `IOS_DIST_CERTIFICATE_P12` | `base64 -i Certificates.p12 \| pbcopy` |
| `IOS_DIST_CERTIFICATE_PASSWORD` | Password you set on the `.p12` |
| `IOS_PROVISIONING_PROFILE` | `base64 -i Profile.mobileprovision \| pbcopy` |

Optional: `IOS_KEYCHAIN_PASSWORD` (CI keychain; a default is used if omitted).

If the `.p8` was pasted as base64 instead of PEM, also set `APP_STORE_CONNECT_API_KEY_IS_BASE64=true` as a variable.

## 4. Ship a beta

Actions → **TestFlight** → Run workflow.

- Leave **groups** blank for internal testers only.
- Fill **groups** with an external TestFlight group name to submit for Beta App Review.

Every push that touches `native/ios` also tries to upload. If the secrets are missing, that push is skipped (the unsigned IPA job still runs).

Build number is the GitHub run number, so each upload is unique.

## Notes

- TestFlight needs a **device** App Store IPA. The unsigned simulator zip from Native packages cannot be installed via TestFlight.
- Internal testing does not require App Review. Public App Store review is separate and WebView shells are often rejected there — TestFlight internal is the supported path.
- Testers install **TestFlight** from the App Store, then accept your invite.
