import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { enrichMissingLive } from "./crossfix";
import {
  CLASSIFICATIONS,
  mapSighting,
  type Analysis,
  type Classification,
  type Sighting,
  type SightingRow,
} from "./types";

type AnalysisRow = {
  id: number;
  sighting_id: number;
  assessment: string;
  likely_origin: string;
  threat: "none" | "watch" | "elevated";
  created_at: string;
  uap_probability?: number | null;
};

function mapAnalysis(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    sightingId: row.sighting_id,
    assessment: row.assessment,
    likelyOrigin: row.likely_origin,
    threat: row.threat,
    uapProbability: row.uap_probability == null ? null : Number(row.uap_probability),
    createdAt: row.created_at,
  };
}

export const getAnalysis = createServerFn({ method: "GET" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<Analysis | null> => {
    const sql = await getSql();
    const rows = await sql<AnalysisRow>`
      select id, sighting_id, assessment, likely_origin, threat,
             created_at::text as created_at, uap_probability
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
  uap_probability?: number;
  classification?: string;
};

type Score = {
  assessment: string;
  likelyOrigin: string;
  threat: Analysis["threat"];
  uapProbability: number;
  classification: Classification;
};

function parseClass(raw: string | undefined, fallback: Classification): Classification {
  const v = (raw ?? "").toLowerCase().trim();
  if ((CLASSIFICATIONS as readonly string[]).includes(v)) return v as Classification;
  return fallback;
}

function promptFor(s: Sighting) {
  const live = s.source === "live";
  return live
    ? `Score this USG sensor bolide for residual UAP probability. Most fireballs are prosaic meteors — typical range 8–28, almost always below the watch floor of 35. Raise the score only for hyperbolic/extreme velocity, altitude/energy mismatch, missing kinematics that should be present, or behavior that does not fit a meteor. Never claim extraterrestrial origin as fact.
Return JSON keys: assessment (3-5 sentences), likely_origin (short phrase), threat (none|watch|elevated), uap_probability (integer 0-100), classification (likely-prosaic|sensor-contact|unidentified|anomalous).
Location: ${s.locationLabel} (${s.lat.toFixed(2)}, ${s.lng.toFixed(2)}), ${s.region}
Time: ${s.occurredAt}
Shape: ${s.shape}; duration_sec: ${s.durationSec ?? "unknown"}
Heuristic class: ${s.classification}; heuristic UAP index ${s.uapIndex}
Sensor: ${s.sensorType}
Error bars: ±${s.latErrDeg ?? "?"}° lat · ±${s.lngErrDeg ?? "?"}° lng · ±${s.timeErrSec ?? "?"} s
Correlated: ${s.correlated ? "yes" : "pending"}
Inbound sky: ${s.originLabel ?? "unknown"} (${s.originDist ?? "—"})
Narrative: ${s.summary}`
    : `Assess this UAP contact. Be skeptical. Never claim extraterrestrial origin as fact.
Return JSON keys: assessment (3-5 sentences), likely_origin (short phrase), threat (none|watch|elevated), uap_probability (integer 0-100), classification (likely-prosaic|sensor-contact|unidentified|anomalous).
Location: ${s.locationLabel} (${s.lat.toFixed(2)}, ${s.lng.toFixed(2)}), ${s.region}
Time: ${s.occurredAt}
Shape: ${s.shape}; duration_sec: ${s.durationSec ?? "unknown"}
Current class: ${s.classification}; confidence ${s.confidence}; UAP index ${s.uapIndex}
Source: ${s.source}; sensor: ${s.sensorType}
Inbound sky: ${s.originLabel ?? "unknown"}
Narrative: ${s.summary}`;
}

async function scoreWithGrok(s: Sighting): Promise<Score | { error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { error: "AI assessment is unavailable in this environment." };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 14000);
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content:
              "You are a cautious UAP intelligence analyst. Precise, skeptical, non-sensational. JSON only.",
          },
          { role: "user", content: promptFor(s) },
        ],
      }),
    });
    if (!res.ok) return { error: `Assessment failed (${res.status}).` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
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
    let uap = Number(parsed.uap_probability);
    if (!Number.isFinite(uap)) uap = s.uapIndex;
    uap = Math.min(99, Math.max(1, Math.round(uap)));
    return {
      assessment: (parsed.assessment ?? "No assessment produced.").slice(0, 1200),
      likelyOrigin: (parsed.likely_origin ?? "Unresolved").slice(0, 160),
      threat,
      uapProbability: uap,
      classification: parseClass(parsed.classification, s.classification),
    };
  } catch {
    return { error: "Assessment timed out." };
  } finally {
    clearTimeout(timer);
  }
}

async function persistScore(s: Sighting, score: Score): Promise<Analysis> {
  const sql = await getSql();
  const inserted = await sql<AnalysisRow>`
    insert into analyses (sighting_id, assessment, likely_origin, threat, uap_probability)
    values (${s.id}, ${score.assessment}, ${score.likelyOrigin}, ${score.threat}, ${score.uapProbability})
    on conflict (sighting_id) do update set
      assessment = excluded.assessment,
      likely_origin = excluded.likely_origin,
      threat = excluded.threat,
      uap_probability = excluded.uap_probability
    returning id, sighting_id, assessment, likely_origin, threat,
              created_at::text as created_at, uap_probability
  `;
  await sql`
    update sightings
    set uap_index = ${score.uapProbability},
        classification = ${score.classification},
        confidence = ${score.uapProbability},
        ai_scored = true
    where id = ${s.id}
  `;
  const saved = inserted[0];
  if (!saved) throw new Error("Could not store assessment.");
  return mapAnalysis(saved);
}

export const analyzeContact = createServerFn({ method: "POST" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<Analysis | { error: string }> => {
    const sql = await getSql();
    const existing = await sql<AnalysisRow>`
      select id, sighting_id, assessment, likely_origin, threat,
             created_at::text as created_at, uap_probability
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
        created_at::text as created_at,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, ai_scored
      from sightings
      where id = ${data.id}
      limit 1
    `;
    const row = sightingRows[0];
    if (!row) return { error: "Contact not found." };
    const s = mapSighting(row);
    const scored = await scoreWithGrok(s);
    if ("error" in scored) return scored;
    return persistScore(s, scored);
  });

export const assessUnscoredLive = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ scored: number; remaining: number; error?: string }> => {
    try {
      await enrichMissingLive(3);
    } catch {
      // Score whatever is already correlated.
    }
    const sql = await getSql();
    const rows = await sql<SightingRow>`
      select
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, ai_scored, sensor_type,
        lat_err_deg, lng_err_deg, time_err_sec, correlated
      from sightings
      where source = 'live'
        and coalesce(ai_scored, false) = false
        and coalesce(correlated, false) = true
      order by occurred_at desc
      limit 4
    `;
    const remainRows = await sql<{ n: number }>`
      select count(*)::int as n from sightings
      where source = 'live' and coalesce(ai_scored, false) = false
    `;
    const remaining = Number(remainRows[0]?.n ?? 0);
    if (rows.length === 0) return { scored: 0, remaining: 0 };
    if (!process.env.XAI_API_KEY) {
      return { scored: 0, remaining, error: "AI scoring unavailable." };
    }

    let scored = 0;
    const batch = rows.map(mapSighting);
    const first = batch.slice(0, 2);
    const second = batch.slice(2, 4);

    const run = async (s: Sighting) => {
      const result = await scoreWithGrok(s);
      if ("error" in result) return result.error;
      await persistScore(s, result);
      scored += 1;
      return null;
    };

    const errors: string[] = [];
    for (const group of [first, second]) {
      const out = await Promise.all(group.map(run));
      for (const e of out) if (e) errors.push(e);
    }
    return {
      scored,
      remaining: Math.max(0, remaining - scored),
      error: scored === 0 ? errors[0] : undefined,
    };
  },
);

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
        created_at::text as created_at,
        origin_label, origin_ra, origin_dec, origin_dist, uap_index, ai_scored
      from sightings
      order by occurred_at desc
      limit 18
    `;
    const digest = rows
      .map(mapSighting)
      .map(
        (s) =>
          `- ${s.occurredAt.slice(0, 10)} | ${s.region} | ${s.locationLabel} | ${s.shape} | ${s.classification} | UAP ${s.uapIndex}${s.aiScored ? " AI" : ""} | ${s.originLabel ?? "—"}`,
      )
      .join("\n");

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.4,
        max_tokens: 380,
        messages: [
          {
            role: "system",
            content:
              "You write short UAP watch-floor briefings. Calm, operational, no sensationalism, no alien claims. Four tight paragraphs max. Cite the UAP probability index when it is AI-scored.",
          },
          {
            role: "user",
            content: `Write a global situation briefing from these contacts. Note clusters, prosaic alternatives, live-sensor bolides vs archive, and what would improve the data.\n${digest}`,
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
