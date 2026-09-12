import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { fetchRealBand } from "./imagery";
import { mapSighting, type Sighting, type SightingRow } from "./types";

export const SPECTRUM_BANDS = [
  "visible",
  "ir",
  "thermal",
  "radar",
  "night",
] as const;

export type SpectrumBand = (typeof SPECTRUM_BANDS)[number];

export const SPECTRUM_META: Record<
  SpectrumBand,
  { label: string; short: string }
> = {
  visible: { label: "Visible", short: "VIS" },
  ir: { label: "Infrared", short: "IR" },
  thermal: { label: "Thermal", short: "THR" },
  radar: { label: "Radar", short: "RDR" },
  night: { label: "Night", short: "NVG" },
};

export type Biome = "ocean" | "urban" | "desert" | "polar" | "wild";

export function biomeFor(s: Pick<Sighting, "locationLabel" | "region" | "lat">): Biome {
  const t = `${s.locationLabel} ${s.region}`.toLowerCase();
  if (
    s.lat > 66 ||
    s.lat < -60 ||
    /arctic|antarctic|greenland|iceland|ice cap|polar|mcmurdo|yukon/.test(t)
  ) {
    return "polar";
  }
  if (
    /pacific|atlantic|ocean|sea|strait|bay|gulf|channel|chagos|kaikoura|trindade|aguadilla|tasman|diego garcia/.test(
      t,
    )
  ) {
    return "ocean";
  }
  if (/desert|atacama|sahara|arid|plateau/.test(t)) return "desert";
  if (
    /tokyo|beijing|chicago|madrid|mumbai|phoenix|singapore|o'hare|ohare|fir|nairobi|tehran|brussels|brabant|london|paris/.test(
      t,
    )
  ) {
    return "urban";
  }
  return "wild";
}

export function feedSrc(biome: Biome) {
  return { video: `/feeds/${biome}.mp4`, poster: `/feeds/${biome}.jpg` };
}

export type SpectrumStill = {
  band: SpectrumBand;
  src: string;
  source: string;
  capturedAt: string | null;
  note: string | null;
};

type StillRow = {
  band: SpectrumBand;
  image_data: string;
  source: string | null;
  captured_at: string | null;
  note: string | null;
};

export const listSpectra = createServerFn({ method: "GET" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<SpectrumStill[]> => {
    try {
      const sql = await getSql();
      const rows = await sql<StillRow>`
        select band, image_data, source, captured_at::text as captured_at, note
        from spectrum_stills
        where sighting_id = ${data.id}
      `;
      return rows
        .filter((r) => SPECTRUM_BANDS.includes(r.band))
        .map((r) => ({
          band: r.band,
          src: r.image_data,
          source: r.source ?? "ai",
          capturedAt: r.captured_at,
          note: r.note,
        }));
    } catch {
      return [];
    }
  });

function bandPrompt(band: SpectrumBand, s: Sighting) {
  const place = `${s.locationLabel}, ${s.region}`;
  const object = `a small distant ${s.shape} unidentified object in the sky, physically small in frame, documentary not cinematic sci-fi`;
  const common = `Photoreal still of the actual terrain around ${place}. ${object}. No text, no HUD, no watermark, no logos.`;
  switch (band) {
    case "visible":
      return `${common} Natural-color aerial photograph, twilight or clear air, visible spectrum.`;
    case "ir":
      return `${common} Near-infrared black-and-white reconnaissance still, vegetation bright, sky dark, grain of an IR sensor.`;
    case "thermal":
      return `${common} False-color ironbow thermal image, cold ground dark, warmer edges orange-white, the object a compact warm return.`;
    case "radar":
      return `${common} Synthetic-aperture radar still, grainy green-black PPI/SAR look, a compact radar return where the object is.`;
    case "night":
      return `${common} Green-phosphor night-vision still, sparse lights, intensified dark landscape.`;
  }
}

async function generateStill(prompt: string): Promise<string | { error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { error: "AI imagery is unavailable in this environment." };

  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt,
      n: 1,
      resolution: "1k",
      response_format: "b64_json",
    }),
  });
  if (!res.ok) return { error: `Image generation failed (${res.status}).` };
  const body = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const first = body.data?.[0];
  if (first?.b64_json) return `data:image/jpeg;base64,${first.b64_json}`;
  if (first?.url) return first.url;
  return { error: "No image returned." };
}

export const acquireSpectra = createServerFn({ method: "POST" })
  .validator((input: { id: number; bands: SpectrumBand[] }) => {
    const id = Number(input.id);
    if (!Number.isFinite(id)) throw new Error("Invalid contact.");
    const bands = [...new Set(input.bands)].filter((b) =>
      SPECTRUM_BANDS.includes(b),
    ) as SpectrumBand[];
    if (bands.length === 0) throw new Error("Pick a spectrum band.");
    if (bands.length > 5) throw new Error("Too many bands.");
    return { id, bands };
  })
  .handler(async ({ data }): Promise<SpectrumStill[] | { error: string }> => {
    try {
      const sql = await getSql();
      const sightingRows = await sql<SightingRow>`
        select
          id, lat, lng, location_label, region,
          occurred_at::text as occurred_at,
          shape, duration_sec, summary, classification, confidence, source,
          created_at::text as created_at
        from sightings
        where id = ${data.id}
        limit 1
      `;
      const row = sightingRows[0];
      if (!row) return { error: "Contact not found." };
      const sighting = mapSighting(row);

      const existing = await sql<StillRow>`
        select band, image_data, source, captured_at::text as captured_at, note
        from spectrum_stills
        where sighting_id = ${data.id}
      `;
      const have = new Set(existing.map((r) => r.band));
      const missing = data.bands.filter((b) => !have.has(b));

      for (const band of missing) {
        const real = await fetchRealBand(sighting, band);
        let src: string;
        let source: string;
        let capturedAt: string | null = null;
        let note: string | null = null;
        if (real) {
          src = real.src;
          source = real.source;
          capturedAt = real.capturedAt;
          note = real.note;
        } else {
          const img = await generateStill(bandPrompt(band, sighting));
          if (typeof img !== "string") return img;
          src = img;
          source = "ai";
          note = "No satellite product for this band/date — AI reconstruction";
        }
        await sql.query(
          "delete from spectrum_stills where sighting_id = $1 and band = $2",
          [data.id, band],
        );
        await sql.query(
          "insert into spectrum_stills (sighting_id, band, image_data, source, captured_at, note) values ($1,$2,$3,$4,$5,$6)",
          [data.id, band, src, source, capturedAt, note],
        );
      }

      const rows = await sql<StillRow>`
        select band, image_data, source, captured_at::text as captured_at, note
        from spectrum_stills
        where sighting_id = ${data.id}
      `;
      return rows
        .filter((r) => SPECTRUM_BANDS.includes(r.band))
        .map((r) => ({
          band: r.band,
          src: r.image_data,
          source: r.source ?? "ai",
          capturedAt: r.captured_at,
          note: r.note,
        }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Spectrum capture failed.";
      return { error: msg };
    }
  });
