import { createServerFn } from "@tanstack/react-start";
import { ensureArchiveSchema, logLedger } from "./archive";
import { detectionNotes } from "./detect";
import { getSql } from "@/lib/db";
import { mapSighting, type Contact, type ReviewStatus, type SightingRow } from "./types";

export type ProviderId = "grok" | "openai" | "anthropic" | "google" | "mistral" | "groq" | "deepseek" | "openrouter";

export const PROVIDER_IDS: ProviderId[] = [
  "grok",
  "openai",
  "anthropic",
  "google",
  "mistral",
  "groq",
  "deepseek",
  "openrouter",
];

export type ProviderKeys = Partial<Record<ProviderId, string>>;

export type ProviderVote = {
  provider: ProviderId;
  ok: boolean;
  likelyOrigin: string;
  assessment: string;
  threat: "none" | "watch" | "elevated";
  verdict: "prosaic" | "watch" | "uap-candidate";
  error?: string;
};

const SYSTEM =
  "You are a cautious UAP analyst. Prefer prosaic. Never claim extraterrestrial origin as fact. JSON only: assessment, likely_origin, threat (none|watch|elevated), verdict (prosaic|watch|uap-candidate). Disagreement is allowed — do not discard the contact.";

function promptFor(c: {
  locationLabel: string;
  lat: number;
  lng: number;
  region: string;
  summary: string;
  source: string;
  classification: string;
  extra?: string;
}) {
  return `Assess this sealed archive/live contact.
Location: ${c.locationLabel} (${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}) ${c.region}
Source: ${c.source} class ${c.classification}
${c.extra ?? ""}
Narrative: ${c.summary}`;
}

function parseVote(raw: string, provider: ProviderId): ProviderVote {
  let parsed: Record<string, string> = {};
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as Record<string, string>;
  } catch {
    parsed = { assessment: raw.slice(0, 400), likely_origin: "Unresolved", verdict: "watch" };
  }
  const v = (parsed.verdict ?? "watch").toLowerCase();
  const t = (parsed.threat ?? "watch").toLowerCase();
  return {
    provider,
    ok: true,
    likelyOrigin: (parsed.likely_origin ?? "Unresolved").slice(0, 160),
    assessment: (parsed.assessment ?? "").slice(0, 800),
    threat: t === "elevated" ? "elevated" : t === "none" ? "none" : "watch",
    verdict: v === "uap-candidate" || v === "anomalous" ? "uap-candidate" : v === "prosaic" ? "prosaic" : "watch",
  };
}

async function grok(key: string, user: string): Promise<ProviderVote> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      max_tokens: 380,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return { provider: "grok", ok: false, likelyOrigin: "", assessment: "", threat: "watch", verdict: "watch", error: `grok ${res.status}` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseVote(body.choices?.[0]?.message?.content ?? "", "grok");
}

async function openai(key: string, user: string): Promise<ProviderVote> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 380,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return { provider: "openai", ok: false, likelyOrigin: "", assessment: "", threat: "watch", verdict: "watch", error: `openai ${res.status}` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseVote(body.choices?.[0]?.message?.content ?? "", "openai");
}

async function anthropic(key: string, user: string): Promise<ProviderVote> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 380,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) return { provider: "anthropic", ok: false, likelyOrigin: "", assessment: "", threat: "watch", verdict: "watch", error: `anthropic ${res.status}` };
  const body = (await res.json()) as { content?: { text?: string }[] };
  return parseVote(body.content?.[0]?.text ?? "", "anthropic");
}

async function google(key: string, user: string): Promise<ProviderVote> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 380 },
      }),
    },
  );
  if (!res.ok) return { provider: "google", ok: false, likelyOrigin: "", assessment: "", threat: "watch", verdict: "watch", error: `google ${res.status}` };
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return parseVote(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "", "google");
}

async function openaiCompat(
  provider: ProviderId,
  url: string,
  key: string,
  model: string,
  user: string,
): Promise<ProviderVote> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 380,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    return { provider, ok: false, likelyOrigin: "", assessment: "", threat: "watch", verdict: "watch", error: `${provider} ${res.status}` };
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseVote(body.choices?.[0]?.message?.content ?? "", provider);
}

function fuse(votes: ProviderVote[]) {
  const ok = votes.filter((v) => v.ok);
  const nUap = ok.filter((v) => v.verdict === "uap-candidate").length;
  const nPro = ok.filter((v) => v.verdict === "prosaic").length;
  const split = nUap > 0 && nPro > 0;
  const verdict: ProviderVote["verdict"] = nUap > nPro ? "uap-candidate" : nPro > nUap ? "prosaic" : "watch";
  const threat = ok.some((v) => v.threat === "elevated") ? "elevated" : ok.every((v) => v.threat === "none") ? "none" : "watch";
  const likelyOrigin = ok.sort((a, b) => a.provider.localeCompare(b.provider))[0]?.likelyOrigin ?? "Unresolved";
  const assessment = [
    split ? "Ensemble split — residual retained, not discarded." : `Ensemble ${verdict}.`,
    ...ok.map((v) => `${v.provider}: ${v.likelyOrigin}. ${v.assessment}`),
  ].join(" ");
  return { verdict, threat, likelyOrigin, assessment: assessment.slice(0, 1400), split, votes };
}

async function runKeys(keys: ProviderKeys, user: string): Promise<ProviderVote[]> {
  const jobs: Promise<ProviderVote>[] = [];
  const grokKey = keys.grok || process.env.XAI_API_KEY;
  if (grokKey) jobs.push(grok(grokKey, user).catch((e) => ({ provider: "grok" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.openai) jobs.push(openai(keys.openai, user).catch((e) => ({ provider: "openai" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.anthropic) jobs.push(anthropic(keys.anthropic, user).catch((e) => ({ provider: "anthropic" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.google) jobs.push(google(keys.google, user).catch((e) => ({ provider: "google" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.mistral) jobs.push(openaiCompat("mistral", "https://api.mistral.ai/v1/chat/completions", keys.mistral, "mistral-small-latest", user).catch((e) => ({ provider: "mistral" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.groq) jobs.push(openaiCompat("groq", "https://api.groq.com/openai/v1/chat/completions", keys.groq, "llama-3.3-70b-versatile", user).catch((e) => ({ provider: "groq" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.deepseek) jobs.push(openaiCompat("deepseek", "https://api.deepseek.com/chat/completions", keys.deepseek, "deepseek-chat", user).catch((e) => ({ provider: "deepseek" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (keys.openrouter) jobs.push(openaiCompat("openrouter", "https://openrouter.ai/api/v1/chat/completions", keys.openrouter, "openrouter/auto", user).catch((e) => ({ provider: "openrouter" as const, ok: false, likelyOrigin: "", assessment: "", threat: "watch" as const, verdict: "watch" as const, error: String(e) })));
  if (jobs.length === 0) return [];
  return Promise.all(jobs);
}

export const ensembleAnalyze = createServerFn({ method: "POST" })
  .validator((input: { summary: string; lat: number; lng: number; locationLabel: string; region: string; source: string; classification: string; extra?: string; keys: ProviderKeys }) => input)
  .handler(async ({ data }) => {
    const user = promptFor(data);
    const votes = await runKeys(data.keys ?? {}, user);
    if (votes.length === 0) return { error: "No AI keys configured." as const };
    return fuse(votes);
  });

export const aiReviewReport = createServerFn({ method: "POST" })
  .validator((input: { id: number; keys: ProviderKeys }) => input)
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureArchiveSchema();
    const rows = await sql<SightingRow>`
      select
        id, lat, lng, location_label, region,
        occurred_at::text as occurred_at,
        shape, duration_sec, summary, classification, confidence, source,
        created_at::text as created_at,
        review_status, content_hash
      from sightings where id = ${data.id} limit 1
    `;
    const row = rows[0];
    if (!row) return { error: "Contact missing." as const };
    const s = mapSighting(row);
    const extra = detectionNotes(s as Contact).join("; ");
    const user = promptFor({
      locationLabel: s.locationLabel,
      lat: s.lat,
      lng: s.lng,
      region: s.region,
      summary: s.summary,
      source: s.source,
      classification: s.classification,
      extra,
    });
    const votes = await runKeys(data.keys ?? {}, user);
    if (!votes.some((v) => v.ok)) return { error: "All providers failed." as const };
    const fused = fuse(votes);
    const next: ReviewStatus = "ai-reviewed";
    await sql`
      update sightings set review_status = ${next} where id = ${s.id} and review_status in ('pending', 'held')
    `;
    await sql`
      insert into analyses (sighting_id, assessment, likely_origin, threat)
      values (${s.id}, ${fused.assessment}, ${fused.likelyOrigin}, ${fused.threat})
      on conflict (sighting_id) do update set
        assessment = excluded.assessment,
        likely_origin = excluded.likely_origin,
        threat = excluded.threat
    `;
    await logLedger(s.id, "ai-reviewed", votes.filter((v) => v.ok).map((v) => v.provider).join("+"), fused.assessment.slice(0, 400), s.contentHash ?? null);
    return fused;
  });

export const dutyReviewPending = createServerFn({ method: "POST" }).handler(async () => {
  const sql = await getSql();
  await ensureArchiveSchema();
  const pending = await sql<{ id: number }>`
    select id from sightings
    where review_status in ('pending', 'held')
    order by id asc
    limit 1
  `;
  const countRows = await sql<{ n: number }>`
    select count(*)::int as n from sightings where review_status in ('pending', 'held')
  `;
  const remaining = countRows[0]?.n ?? 0;
  const id = pending[0]?.id;
  if (id == null) return { reviewed: null as number | null, remaining, error: null as string | null };
  const rows = await sql<SightingRow>`
    select
      id, lat, lng, location_label, region,
      occurred_at::text as occurred_at,
      shape, duration_sec, summary, classification, confidence, source,
      created_at::text as created_at,
      review_status, content_hash
    from sightings where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row) return { reviewed: null, remaining, error: "missing" };
  const s = mapSighting(row);
  const extra = detectionNotes(s as Contact).join("; ");
  const user = promptFor({
    locationLabel: s.locationLabel,
    lat: s.lat,
    lng: s.lng,
    region: s.region,
    summary: s.summary,
    source: s.source,
    classification: s.classification,
    extra,
  });
  const votes = await runKeys({}, user);
  if (!votes.some((v) => v.ok)) return { reviewed: null, remaining, error: "AI review failed" };
  const fused = fuse(votes);
  await sql`
    update sightings set review_status = 'ai-reviewed' where id = ${s.id} and review_status in ('pending', 'held')
  `;
  await sql`
    insert into analyses (sighting_id, assessment, likely_origin, threat)
    values (${s.id}, ${fused.assessment}, ${fused.likelyOrigin}, ${fused.threat})
    on conflict (sighting_id) do update set
      assessment = excluded.assessment,
      likely_origin = excluded.likely_origin,
      threat = excluded.threat
  `;
  await logLedger(s.id, "ai-reviewed", "duty+grok", fused.assessment.slice(0, 400), s.contentHash ?? null);
  return { reviewed: s.id, remaining: Math.max(0, remaining - 1), error: null as string | null, label: s.locationLabel };
});
