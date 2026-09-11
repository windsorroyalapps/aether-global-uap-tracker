self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.kind !== "notify") return;
  event.waitUntil(
    self.registration.showNotification(d.title || "AETHER", {
      body: d.body || "",
      tag: d.tag || "aether",
      silent: Boolean(d.silent),
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "AETHER",
    body: "Live residual alert",
    tag: "aether",
    url: "/",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch {
      /* ignore */
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "AETHER", {
      body: payload.body || "",
      tag: payload.tag || "aether",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          if ("navigate" in c && target) {
            try {
              return c.focus().then(() => c.navigate(target));
            } catch {
              return c.focus();
            }
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
