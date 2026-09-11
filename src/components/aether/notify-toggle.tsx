import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { armNativePush, disableWebPush, webPushStatus, type WebPushStatus } from "@/lib/uap/alerts";
import { cn } from "@/lib/utils";

export function NotifyToggle({ className }: { className?: string }) {
  const [status, setStatus] = useState<WebPushStatus>("unsupported");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await webPushStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (status === "subscribed") {
        const next = await disableWebPush();
        setStatus(next);
        toast.message("Phone alerts off");
        return;
      }
      if (status === "denied") {
        toast.error("Notifications blocked — enable them in browser settings");
        return;
      }
      if (status === "unsupported") {
        toast.error("Web Push needs a modern browser (or Add to Home Screen on iPhone)");
        return;
      }
      const next = await armNativePush();
      setStatus(next);
      if (next === "subscribed") toast.success("24/7 phone alerts armed");
      else if (next === "denied") toast.error("Notification permission denied");
      else if (next === "unsupported") toast.error("Push subscription unavailable");
      else toast.message("Permission granted — finish opt-in if prompted");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const on = status === "subscribed";
  const label =
    status === "subscribed"
      ? "Alerts on"
      : status === "denied"
        ? "Blocked"
        : status === "unsupported"
          ? "No push"
          : "Alerts";

  const Icon = on ? BellRing : status === "denied" || status === "unsupported" ? BellOff : Bell;

  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "default" : "secondary"}
      className={cn(className)}
      disabled={busy}
      onClick={() => void onToggle()}
      aria-pressed={on}
      title="Opt in to 24/7 Web Push alerts on this device"
    >
      <Icon className="size-3.5" />
      {busy ? "…" : label}
    </Button>
  );
}
