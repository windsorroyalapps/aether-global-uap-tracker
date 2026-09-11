import { createServerFn } from "@tanstack/react-start";
import type {
  Classification,
  Contact,
  LiveVerdict,
  Shape,
  Source,
} from "./types";

export type NotifyLiveItem = {
  id: number;
  locationLabel: string;
  residual?: number | null;
  confidence: number;
  classification: Classification;
  source: Source;
  lat?: number;
  lng?: number;
  shape?: Shape;
  summary?: string;
  reasons?: string[];
  durationSec?: number | null;
  altitudeM?: number | null;
  speedKts?: number | null;
  headingDeg?: number | null;
  verticalFpm?: number | null;
  liveVerdict?: LiveVerdict | null;
};

function asNotifyContact(item: NotifyLiveItem): Contact {
  const now = new Date().toISOString();
  return {
    id: item.id,
    lat: item.lat ?? 0,
    lng: item.lng ?? 0,
    locationLabel: item.locationLabel,
    region: "",
    occurredAt: now,
    shape: item.shape ?? "unknown",
    durationSec: item.durationSec ?? null,
    summary: item.summary ?? "",
    classification: item.classification,
    confidence: item.confidence,
    source: item.source,
    createdAt: now,
    live: true,
    residual: item.residual ?? item.confidence,
    reasons: item.reasons ?? [],
    altitudeM: item.altitudeM ?? null,
    speedKts: item.speedKts ?? null,
    headingDeg: item.headingDeg ?? null,
    verticalFpm: item.verticalFpm ?? null,
    liveVerdict: item.liveVerdict ?? null,
  };
}

export const getPushPublicKey = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ publicKey: string | null }> => {
    const { getVapidPublicKey } = await import("./web-push");
    return { publicKey: getVapidPublicKey() };
  },
);

export const subscribePush = createServerFn({ method: "POST" })
  .validator(
    (input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { saveSubscription } = await import("./web-push");
    return saveSubscription(data);
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .validator((input: { endpoint: string }) => input)
  .handler(async ({ data }) => {
    const { removeSubscription } = await import("./web-push");
    return removeSubscription(data.endpoint);
  });

/** Near-realtime fanout when the console sees a new candidate/elevated contact. */
export const notifyLiveContacts = createServerFn({ method: "POST" })
  .validator((input: { items: NotifyLiveItem[] }) => input)
  .handler(async ({ data }): Promise<{ notified: number; skipped: number }> => {
    const { classifyAlert } = await import("./alerts");
    const {
      broadcastAlert,
      markServerPushSent,
      shouldSendServerPush,
    } = await import("./web-push");

    let notified = 0;
    let skipped = 0;
    for (const item of data.items.slice(0, 8)) {
      const ev = classifyAlert(asNotifyContact(item));
      if (ev.tier !== "candidate" && ev.tier !== "elevated") {
        skipped += 1;
        continue;
      }
      const allow = await shouldSendServerPush(ev);
      if (!allow) {
        skipped += 1;
        continue;
      }
      const title =
        ev.tier === "elevated" ? "AETHER elevated" : "AETHER candidate";
      const body = `${ev.label} — ${ev.reason}`;
      const result = await broadcastAlert({
        title,
        body,
        tag: ev.key,
        url: "/",
      });
      if (result.skipped === "no-vapid") break;
      if (result.sent > 0) {
        await markServerPushSent(ev);
        notified += result.sent;
      } else {
        skipped += 1;
      }
    }
    return { notified, skipped };
  });
