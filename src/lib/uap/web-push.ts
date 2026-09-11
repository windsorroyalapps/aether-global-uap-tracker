import { getSql } from "@/lib/db";

export type PushSubInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export type PushAlertPayload = {
  title: string;
  body: string;
  tag: string;
  url?: string;
};

const TIER_RANK: Record<string, number> = {
  suppress: 0,
  watch: 1,
  candidate: 2,
  elevated: 3,
};

const COOL_MS = 8 * 60 * 1000;

function vapidPublic(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k || null;
}

function vapidPrivate(): string | null {
  const k = process.env.VAPID_PRIVATE_KEY?.trim();
  return k || null;
}

function vapidSubject(): string {
  const s = process.env.VAPID_SUBJECT?.trim();
  return s || "mailto:alerts@aether.local";
}

export function getVapidPublicKey(): string | null {
  return vapidPublic();
}

export async function saveSubscription(input: PushSubInput): Promise<{ ok: true }> {
  const sql = await getSql();
  const ua = input.userAgent ?? null;
  await sql`
    insert into push_subscriptions (endpoint, p256dh, auth, user_agent, last_seen_at)
    values (${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth}, ${ua}, now())
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = coalesce(excluded.user_agent, push_subscriptions.user_agent),
      last_seen_at = now()
  `;
  return { ok: true };
}

export async function removeSubscription(endpoint: string): Promise<{ ok: true }> {
  const sql = await getSql();
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
  return { ok: true };
}

export async function listSubscriptions(): Promise<
  { endpoint: string; p256dh: string; auth: string }[]
> {
  const sql = await getSql();
  return sql`
    select endpoint, p256dh, auth from push_subscriptions order by last_seen_at desc
  `;
}

export async function shouldSendServerPush(ev: {
  key: string;
  tier: string;
  residual: number;
}): Promise<boolean> {
  if (ev.tier !== "candidate" && ev.tier !== "elevated") return false;
  const sql = await getSql();
  const rows = await sql`
    select tier, residual, sent_at from push_alert_log where alert_key = ${ev.key} limit 1
  `;
  const prev = rows[0] as { tier: string; residual: number; sent_at: string } | undefined;
  if (!prev) return true;
  const age = Date.now() - new Date(prev.sent_at).getTime();
  const jump = ev.residual - Number(prev.residual) >= 10;
  const escalate = (TIER_RANK[ev.tier] ?? 0) > (TIER_RANK[prev.tier] ?? 0);
  if (age < COOL_MS && !jump && !escalate) return false;
  return true;
}

export async function markServerPushSent(ev: {
  key: string;
  tier: string;
  residual: number;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into push_alert_log (alert_key, tier, residual, sent_at)
    values (${ev.key}, ${ev.tier}, ${ev.residual}, now())
    on conflict (alert_key) do update set
      tier = excluded.tier,
      residual = excluded.residual,
      sent_at = now()
  `;
}

export async function broadcastAlert(
  ev: PushAlertPayload,
): Promise<{ sent: number; failed: number; skipped?: string }> {
  const pub = vapidPublic();
  const priv = vapidPrivate();
  if (!pub || !priv) return { sent: 0, failed: 0, skipped: "no-vapid" };

  const webpush = await import("web-push");
  webpush.setVapidDetails(vapidSubject(), pub, priv);

  const subs = await listSubscriptions();
  if (subs.length === 0) return { sent: 0, failed: 0 };

  const payload = JSON.stringify({
    title: ev.title,
    body: ev.body,
    tag: ev.tag,
    url: ev.url ?? "/",
  });

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await removeSubscription(sub.endpoint).catch(() => undefined);
        }
      }
    }),
  );
  return { sent, failed };
}
