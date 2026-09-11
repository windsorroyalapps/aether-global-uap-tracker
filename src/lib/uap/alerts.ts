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

const PUSH_FLAG = "aether-push-on";

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
      sw.postMessage({ kind: "notify", title, body, tag: ev.key, silent: ev.tier === "watch", url: "/" });
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the service worker quietly — never prompts for notification permission. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/aether-sw.js");
  } catch {
    return null;
  }
}

/** @deprecated Prefer ensureServiceWorker(); permission is opt-in via enablePushNotifications. */
export async function armNativePush() {
  await ensureServiceWorker();
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}

export function isPushOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PUSH_FLAG) === "1";
  } catch {
    return false;
  }
}

export async function enablePushNotifications(): Promise<
  | { ok: true; permission: NotificationPermission }
  | { ok: false; error: string }
> {
  if (typeof window === "undefined") return { ok: false, error: "not-browser" };
  if (typeof Notification === "undefined" || !("PushManager" in window)) {
    return { ok: false, error: "push-unsupported" };
  }

  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, error: "sw-failed" };

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, error: "permission-failed" };
    }
  }
  if (permission !== "granted") return { ok: false, error: "permission-denied" };

  const { getPushPublicKey, subscribePush } = await import("./push-api");
  const { publicKey } = await getPushPublicKey();
  if (!publicKey) return { ok: false, error: "no-vapid" };

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: "bad-subscription" };
    }
    await subscribePush({
      data: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      },
    });
    try {
      localStorage.setItem(PUSH_FLAG, "1");
    } catch {
      /* ignore */
    }
    return { ok: true, permission };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "subscribe-failed";
    return { ok: false, error: msg };
  }
}

export async function disablePushNotifications(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof window === "undefined") return { ok: false, error: "not-browser" };
  try {
    const reg = await ensureServiceWorker();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => undefined);
      const { unsubscribePush } = await import("./push-api");
      await unsubscribePush({ data: { endpoint } }).catch(() => undefined);
    }
    try {
      localStorage.removeItem(PUSH_FLAG);
    } catch {
      /* ignore */
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unsubscribe-failed";
    return { ok: false, error: msg };
  }
}
