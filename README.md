# AETHER — Global UAP Detection Network

Live-fusion console for tracking unidentified anomalous phenomena. AETHER correlates public sensor streams, scores residuals against prosaic correlators, pulls nearby public cameras that could have a line of sight on an event, and runs live AI on optical + infrared frames as contacts appear.

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

## Native apps (iOS / Android / Windows)

A GitHub Actions workflow at `.github/workflows/native-packages.yml` builds:

- **Android APK** — `AETHER-1.0.0.apk`
- **Windows installer** — `AETHER-Setup-1.0.0.exe`
- **iOS IPA** — `AETHER-1.0.0.ipa` (unsigned; sign with your Apple team to install on a device)

Push to `main` or run **Actions → Native packages → Run workflow**. Artifacts upload on every run; a rolling GitHub Release `native-latest` is published from `main`.

Set repository variable `AETHER_APP_URL` to your live console URL (default `https://aether-global-uap-tracker.vercel.app`). Details in [`native/README.md`](native/README.md).

## Stack

- TanStack Start + React 19
- Tailwind v4
- Postgres (Neon in production, PGLite in local preview)
- xAI Grok for analysis (`grok-4.5`)
- `astronomy-engine` for celestial positions

## Local

```bash
npm install
npm run dev
```

AI features require `XAI_API_KEY`. Tracker, globe, cameras, and fusion streams work without it.

## Data

Contacts are stored in `sightings`. Seeded archive cases are public-record reports and sensor notes, classified conservatively. Field reports must not include names, emails, or private addresses.

Only official public camera and telemetry APIs are used. Snapshot proxying is SSRF-restricted to an allowlisted host set.
