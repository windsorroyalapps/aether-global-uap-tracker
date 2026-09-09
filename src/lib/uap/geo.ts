export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function angularDiff(a: number, b: number) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

export function horizonKm(heightM: number) {
  return 3.57 * Math.sqrt(Math.max(0, heightM));
}

/** Geometric elevation of a target above the local horizon, with Earth curvature. */
export function elevationToTarget(
  fromLat: number,
  fromLng: number,
  fromAltM: number,
  toLat: number,
  toLng: number,
  toAltM: number,
) {
  const distM = haversineKm(fromLat, fromLng, toLat, toLng) * 1000;
  if (distM < 8) return 90;
  const curve = (distM * distM) / (2 * 6_371_000);
  const dAlt = toAltM - fromAltM - curve;
  return (Math.atan2(dAlt, distM) * 180) / Math.PI;
}

export function opticalRangeKm(camAltM: number, targetAltM: number) {
  return horizonKm(Math.max(camAltM, 8)) + horizonKm(Math.max(targetAltM, 80));
}

export function regionOf(lat: number, lng: number) {
  if (lat <= -60) return "Antarctica";
  if (lat >= 66) return "Arctic";
  if (lng >= -30 && lng <= 50 && lat >= 35) return "Europe";
  if (lng >= -30 && lng <= 55 && lat < 35 && lat >= -35) return "Africa";
  if (lng > 50 && lng < 100 && lat > 10) return "South Asia";
  if (lng >= 100 && lng < 150 && lat > 20) return "East Asia";
  if (lng >= 90 && lng < 155 && lat <= 20 && lat >= -15) return "Southeast Asia";
  if (lng >= 110 && lat < -10) return "Oceania";
  if (lng >= 30 && lng < 110 && lat > 35) return "North Asia";
  if (lng < -30 && lng > -80 && lat < 15 && lat > -60) return "South America";
  if (lng <= -80 && lat < 15 && lat > -60) return "South America";
  if (lng < -25 && lat >= 15) return "North America";
  if (lng > 20 && lng < 80 && lat < 10) return "Indian Ocean";
  return "Pacific";
}

export function hashId(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = h | 0;
  return n === 0 ? -1 : n > 0 ? -n : n;
}

export function inBBox(
  lat: number,
  lng: number,
  box: [number, number, number, number],
  padKm = 0,
) {
  const padDeg = padKm / 111;
  return lat >= box[0] - padDeg && lat <= box[2] + padDeg && lng >= box[1] - padDeg && lng <= box[3] + padDeg;
}
