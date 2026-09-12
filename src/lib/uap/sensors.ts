export const SENSOR_TYPES = [
  "radar",
  "optical",
  "infrared",
  "space-ir",
  "rf",
  "acoustic",
  "multi",
] as const;

export type SensorType = (typeof SENSOR_TYPES)[number];

export const SENSOR_META: Record<SensorType, { label: string; short: string; hint: string }> = {
  radar: {
    label: "Radar",
    short: "RAD",
    hint: "Primary, secondary, weather, or fire-control radar",
  },
  optical: {
    label: "EO / visible",
    short: "EO",
    hint: "Daylight cameras, eyewitness optics, film",
  },
  infrared: {
    label: "IR / thermal",
    short: "IR",
    hint: "Airborne or ground FLIR / thermal imagers",
  },
  "space-ir": {
    label: "Space-based IR",
    short: "SBIRS",
    hint: "DSP / SBIRS / USG space infrared (bolides)",
  },
  rf: {
    label: "RF / EM",
    short: "RF",
    hint: "Radio, SIGINT, magnetometer, EM anomalies",
  },
  acoustic: {
    label: "Acoustic",
    short: "ACO",
    hint: "Infrasound, hydrophone, or sonic track",
  },
  multi: {
    label: "Multi-sensor",
    short: "FUS",
    hint: "Fused radar + EO/IR or other cross-cued suite",
  },
};

export function isSensorType(v: string): v is SensorType {
  return (SENSOR_TYPES as readonly string[]).includes(v);
}

export function inferSensor(input: {
  source?: string;
  summary?: string;
  shape?: string;
}): SensorType {
  if (input.source === "live") return "space-ir";
  const t = `${input.summary ?? ""}`.toLowerCase();
  const hits: SensorType[] = [];
  if (/radar|lock-on|awacs|norad|iff|transponder|an\/spy|multi-static/.test(t)) hits.push("radar");
  if (/\bflir\b|infrared|thermal|\bir\b|dhs infrared/.test(t)) hits.push("infrared");
  if (/space-based|sbirs|\bdsp\b|bolide|usg sensor/.test(t)) hits.push("space-ir");
  if (/radio|rf\b|sigint|electromagnetic|magnetometer|avionics/.test(t)) hits.push("rf");
  if (/infrasound|hydrophone|sonar|sonic|acoustic/.test(t)) hits.push("acoustic");
  if (/camera|photographed|film|optical|eyewitness|witness|tower personnel|students/.test(t)) {
    hits.push("optical");
  }
  const uniq = [...new Set(hits)];
  if (uniq.length >= 2) return "multi";
  if (uniq[0]) return uniq[0];
  if (input.source === "sensor") return "radar";
  return "optical";
}
