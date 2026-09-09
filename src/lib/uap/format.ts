import type { Classification, Contact, Source } from "./types";

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

export function sourceLabel(s: Source) {
  switch (s) {
    case "adsb":
      return "ADS-B residual";
    case "fireball":
      return "CNEOS fireball";
    case "social":
      return "Open news";
    case "optical":
      return "Optical";
    case "field-report":
      return "Field report";
    case "sensor":
      return "Sensor";
    case "balloon":
      return "Radiosonde";
    case "satellite":
      return "Satellite";
    default:
      return "Archive";
  }
}

export function coords(s: Pick<Contact, "lat" | "lng">) {
  const ns = s.lat >= 0 ? "N" : "S";
  const ew = s.lng >= 0 ? "E" : "W";
  return `${Math.abs(s.lat).toFixed(2)}°${ns}  ${Math.abs(s.lng).toFixed(2)}°${ew}`;
}

export function kmLabel(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

const CARDINAL = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function formatHeading(deg: number | null | undefined) {
  if (deg == null || !Number.isFinite(deg)) return null;
  const wrapped = ((deg % 360) + 360) % 360;
  const i = Math.round(wrapped / 22.5) % 16;
  return `${Math.round(wrapped)}° ${CARDINAL[i]}`;
}

export function formatSpeed(kts: number | null | undefined) {
  if (kts == null || !Number.isFinite(kts)) return null;
  const ms = kts * 0.514444;
  if (ms >= 800) return `${(ms / 1000).toFixed(1)} km/s`;
  const kmh = kts * 1.852;
  return `${Math.round(kts)} kts · ${Math.round(kmh)} km/h`;
}

export function formatVertical(fpm: number | null | undefined) {
  if (fpm == null || !Number.isFinite(fpm)) return null;
  const ms = fpm * 0.00508;
  const dir = fpm > 40 ? "climbing" : fpm < -40 ? "descending" : "level";
  return `${Math.round(fpm)} fpm ${dir} · ${ms.toFixed(1)} m/s`;
}
