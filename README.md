# AETHER — Global UAP Detection Network

Live-fusion console for tracking unidentified anomalous phenomena. AETHER correlates public sensor streams, scores residuals against prosaic correlators, and pulls nearby public cameras that could have a line of sight on an event.

## Live streams

- **ADS-B** — anomaly scoring on live aircraft (slow high, extreme climb, emergency squawk)
- **SondeHub** — high-altitude radiosondes (frequent "white orb" correlator)
- **TLE / Kepler+J2** — ISS, CSS, Hubble, Terra/Aqua, NOAA-20, Landsat 8 and other catalog birds
- **Astronomy** — Sun, Moon, Venus, Jupiter, Mars, Saturn altitude/azimuth
- **CNEOS** — NASA fireballs
- **NOAA SWPC** — Kp / aurora plus GOES X-ray flares
- **Open news** — GDELT + HN Algolia geoparsed reports
- **Public optics** — NOAA GOES sectors, Himawari, Hessdalen, FU Berlin, DOT 511 (AZ/FL/GA/PA/NY/WI/NV/AK), ODOT TripCheck, plus ALERTCalifornia / Caltrans / NYC / TfL where in range

Cameras are ranked by line-of-sight: distance, facing azimuth, elevation through Earth curvature, and optical range by camera kind (traffic vs sky vs space).

## Console

- Globe overlays for aircraft, balloons, and satellites
- Optics mosaic with facing filter
- Correlator stack (balloons / satellites / sky bodies / flares)
- Residual scoring that prefers prosaic explanations
- Grok assessment + watch-floor briefing

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
