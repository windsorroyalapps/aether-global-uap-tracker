import { sealLiveContacts, writeServerBackup } from "./archive";
import { buildLivePicture } from "./live";

export async function runDutyCycle() {
  const picture = await buildLivePicture();
  const news = picture.streams.find((s) => s.id === "news");
  const sealed = await sealLiveContacts(picture.detections);
  const backup = await writeServerBackup();
  return {
    ok: true as const,
    at: picture.fetchedAt,
    detections: picture.detections.length,
    news: news?.detail ?? "no items",
    newsCount: news?.count ?? 0,
    sealed: sealed.inserted,
    skipped: sealed.skipped,
    backup: backup.count,
  };
}
