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

export type WebPushStatus = "unsupported" | "denied" | "prompt" | "granted" | "subscribed";

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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/aether-sw.js");
  } catch {
    return null;
  }
}

async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

async function persistSubscription(sub: PushSubscription) {
  const { savePushSubscription } = await import("./push");
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return false;
  const res = await savePushSubscription({
    data: {
      endpoint,
      p256dh,
      auth,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    },
  });
  return Boolean(res && "ok" in res && res.ok);
}

export async function webPushStatus(): Promise<WebPushStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const sub = await currentPushSubscription();
  if (sub) return "subscribed";
  if (Notification.permission === "granted") return "granted";
  return "prompt";
}

export async function armNativePush(): Promise<WebPushStatus> {
  if (typeof window === "undefined") return "unsupported";
  const reg = await ensureServiceWorker();
  if (typeof Notification === "undefined") return "unsupported";

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "prompt";

  if (!reg || !("PushManager" in window)) return "granted";

  try {
    const { getVapidPublicKey } = await import("./push");
    const { publicKey } = await getVapidPublicKey();
    if (!publicKey) return "granted";

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const saved = await persistSubscription(sub);
    return saved ? "subscribed" : "granted";
  } catch {
    return "granted";
  }
}

export async function disableWebPush(): Promise<WebPushStatus> {
  if (typeof window === "undefined") return "unsupported";
  try {
    const sub = await currentPushSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try {
        await sub.unsubscribe();
      } catch {
        /* ignore */
      }
      if (endpoint) {
        const { deletePushSubscription } = await import("./push");
        await deletePushSubscription({ data: { endpoint } });
      }
    }
  } catch {
    /* ignore */
  }
  return webPushStatus();
}
