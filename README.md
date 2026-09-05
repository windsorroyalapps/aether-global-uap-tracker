# AETHER — Global UAP Detection Network

AI-powered console for tracking unidentified anomalous phenomena worldwide.

AETHER plots historical archives, sensor contacts, and field reports on a live globe, classifies each file, and can run a Grok assessment or a global watch-floor briefing on demand.

## What it does

- **Global picture** — orthographic globe of contacts across every inhabited continent and the oceans
- **Contact files** — location, kinematics notes, classification, confidence, and source
- **Field reports** — file a new contact (no personal data; reports are shared with everyone on the board)
- **AI assessment** — Grok reads a single file and returns origin hypothesis + watch level (cached)
- **Intel briefing** — on-demand synthesis of the latest contacts

## Stack

- TanStack Start + React 19
- Tailwind v4
- Postgres (Neon in production, PGLite in local preview)
- xAI Grok for analysis (`grok-4.5`)

## Local

```bash
npm install
npm run dev
```

AI features require `XAI_API_KEY` in the server environment. The globe and tracker work without it.

## Data

Contacts are stored in `sightings`. Seeded archive cases are public-record reports and sensor notes, classified conservatively. Field reports must not include names, emails, or private addresses.
