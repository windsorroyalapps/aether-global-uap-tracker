import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { buildLivePicture } from "./live";
import { mapSighting, type Analysis, type SightingRow } from "./types";

type AnalysisRow = {
  id: number;
  sighting_id: number;
  assessment: string;
  likely_origin: string;
  threat: "none" | "watch" | "elevated";
  created_at: string;
};

function mapAnalysis(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    sightingId: row.sighting_id,
    assessment: row.assessment,
    likelyOrigin: row.likely_origin,
    threat: row.threat,
    createdAt: row.created_at,
  };
}

export const getAnalysis = createServerFn({ method: "GET" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<Analysis | null> => {
    const sql = await getSql();
    const rows = await sql<AnalysisRow>`
      select id, sighting_id, assessment, likely_origin, threat,
             created_at::text as created_at
      from analyses
      where sighting_id = ${data.id}
      limit 1
    `;
    return rows[0] ? mapAnalysis(rows[0]) : null;
  });

type GrokJson = {
  assessment?: string;
  likely_origin?: string;
  threat?: string;
};

function parseGrok(raw: string): { assessment: string; likelyOrigin: string; threat: Analysis["threat"] } {
  let parsed: GrokJson = {};
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as GrokJson;
  } catch {
    parsed = { assessment: raw.slice(0, 800), likely_origin: "Unresolved", threat: "watch" };
  }
  const threatRaw = (parsed.threat ?? "watch").toLowerCase();
  const threat: Analysis["threat"] =
    threatRaw === "elevated" ? "elevated" : threatRaw === "none" ? "none" : "watch";
  return {
    assessment: (parsed.assessment ?? "No assessment produced.").slice(0, 1200),
    likelyOrigin: (parsed.likely_origin ?? "Unresolved").slice(0, 160),
    threat,
  };
}

export const analyzeContact = createServerFn({ method: "POST" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<Analysis | { error: string }> => {
    const sql = await getSql();
    const existing = await sql<AnalysisRow>`
      select id, sighting_id, assessment, likely_origin, threat,
             created_at::text as created_at
      from analyses
      where sighting_id = ${data.id}
      limit 1
    `;
    if (existing[0]) return mapAnalysis(existing[0]);

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
    const s = mapSighting(row);

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { error: "AI assessment is unavailable in this environment." };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content:
              "You are a cautious UAP intelligence analyst. Be precise, skeptical, and non-sensational. Never claim extraterrestrial origin as fact. Reply with JSON only.",
          },
          {
            role: "user",
            content: `Assess this contact and return JSON with keys assessment (3-5 sentences), likely_origin (short phrase), threat (one of none|watch|elevated).
Location: ${s.locationLabel} (${s.lat.toFixed(2)}, ${s.lng.toFixed(2)}), ${s.region}
Time: ${s.occurredAt}
Shape: ${s.shape}; duration_sec: ${s.durationSec ?? "unknown"}
Current class: ${s.classification}; confidence ${s.confidence}
Source: ${s.source}
Narrative: ${s.summary}`,
          },
        ],
      }),
    });

    if (!res.ok) return { error: `Assessment failed (${res.status}).` };

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = parseGrok(body.choices?.[0]?.message?.content ?? "");

    const inserted = await sql<AnalysisRow>`
      insert into analyses (sighting_id, assessment, likely_origin, threat)
      values (${s.id}, ${parsed.assessment}, ${parsed.likelyOrigin}, ${parsed.threat})
      on conflict (sighting_id) do update set
        assessment = excluded.assessment,
        likely_origin = excluded.likely_origin,
        threat = excluded.threat
      returning id, sighting_id, assessment, likely_origin, threat,
                created_at::text as created_at
    `;
    const saved = inserted[0];
    if (!saved) return { error: "Could not store assessment." };
    return mapAnalysis(saved);
  });

export const analyzeLiveEvent = createServerFn({ method: "POST" })
  .validator(
    (input: {
      label: string;
      lat: number;
      lng: number;
      summary: string;
      source: string;
      residual?: number | null;
      fusion?: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<Analysis | { error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { error: "AI assessment is unavailable in this environment." };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        max_tokens: 380,
        messages: [
          {
            role: "system",
            content:
              "You are a cautious UAP intelligence analyst. Prefer prosaic explanations. Never claim extraterrestrial origin as fact. JSON only.",
          },
          {
            role: "user",
            content: `Assess this LIVE fused contact. JSON keys: assessment (3-5 sentences), likely_origin, threat (none|watch|elevated).
Label: ${data.label}
Lat/lng: ${data.lat.toFixed(2)}, ${data.lng.toFixed(2)}
Source: ${data.source}
Residual score: ${data.residual ?? "n/a"}
Narrative: ${data.summary}
Fusion: ${data.fusion ?? "none"}`,
          },
        ],
      }),
    });
    if (!res.ok) return { error: `Assessment failed (${res.status}).` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = parseGrok(body.choices?.[0]?.message?.content ?? "");
    return {
      id: 0,
      sightingId: 0,
      assessment: parsed.assessment,
      likelyOrigin: parsed.likelyOrigin,
      threat: parsed.threat,
      createdAt: new Date().toISOString(),
    };
  });

export const generateBriefing = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ text: string } | { error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { error: "AI briefing is unavailable in this environment." };

    const sql = await getSql();
    const rows = await sql<SightingRow>`
      select
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at
      from sightings
      order by occurred_at desc
      limit 14
    `;
    const archive = rows
      .map(mapSighting)
      .map(
        (s) =>
          `- ${s.occurredAt.slice(0, 10)} | ${s.region} | ${s.locationLabel} | ${s.shape} | ${s.classification} | conf ${s.confidence}`,
      )
      .join("\n");

    let liveBlock = "Live picture unavailable.";
    try {
      const live = await buildLivePicture();
      const dets = live.detections
        .slice(0, 16)
        .map(
          (d) =>
            `- LIVE ${d.source} | ${d.region} | ${d.locationLabel} | residual ${d.residual ?? "n/a"} | ${d.classification}`,
        )
        .join("\n");
      liveBlock = `Streams: ${live.streams.map((s) => `${s.label}:${s.ok ? "up" : "down"}`).join(", ")}
ISS: ${live.iss ? `${live.iss.lat.toFixed(1)}, ${live.iss.lng.toFixed(1)}` : "n/a"}
Satellites tracked: ${live.satellites.map((s) => s.name).join(", ") || "n/a"}
Balloons (stratospheric): ${live.balloons.length}
Space weather: ${live.spaceWeather.kpLabel}${live.flare ? ` · X-ray ${live.flare.class}` : ""}
Live detections:\n${dets || "(none)"}`;
    } catch {
      /* keep fallback */
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.4,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content:
              "You write short UAP watch-floor briefings. Calm, operational, no sensationalism, no alien claims. Four tight paragraphs max. Separate live residuals from historical archives. Mention prosaic correlators (balloons, satellites, Venus, ADS-B) when they appear.",
          },
          {
            role: "user",
            content: `Write a global situation briefing.\n\nLIVE PICTURE\n${liveBlock}\n\nARCHIVE CONTACTS\n${archive}`,
          },
        ],
      }),
    });
    if (!res.ok) return { error: `Briefing failed (${res.status}).` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { text: body.choices?.[0]?.message?.content?.trim() || "No briefing produced." };
  },
);
