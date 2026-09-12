import { SHAPES, type ReportInput } from "./types";
import { isSensorType } from "./sensors";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function parseReport(input: ReportInput): ReportInput {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
  const locationLabel = input.locationLabel.trim().slice(0, 80);
  if (locationLabel.length < 2) throw new Error("Add a location label.");
  const region = input.region.trim().slice(0, 40) || "Unspecified";
  const summary = input.summary.trim().slice(0, 800);
  if (summary.length < 24) {
    throw new Error("Describe the contact in at least a sentence.");
  }
  if (!SHAPES.includes(input.shape)) throw new Error("Unknown shape.");
  const sensorType = isSensorType(input.sensorType) ? input.sensorType : "optical";
  const durationSec =
    input.durationSec === null || input.durationSec === undefined
      ? null
      : clamp(Math.round(Number(input.durationSec)), 1, 86400);
  const occurredAt = input.occurredAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Invalid time.");
  const callsign = (input.callsign ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);
  const stamped = callsign.length > 0 ? `[${callsign}] ${summary}` : summary;
  return {
    lat,
    lng,
    locationLabel,
    region,
    occurredAt,
    shape: input.shape,
    durationSec,
    summary: stamped,
    callsign,
    sensorType,
  };
}
