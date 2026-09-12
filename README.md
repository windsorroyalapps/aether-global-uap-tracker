# AETHER — Global UAP Detection Network

AI-powered console for tracking unidentified anomalous phenomena worldwide.

AETHER plots archive cases, live USG bolides, and field reports on a NASA-textured globe, correlates EO/IR/radar, and scores residual UAP probability with Grok.

## What it does

- **Live globe** — orthographic Earth with a real terminator (VIIRS true color + night lights)
- **Live detections** — CNEOS/USG space-IR bolides with inbound sky direction (Andromeda, Proxima, …)
- **Correlation** — mandatory EO + IR + radar attempt, error bars, Open-Meteo weather, METAR, SIGMETs before the UAP index is finalized
- **Sensors** — radar, EO, IR, SBIRS, RF, acoustic, multi-sensor fusion
- **Spectra** — dated NASA GIBS stills (VIS/IR/thermal/radar/night) for the reported location
- **Watch floor** — AI-scored bolides below 35 drop off the default list
- **Field reports** — file a contact (no personal data; reports are shared with everyone on the board)

## Stack

- TanStack Start + React 19
- Tailwind v4
- Postgres (Neon in production, PGLite in local preview)
- xAI Grok (`grok-4.5`) for assessments
- NASA GIBS / WVS, CNEOS, Open-Meteo, NOAA SWPC, Aviation Weather Center

## Local

```bash
npm install
npm run dev
```

AI features require `XAI_API_KEY` in the server environment. The globe and tracker work without it.

## Data

Contacts are stored in `sightings`. Seeded archive cases are public-record reports and sensor notes, classified conservatively. Live bolides come from the USG CNEOS fireball feed. Field reports must not include names, emails, or private addresses.
