import { detectionNotes } from "./detect";
import { uapProbability } from "./infer";
import type { Contact } from "./types";

export type AlertTier = "suppress" | "watch" | "candidate" | "elevated";

export type AlertEvent = {
  contactId: number;
  label: string;
  tier: AlertTier;
  reason: string;
  key: string;
  residual: number;
};

const COOL_MS = 20 * 60 * 1000;
const rank: Record<AlertTier, number> = { suppress: 0, watch: 1, candidate: 2, elevated: 3 };

const seen = new Map<string, { at: number; residual: number; tier: AlertTier }>();

export function alertKey(c: Pick<Contact, "lat" | "lng" | "source" | "residual" | "confidence">) {
  const band = Math.floor((c.residual ?? c.confidence) / 10);
  return `${c.source}|${c.lat.toFixed(2)}|${c.lng.toFixed(2)}|${band}`;
}

export function classifyAlert(c: Contact): AlertEvent {
  const residual = uapProbability(c);
  const key = alertKey(c);
  const v = c.liveVerdict;
  const notes = detectionNotes(c);
  const base = { contactId: c.id, label: c.locationLabel, key, residual };

  if (c.classification === "likely-prosaic" || residual < 28) {
    return { ...base, tier: "suppress", reason: "prosaic or below watch floor" };
  }

  const candidate = residual > 50 || v?.verdict === "uap-candidate";
  const split = /split/i.test(v?.assessment ?? "");
  const trans = notes.some((n) => /transmedium|open-water|dark or unnamed|Tasman|aviation conflict/i.test(n));
  const dual =
    Boolean(v?.spectra.includes("infrared") && v.spectra.some((s) => s !== "infrared")) ||
    notes.some((n) => /dual-band/i.test(n));
  const form = notes.some((n) => /pacing|formation/i.test(n));
  const threat = v?.threat === "elevated";
  const cpa = (c.reasons ?? []).some((r) => /aviation conflict/i.test(r));

  const bits: string[] = [];
  if (residual > 50) bits.push(`residual ${residual}%`);
  else if (v?.verdict === "uap-candidate") bits.push("live AI UAP-candidate");
  else bits.push(`watch residual ${residual}%`);

  let tier: AlertTier = candidate ? "candidate" : "watch";
  if (candidate && (split || trans || dual || form || threat || cpa)) {
    tier = "elevated";
    if (split) bits.push("ensemble split");
    if (trans) bits.push("maritime residual");
    if (dual) bits.push("IR + visual");
    if (form) bits.push("pacing / formation");
    if (threat) bits.push("threat elevated");
    if (cpa) bits.push("aviation conflict");
  }

  return { ...base, tier, reason: bits.join(" · ") };
}

/** Candidate/elevated pages; watch is silent. Same box is quiet for 20 min unless jump or escalate. */
export function shouldPage(ev: AlertEvent): boolean {
  if (ev.tier === "suppress" || ev.tier === "watch") return false;
  const now = Date.now();
  const prev = seen.get(ev.key);
  if (!prev) {
    seen.set(ev.key, { at: now, residual: ev.residual, tier: ev.tier });
    return true;
  }
  const jump = ev.residual - prev.residual >= 15;
  const escalate = rank[ev.tier] > rank[prev.tier];
  if (now - prev.at < COOL_MS && !jump && !escalate) return false;
  seen.set(ev.key, { at: now, residual: ev.residual, tier: ev.tier });
  return true;
}

export function pageNative(ev: AlertEvent) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(ev.tier === "elevated" ? "AETHER elevated" : "AETHER candidate", {
      body: `${ev.label} — ${ev.reason}`,
      tag: ev.key,
      silent: ev.tier !== "elevated",
    });
  } catch {
    /* WebView without notification bridge */
  }
}

export async function armNativePush() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
