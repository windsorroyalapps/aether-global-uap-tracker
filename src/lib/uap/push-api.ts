import { createServerFn } from "@tanstack/react-start";

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
