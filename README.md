# AETHER — Global UAP Detection Network

Live-fusion console for tracking unidentified anomalous phenomena. AETHER correlates public sensor streams, scores residuals against prosaic correlators, pulls nearby public cameras that could have a line of sight on an event, and runs live AI on optical + infrared frames as contacts appear.

**Live:** https://aether-global-uap-tracker.vercel.app

## 24/7 duty + Web Push alerts

Pushes fire when a **new** contact is sealed (duty) or reported live (open console). The frequent duty pulse is only the background detector when nobody has the console open — not an “alert every N minutes” timer.

- **Near-realtime:** with the console open, new `candidate` / `elevated` live contacts call `notifyLiveContacts` (deduped by contact id).
- **Background discovery (primary):** **GitHub Actions** (`.github/workflows/duty-24h.yml`) curls `/api/duty` every 5 minutes (`*/5 * * * *`). This is the Hobby-safe 24/7 pulse.
- **Vercel Cron** (`vercel.json`) also hits `/api/duty` once daily (`0 0 * * *` UTC). Hobby accounts cannot schedule more than once per day; keep the GitHub Action as the frequent detector.
- Duty still seals live contacts and writes a server backup every pulse; **Web Push** fans out only for **newly sealed** `candidate` / `elevated` contacts (8-minute cooldown, escalation, or residual jump ≥10).

### Opt-in alerts (phone / PWA)

1. Open the console and tap **Enable alerts** in the header (permission is never requested on mount).
2. Grant notification permission when prompted.
3. Keep the subscription; alerts arrive even when the app/tab is closed (service worker `push` handler).

**iOS:** Add to Home Screen for reliable Web Push on iOS 16.4+. Safari alone may not deliver closed-app push.

Local flag: `localStorage.aether-push-on`.

### Environment (Vercel / host)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres |
| `XAI_API_KEY` | Grok live AI |
| `DUTY_SECRET` / `CRON_SECRET` | Auth for `/api/duty` |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `VAPID_SUBJECT` | `mailto:` or `https://` contact (default `mailto:alerts@aether.local`) |

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set both keys + subject in the Vercel project env, then redeploy. Without VAPID, duty still seals the archive but push fanout is a no-op.

After merge, run `npm install` locally / on deploy so `package-lock.json` picks up `web-push` (^3.6.7).

## Live streams

- **ADS-B** — anomaly scoring on live aircraft (slow high, extreme climb, emergency squawk)
- **SondeHub** — high-altitude radiosondes (frequent "white orb" correlator)
- **TLE / Kepler+J2** — ISS, CSS, Hubble, Terra/Aqua, NOAA-20, Landsat 8 and other catalog birds
- **Astronomy** — Sun, Moon, Venus, Jupiter, Mars, Saturn altitude/azimuth
- **CNEOS** — NASA fireballs
- **NOAA SWPC** — Kp / aurora plus GOES X-ray flares
- **Open news** — GDELT + HN Algolia geoparsed reports
- **Public optics** — NOAA GOES visible + IR, Himawari, Hessdalen, FU Berlin, DOT 511 (AZ/FL/GA/PA/NY/WI/NV/AK), ODOT TripCheck, plus ALERTCalifornia / Caltrans / NYC / TfL where in range

Cameras are ranked by line-of-sight: distance, facing azimuth, elevation through Earth curvature, and optical range by camera kind (traffic vs sky vs space).

## Console

- Globe overlays for aircraft, balloons, and satellites
- Click a contact to open optics + kinematics + celestial origin
- Live AI rail scores residuals from visual CCTV + GOES infrared as they appear
- Contacts over 50% residual UAP probability are labelled in bright green
- Correlator stack (balloons / satellites / sky bodies / flares)
- Residual scoring that prefers prosaic explanations
- Grok assessment + watch-floor briefing
- **Enable alerts** for closed-app Web Push on candidate/elevated contacts

## Native apps (iOS / Android / Windows)

A GitHub Actions workflow at `.github/workflows/native-packages.yml` builds:

- **Android APK** — `AETHER-1.0.0.apk`
- **Windows installer** — `AETHER-Setup-1.0.0.exe`
- **iOS IPA** — `AETHER-1.0.0.ipa` (unsigned; sign with your Apple team to install on a device)

Push to `main` or run **Actions → Native packages → Run workflow**. Artifacts upload on every run; a rolling GitHub Release `native-latest` is published from `main`.

**TestFlight:** add the Apple secrets in [`native/ios/TESTFLIGHT.md`](native/ios/TESTFLIGHT.md), then run **Actions → TestFlight**. Internal testers receive the signed build in the TestFlight app.

Set repository variable `AETHER_APP_URL` to your live console URL (default `https://aether-global-uap-tracker.vercel.app`). Details in [`native/README.md`](native/README.md).

## Stack

- TanStack Start + React 19
- Tailwind v4
- Postgres (Neon in production, PGLite in local preview)
- xAI Grok for analysis (`grok-4.5`)
- `astronomy-engine` for celestial positions
- `web-push` for VAPID Web Push fanout

## Local

```bash
npm install
npm run dev
```

AI features require `XAI_API_KEY`. Tracker, globe, cameras, and fusion streams work without it. Web Push fanout also needs the VAPID env vars above.

## Data

Contacts are stored in `sightings`. Seeded archive cases are public-record reports and sensor notes, classified conservatively. Field reports must not include names, emails, or private addresses.

Push endpoints live in `push_subscriptions`; duty cooldown keys in `push_alert_log` (see `migrations/0004_push_subscriptions.sql`).

Only official public camera and telemetry APIs are used. Snapshot proxying is SSRF-restricted to an allowlisted host set.
