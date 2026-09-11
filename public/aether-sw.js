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
  let data = { title: "AETHER", body: "Live alert", tag: "aether", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* ignore malformed payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url || "/" },
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
          if ("navigate" in c && typeof c.navigate === "function") {
            try {
              return c.navigate(target).then(() => c.focus());
            } catch {
              /* fall through */
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
