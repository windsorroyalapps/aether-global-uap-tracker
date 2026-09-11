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

/** Sensitive watch: page earlier, shorter quiet window. */
const COOL_MS = 8 * 60 * 1000;
const WATCH_FLOOR = 16;
const CANDIDATE_LINE = 35;
const rank: Record<AlertTier, number> = { suppress: 0, watch: 1, candidate: 2, elevated: 3 };

const seen = new Map<string, { at: number; residual: number; tier: AlertTier }>();

export function tabHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function alertKey(c: Pick<Contact, "id" | "source">) {
  return `${c.source}:${c.id}`;
}

export function classifyAlert(c: Contact): AlertEvent {
  const residual = uapProbability(c);
  const key = alertKey(c);
  const v = c.liveVerdict;
  const notes = detectionNotes(c);
  const base = { contactId: c.id, label: c.locationLabel, key, residual };

  if (c.classification === "likely-prosaic" || residual < WATCH_FLOOR) {
    return { ...base, tier: "suppress", reason: "prosaic or below watch floor" };
  }

  const split = /split/i.test(v?.assessment ?? "");
  const trans = notes.some((n) => /transmedium|open-water|dark or unnamed|Tasman|aviation conflict/i.test(n));
  const dual =
    Boolean(v?.spectra.includes("infrared") && v.spectra.some((s) => s !== "infrared")) ||
    notes.some((n) => /dual-band/i.test(n));
  const form = notes.some((n) => /pacing|formation/i.test(n));
  const threat = v?.threat === "elevated" || v?.threat === "watch";
  const cpa = (c.reasons ?? []).some((r) => /aviation conflict/i.test(r));

  const bits: string[] = [];
  if (residual > CANDIDATE_LINE) bits.push(`residual ${residual}%`);
  else if (v?.verdict === "uap-candidate") bits.push("live AI UAP-candidate");
  else bits.push(`watch residual ${residual}%`);

  let tier: AlertTier = residual > CANDIDATE_LINE || v?.verdict === "uap-candidate" ? "candidate" : "watch";
  if ((tier === "candidate" || residual >= 28) && (split || trans || dual || form || threat || cpa)) {
    if (split || trans || dual || form || cpa || v?.threat === "elevated") tier = "elevated";
    if (split) bits.push("ensemble split");
    if (trans) bits.push("maritime residual");
    if (dual) bits.push("IR + visual");
    if (form) bits.push("pacing / formation");
    if (threat) bits.push("threat watch");
    if (cpa) bits.push("aviation conflict");
  }

  return { ...base, tier, reason: bits.join(" · ") };
}

/** Sensitive: watch pages when the tab is hidden; candidate/elevated always. */
export function shouldPage(ev: AlertEvent): boolean {
  if (ev.tier === "suppress") return false;
  if (ev.tier === "watch") return false;
  const now = Date.now();
  const prev = seen.get(ev.key);
  if (!prev) {
    seen.set(ev.key, { at: now, residual: ev.residual, tier: ev.tier });
    return true;
  }
  const jump = ev.residual - prev.residual >= 10;
  const escalate = rank[ev.tier] > rank[prev.tier];
  if (now - prev.at < COOL_MS && !jump && !escalate) return false;
  seen.set(ev.key, { at: now, residual: ev.residual, tier: ev.tier });
  return true;
}

export function pageNative(ev: AlertEvent) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const title =
    ev.tier === "elevated" ? "AETHER elevated" : ev.tier === "candidate" ? "AETHER candidate" : "AETHER watch";
  const body = `${ev.label} — ${ev.reason}`;
  try {
    const sw = navigator.serviceWorker?.controller;
    if (sw) {
      sw.postMessage({ kind: "notify", title, body, tag: ev.key, silent: ev.tier === "watch" });
      return;
    }
    new Notification(title, { body, tag: ev.key, silent: ev.tier === "watch" });
  } catch {
    try {
      new Notification(title, { body, tag: ev.key });
    } catch {
      /* WebView without notification bridge */
    }
  }
}

export async function armNativePush() {
  if (typeof window === "undefined") return "denied";
  try {
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/aether-sw.js");
    }
  } catch {
    /* ignore */
  }
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
