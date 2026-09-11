import { sealLiveContacts, writeServerBackup } from "./archive";
import { classifyAlert } from "./alerts";
import { buildLivePicture } from "./live";
import {
  broadcastAlert,
  markServerPushSent,
  shouldSendServerPush,
} from "./web-push";

export async function runDutyCycle() {
  const picture = await buildLivePicture();
  const news = picture.streams.find((s) => s.id === "news");
  const sealed = await sealLiveContacts(picture.detections);
  const backup = await writeServerBackup();

  let pushSent = 0;
  let pushSkipped = 0;
  try {
    for (const c of sealed.sealed) {
      const ev = classifyAlert(c);
      if (ev.tier !== "candidate" && ev.tier !== "elevated") continue;
      const allow = await shouldSendServerPush(ev);
      if (!allow) {
        pushSkipped += 1;
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
        pushSent += result.sent;
      }
    }
  } catch (err) {
    console.error("[duty] web push fanout failed", err);
  }

  return {
    ok: true as const,
    at: picture.fetchedAt,
    detections: picture.detections.length,
    news: news?.detail ?? "no items",
    newsCount: news?.count ?? 0,
    sealed: sealed.inserted,
    skipped: sealed.skipped,
    backup: backup.count,
    pushSent,
    pushSkipped,
  };
}
