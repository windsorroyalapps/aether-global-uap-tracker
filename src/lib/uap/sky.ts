import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";
import type { SkyBody } from "./types";

const BODIES: { body: Body; name: string }[] = [
  { body: Body.Sun, name: "Sun" },
  { body: Body.Moon, name: "Moon" },
  { body: Body.Venus, name: "Venus" },
  { body: Body.Jupiter, name: "Jupiter" },
  { body: Body.Mars, name: "Mars" },
  { body: Body.Saturn, name: "Saturn" },
];

export function skyBodiesAt(lat: number, lng: number, when = new Date()): SkyBody[] {
  try {
    const time = MakeTime(when);
    const observer = new Observer(lat, lng, 0);
    const out: SkyBody[] = [];
    for (const { body, name } of BODIES) {
      const eq = Equator(body, time, observer, true, true);
      const hor = Horizon(time, observer, eq.ra, eq.dec, "normal");
      if (!Number.isFinite(hor.azimuth) || !Number.isFinite(hor.altitude)) continue;
      out.push({ name, az: hor.azimuth, el: hor.altitude });
    }
    return out.sort((a, b) => b.el - a.el);
  } catch {
    return [];
  }
}

export function visibleSky(bodies: SkyBody[], minEl = 4) {
  return bodies.filter((b) => b.el >= minEl);
}
