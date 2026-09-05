import type { Classification, Sighting } from "./types";

export function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(d);
}

export function formatDuration(sec: number | null) {
  if (sec === null) return "Unknown";
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 120) return `${m} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export function classLabel(c: Classification) {
  switch (c) {
    case "likely-prosaic":
      return "Likely prosaic";
    case "sensor-contact":
      return "Sensor contact";
    case "anomalous":
      return "Anomalous";
    default:
      return "Unidentified";
  }
}

export function classTone(c: Classification): "default" | "live" | "watch" | "alert" {
  if (c === "anomalous") return "alert";
  if (c === "sensor-contact") return "live";
  if (c === "unidentified") return "watch";
  return "default";
}

export function coords(s: Pick<Sighting, "lat" | "lng">) {
  const ns = s.lat >= 0 ? "N" : "S";
  const ew = s.lng >= 0 ? "E" : "W";
  return `${Math.abs(s.lat).toFixed(2)}°${ns}  ${Math.abs(s.lng).toFixed(2)}°${ew}`;
}
