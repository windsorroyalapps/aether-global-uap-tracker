import { camerasNear, snapshotFor } from "./cameras";
import type { CameraHit, Contact, LiveVerdict } from "./types";

type Compact = {
  id: number;
  lat: number;
  lng: number;
  locationLabel: string;
  region: string;
  summary: string;
  source: string;
  classification: string;
  shape: string;
  residual: number | null;
  altitudeM: number | null;
  speedKts: number | null;
  headingDeg: number | null;
  verticalFpm: number | null;
  reasons: string[];
};

const g = globalThis as typeof globalThis & {
  __aetherVerdicts__?: Map<number, LiveVerdict>;
};

function store() {
  if (!g.__aetherVerdicts__) g.__aetherVerdicts__ = new Map();
  return g.__aetherVerdicts__;
}

export function peekVerdict(id: number) {
  return store().get(id) ?? null;
}

export function allVerdicts() {
  return [...store().values()].sort((a, b) => b.at.localeCompare(a.at));
}

function attach(v: LiveVerdict) {
  store().set(v.contactId, v);
  return v;
}

function pickFrames(ground: CameraHit[], space: CameraHit[]) {
  const visual = ground.filter((c) => c.spectrum !== "infrared");
  const ir = [...space, ...ground].filter((c) => c.spectrum === "infrared");
  const geo = space.filter((c) => c.spectrum !== "infrared");
  const out: CameraHit[] = [];
  const facing = visual.find((c) => c.facing && (c.kind === "sky" || c.kind === "airport"));
  const anyVis = visual.find((c) => c.facing) ?? visual[0];
  if (facing) out.push(facing);
  else if (anyVis) out.push(anyVis);
  if (ir[0]) out.push(ir[0]);
  if (geo[0] && out.length < 3) out.push(geo[0]);
  return out.slice(0, 3);
}

type Frame = { name: string; spectrum: CameraHit["spectrum"]; mime: string; b64: string };

async function grabFrames(cams: CameraHit[]): Promise<Frame[]> {
  const grabbed = await Promise.all(
    cams.map(async (cam) => {
      try {
        const snap = await snapshotFor(cam.id);
        if (!snap) return null;
        if (snap.b64.length > 380_000) return null;
        return { name: cam.name, spectrum: cam.spectrum, mime: snap.mime, b64: snap.b64 };
      } catch {
        return null;
      }
    }),
  );
  return grabbed.filter((x): x is Frame => x !== null);
}

type GrokLive = {
  verdict?: string;
  confidence?: number;
  likely_origin?: string;
  assessment?: string;
  threat?: string;
  optical_notes?: string;
};

function parseLive(raw: string, contactId: number, frames: Frame[]): LiveVerdict {
  let parsed: GrokLive = {};
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as GrokLive;
  } catch {
    parsed = { assessment: raw.slice(0, 600), verdict: "watch", likely_origin: "Unresolved" };
  }
  const vRaw = (parsed.verdict ?? "watch").toLowerCase();
  const verdict: LiveVerdict["verdict"] =
    vRaw === "uap-candidate" || vRaw === "anomalous" ? "uap-candidate" : vRaw === "prosaic" ? "prosaic" : "watch";
  const tRaw = (parsed.threat ?? "watch").toLowerCase();
  const threat: LiveVerdict["threat"] =
    tRaw === "elevated" ? "elevated" : tRaw === "none" ? "none" : "watch";
  const confidence = Math.max(4, Math.min(99, Math.round(Number(parsed.confidence) || 50)));
  return {
    contactId,
    verdict,
    confidence,
    likelyOrigin: (parsed.likely_origin ?? "Unresolved").slice(0, 160),
    assessment: (parsed.assessment ?? "No live assessment.").slice(0, 900),
    threat,
    opticalNotes: (parsed.optical_notes ?? "").slice(0, 400),
    framesUsed: frames.length,
    spectra: [...new Set(frames.map((f) => f.spectrum))],
    at: new Date().toISOString(),
  };
}

async function scoreOne(c: Compact): Promise<LiveVerdict | null> {
  const hit = peekVerdict(c.id);
  if (hit && Date.now() - Date.parse(hit.at) < 8 * 60_000) return hit;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  const optics = await camerasNear(c.lat, c.lng, c.altitudeM).catch(() => ({
    ground: [] as CameraHit[],
    space: [] as CameraHit[],
    total: 0,
  }));
  const frames = await grabFrames(pickFrames(optics.ground, optics.space));
  const residual = c.residual ?? 0;

  const text = `LIVE sensor determination. Decide now from kinematics + attached optical/IR frames. Prefer prosaic (airliner on approach, Starlink train, UAV envelope, Venus/Jupiter, balloon, thunderstorm, satellite flare). Never claim extraterrestrial origin as fact. If another airframe is inside ~12 km and similar altitude, threat=elevated — that is a traffic conflict, keep people clear, do not chase.
JSON keys: verdict (prosaic|watch|uap-candidate), confidence (0-100), likely_origin, assessment (2-4 sentences), threat (none|watch|elevated), optical_notes (what the frames show or fail to show).
Label: ${c.locationLabel}
Lat/lng: ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)} · ${c.region}
Source: ${c.source} · class ${c.classification}
Residual: ${residual}
Heading ${c.headingDeg ?? "n/a"}° · ${c.speedKts ?? "n/a"} kts · ${c.verticalFpm ?? "n/a"} fpm · alt ${c.altitudeM ?? "n/a"} m
Reasons: ${c.reasons.join("; ") || "none"}
Narrative: ${c.summary}
Frames attached: ${frames.map((f) => `${f.name} [${f.spectrum}]`).join("; ") || "none — kinematics only"}
Ground cameras in LOS: ${optics.total}`;

  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const f of frames) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${f.mime};base64,${f.b64}` },
    });
  }

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content:
            "You are a live UAP sensor-fusion officer. Visual CCTV and infrared geostationary frames may be attached. Score the contact immediately. JSON only.",
        },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const verdict = parseLive(body.choices?.[0]?.message?.content ?? "", c.id, frames);
  attach(verdict);
  return verdict;
}

export async function sweepContacts(items: Compact[]): Promise<LiveVerdict[]> {
  const ranked = [...items]
    .filter((c) => (c.residual ?? 0) >= 28 || c.classification === "anomalous")
    .sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0))
    .slice(0, 8);

  const stale = ranked.filter((c) => {
    const v = peekVerdict(c.id);
    return !v || Date.now() - Date.parse(v.at) > 8 * 60_000;
  });

  const batch = stale.slice(0, 2);
  await Promise.all(batch.map((c) => scoreOne(c).catch(() => null)));

  return ranked.map((c) => peekVerdict(c.id)).filter((v): v is LiveVerdict => v !== null);
}

export function attachVerdicts(list: Contact[]): Contact[] {
  return list.map((c) => {
    const v = peekVerdict(c.id);
    return v ? { ...c, liveVerdict: v } : c;
  });
}

export function compactContact(c: Contact): Compact {
  return {
    id: c.id,
    lat: c.lat,
    lng: c.lng,
    locationLabel: c.locationLabel,
    region: c.region,
    summary: c.summary.slice(0, 500),
    source: c.source,
    classification: c.classification,
    shape: c.shape,
    residual: c.residual ?? c.confidence,
    altitudeM: c.altitudeM ?? null,
    speedKts: c.speedKts ?? null,
    headingDeg: c.headingDeg ?? null,
    verticalFpm: c.verticalFpm ?? null,
    reasons: c.reasons ?? [],
  };
}
