export const CITIES: { name: string; lat: number; lng: number; aliases?: string[] }[] = [
  { name: "Los Angeles", lat: 34.05, lng: -118.24, aliases: ["LA", "LAX", "San Diego", "Orange County"] },
  { name: "San Francisco", lat: 37.77, lng: -122.42, aliases: ["Bay Area", "Oakland", "San Jose"] },
  { name: "New York", lat: 40.71, lng: -74.01, aliases: ["NYC", "Manhattan", "Brooklyn", "Queens"] },
  { name: "Chicago", lat: 41.88, lng: -87.63 },
  { name: "Phoenix", lat: 33.45, lng: -112.07 },
  { name: "Houston", lat: 29.76, lng: -95.37 },
  { name: "Dallas", lat: 32.78, lng: -96.8 },
  { name: "Denver", lat: 39.74, lng: -104.99 },
  { name: "Seattle", lat: 47.61, lng: -122.33 },
  { name: "Miami", lat: 25.76, lng: -80.19 },
  { name: "Atlanta", lat: 33.75, lng: -84.39 },
  { name: "Boston", lat: 42.36, lng: -71.06 },
  { name: "Washington", lat: 38.91, lng: -77.04, aliases: ["DC", "D.C."] },
  { name: "Las Vegas", lat: 36.17, lng: -115.14 },
  { name: "Portland", lat: 45.52, lng: -122.68 },
  { name: "Honolulu", lat: 21.31, lng: -157.86, aliases: ["Oahu", "Hawaii"] },
  { name: "Anchorage", lat: 61.22, lng: -149.9, aliases: ["Alaska"] },
  { name: "Toronto", lat: 43.65, lng: -79.38 },
  { name: "Vancouver", lat: 49.28, lng: -123.12 },
  { name: "Montreal", lat: 45.5, lng: -73.57 },
  { name: "Mexico City", lat: 19.43, lng: -99.13 },
  { name: "London", lat: 51.51, lng: -0.13 },
  { name: "Manchester", lat: 53.48, lng: -2.24 },
  { name: "Paris", lat: 48.86, lng: 2.35 },
  { name: "Berlin", lat: 52.52, lng: 13.4 },
  { name: "Rome", lat: 41.9, lng: 12.5 },
  { name: "Madrid", lat: 40.42, lng: -3.7 },
  { name: "Amsterdam", lat: 52.37, lng: 4.89 },
  { name: "Stockholm", lat: 59.33, lng: 18.07 },
  { name: "Oslo", lat: 59.91, lng: 10.75 },
  { name: "Reykjavik", lat: 64.15, lng: -21.94, aliases: ["Iceland"] },
  { name: "Moscow", lat: 55.76, lng: 37.62 },
  { name: "Istanbul", lat: 41.01, lng: 28.98 },
  { name: "Cairo", lat: 30.04, lng: 31.24 },
  { name: "Johannesburg", lat: -26.2, lng: 28.04 },
  { name: "Cape Town", lat: -33.92, lng: 18.42 },
  { name: "Nairobi", lat: -1.29, lng: 36.82 },
  { name: "Dubai", lat: 25.2, lng: 55.27 },
  { name: "Tehran", lat: 35.69, lng: 51.39 },
  { name: "Mumbai", lat: 19.08, lng: 72.88 },
  { name: "Delhi", lat: 28.61, lng: 77.21, aliases: ["New Delhi"] },
  { name: "Bangkok", lat: 13.76, lng: 100.5 },
  { name: "Singapore", lat: 1.35, lng: 103.82 },
  { name: "Jakarta", lat: -6.21, lng: 106.85 },
  { name: "Hong Kong", lat: 22.32, lng: 114.17 },
  { name: "Tokyo", lat: 35.68, lng: 139.76 },
  { name: "Osaka", lat: 34.69, lng: 135.5 },
  { name: "Seoul", lat: 37.57, lng: 126.98 },
  { name: "Beijing", lat: 39.9, lng: 116.4 },
  { name: "Shanghai", lat: 31.23, lng: 121.47 },
  { name: "Sydney", lat: -33.87, lng: 151.21 },
  { name: "Melbourne", lat: -37.81, lng: 144.96 },
  { name: "Auckland", lat: -36.85, lng: 174.76 },
  { name: "Sao Paulo", lat: -23.55, lng: -46.63 },
  { name: "Rio de Janeiro", lat: -22.91, lng: -43.17, aliases: ["Rio"] },
  { name: "Buenos Aires", lat: -34.6, lng: -58.38 },
  { name: "Santiago", lat: -33.45, lng: -70.67 },
  { name: "Lima", lat: -12.05, lng: -77.04 },
  { name: "Phoenix", lat: 33.45, lng: -112.07 },
  { name: "Socorro", lat: 34.06, lng: -106.89 },
  { name: "Roswell", lat: 33.39, lng: -104.52 },
  { name: "Area 51", lat: 37.24, lng: -115.81, aliases: ["Groom Lake", "Rachel Nevada"] },
  { name: "Catalina", lat: 33.38, lng: -118.42 },
  { name: "O'Hare", lat: 41.98, lng: -87.91, aliases: ["OHare"] },
];

export function geoparse(text: string) {
  const t = text.toLowerCase();
  let best: { name: string; lat: number; lng: number; idx: number } | null = null;
  for (const c of CITIES) {
    const names = [c.name, ...(c.aliases ?? [])];
    for (const n of names) {
      const idx = t.indexOf(n.toLowerCase());
      if (idx >= 0 && (!best || n.length > best.name.length)) {
        best = { name: c.name, lat: c.lat, lng: c.lng, idx };
      }
    }
  }
  return best;
}
