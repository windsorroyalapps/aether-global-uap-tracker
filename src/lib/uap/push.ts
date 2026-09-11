import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { classifyAlert, type AlertEvent } from "./alerts";
import type { Contact } from "./types";

const COOL_MS = 8 * 60 * 1000;
const rank: Record<AlertEvent["tier"], number> = {
  suppress: 0,
  watch: 1,
  candidate: 2,
  elevated: 3,
};

const seen = new Map<string, { at: number; residual: number; tier: AlertEvent["tier"] }>();

function vapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function appOrigin() {
  return (
    process.env.AETHER_APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    "https://aether-global-uap-tracker.vercel.app"
  ).replace(/\/$/, "");
}

function shouldBroadcast(ev: AlertEvent): boolean {
  if (ev.tier !== "candidate" && ev.tier !== "elevated") return false;
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

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ publicKey: string | null }> => {
    const cfg = vapidConfig();
    return { publicKey: cfg?.publicKey ?? null };
  },
);

export const savePushSubscription = createServerFn({ method: "POST" })
  .validator(
    (input: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!vapidConfig()) return { ok: false, error: "VAPID not configured" };
    const endpoint = data.endpoint?.trim();
    const p256dh = data.p256dh?.trim();
    const auth = data.auth?.trim();
    if (!endpoint || !p256dh || !auth) return { ok: false, error: "invalid subscription" };
    const sql = await getSql();
    await sql`
      insert into push_subscriptions (endpoint, p256dh, auth, user_agent, last_seen_at)
      values (
        ${endpoint.slice(0, 2048)},
        ${p256dh.slice(0, 256)},
        ${auth.slice(0, 256)},
        ${(data.userAgent ?? "").slice(0, 400) || null},
        now()
      )
      on conflict (endpoint) do update set
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = coalesce(excluded.user_agent, push_subscriptions.user_agent),
        last_seen_at = now()
    `;
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .validator((input: { endpoint: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const endpoint = data.endpoint?.trim();
    if (!endpoint) return { ok: true };
    const sql = await getSql();
    await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
    return { ok: true };
  });

type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
};

export async function broadcastPush(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  const cfg = vapidConfig();
  if (!cfg) return { sent: 0, pruned: 0 };

  const sql = await getSql();
  const rows = await sql<{ endpoint: string; p256dh: string; auth: string }>`
    select endpoint, p256dh, auth from push_subscriptions order by last_seen_at desc limit 500
  `;
  if (rows.length === 0) return { sent: 0, pruned: 0 };

  const webpush = await import("web-push");
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        sent += 1;
        await sql`update push_subscriptions set last_seen_at = now() where endpoint = ${row.endpoint}`;
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await sql`delete from push_subscriptions where endpoint = ${row.endpoint}`;
          pruned += 1;
        }
      }
    }),
  );

  return { sent, pruned };
}

export async function notifyDutyAlerts(detections: Contact[]): Promise<{ notified: number }> {
  if (!vapidConfig()) return { notified: 0 };

  let notified = 0;
  const origin = appOrigin();

  for (const c of detections) {
    const ev = classifyAlert(c);
    if (!shouldBroadcast(ev)) continue;

    const title =
      ev.tier === "elevated"
        ? "AETHER elevated"
        : ev.tier === "candidate"
          ? "AETHER candidate"
          : "AETHER watch";
    const body = `${ev.label} — ${ev.reason}`;
    const url = `${origin}/?contact=${ev.contactId}`;

    const result = await broadcastPush({
      title,
      body,
      tag: ev.key,
      url,
    });
    if (result.sent > 0) notified += 1;
  }

  return { notified };
}
