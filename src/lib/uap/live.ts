import { createServerFn } from "@tanstack/react-start";
import { detectionsFromBalloons, fetchBalloons, balloonsNear } from "./balloons";
import { camerasNear, snapshotFor } from "./cameras";
import { haversineKm } from "./geo";
import {
  buildHypotheses,
  dedupeContacts,
  detectionsFromAircraft,
  nearestAircraft,
  residualScore,
} from "./infer";
import { fetchSatellites, satellitesOver } from "./satellites";
import { skyBodiesAt, visibleSky } from "./sky";
import {
  aircraftNear,
  fetchFireballs,
  fetchIss,
  fetchSocial,
  fetchSolarFlare,
  fetchSpaceWeather,
  fetchWeather,
  health,
  sampleAircraft,
} from "./streams";
import { allVerdicts, attachVerdicts, compactContact, sweepContacts } from "./live-sensor";
import { buildSafetyNotes } from "./safety";
import type { Contact, LivePicture, LiveTrackOptics, StreamHealth, WatchContext } from "./types";

function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export async function buildLivePicture(): Promise<LivePicture> {
  const [adsbR, fireR, issR, swR, socialR, balloonR, satR, flareR] = await Promise.allSettled([
    sampleAircraft(),
    fetchFireballs(),
    fetchIss(),
    fetchSpaceWeather(),
    fetchSocial(),
    fetchBalloons(),
    fetchSatellites(),
    fetchSolarFlare(),
  ]);

  const adsb = settled(adsbR, { aircraft: [], ok: false, detail: "timeout" });
  const fireballs = settled(fireR, [] as Contact[]);
  const iss = settled(issR, null);
  const sw = settled(swR, { kp: 0, kpLabel: "Kp unavailable", aurora: "quiet" as const });
  const social = settled(socialR, [] as Contact[]);
  const balloons = settled(balloonR, []);
  const satellites = settled(satR, []);
  const flare = settled(flareR, null);

  const balloonDetections = detectionsFromBalloons(balloons);

  const streams: StreamHealth[] = [
    health("adsb", "ADS-B", adsb.ok, adsb.detail, adsb.aircraft.length),
    health(
      "cneos",
      "CNEOS fireballs",
      fireR.status === "fulfilled",
      fireR.status === "fulfilled" ? `${fireballs.length} bolides` : "timeout",
      fireballs.length,
    ),
    health(
      "iss",
      "Orbiting stations",
      Boolean(iss) || satellites.length > 0,
      iss
        ? `ISS ${iss.lat.toFixed(1)}°, ${iss.lng.toFixed(1)}° · ${satellites.length} TLEs`
        : satellites.length
          ? `${satellites.length} TLEs`
          : "timeout",
      satellites.length,
    ),
    health("swpc", "SWPC", swR.status === "fulfilled", flare ? `${sw.kpLabel} · ${flare.class}` : sw.kpLabel),
    health(
      "news",
      "Open news",
      social.length > 0,
      social.length > 0 ? `${social.length} items` : "no items",
      social.length,
    ),
    health(
      "balloons",
      "SondeHub",
      balloons.length > 0,
      balloons.length > 0 ? `${balloons.length} sondes` : "no telemetry",
      balloons.length,
    ),
    health("optical", "Public optics", true, "Visual · GOES IR · wildfire PTZ · 511"),
  ];

  const detections = attachVerdicts(
    dedupeContacts([
      ...detectionsFromAircraft(adsb.aircraft),
      ...fireballs,
      ...social,
      ...balloonDetections,
    ]),
  );
  const verdicts = allVerdicts().filter((v) => detections.some((d) => d.id === v.contactId));
  streams.push(
    health(
      "live-ai",
      "Live AI",
      Boolean(process.env.XAI_API_KEY),
      process.env.XAI_API_KEY
        ? verdicts.length
          ? `${verdicts.length} scored`
          : "armed"
        : "key missing",
      verdicts.length,
    ),
  );

  return {
    fetchedAt: new Date().toISOString(),
    detections,
    aircraft: adsb.aircraft.filter((a) => (a.altFt ?? 0) > 200).slice(0, 420),
    balloons: balloons.filter((b) => b.altM > 8000).slice(0, 80),
    satellites,
    iss,
    spaceWeather: sw,
    flare,
    streams,
    verdicts,
  };
}

export const getLivePicture = createServerFn({ method: "GET" }).handler(
  async (): Promise<LivePicture> => buildLivePicture(),
);

export const sweepLiveSensors = createServerFn({ method: "POST" })
  .validator((input: { items: ReturnType<typeof compactContact>[] }) => input)
  .handler(async ({ data }) => sweepContacts(data.items.slice(0, 8)));

export const liveOpticsForTracks = createServerFn({ method: "POST" })
  .validator((input: { items: ReturnType<typeof compactContact>[] }) => input)
  .handler(async ({ data }): Promise<LiveTrackOptics[]> => {
    const ranked = [...data.items]
      .sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0))
      .slice(0, 6);
    return Promise.all(
      ranked.map(async (c) => {
        const optics = await camerasNear(c.lat, c.lng, c.altitudeM).catch(() => ({
          ground: [],
          space: [],
          total: 0,
        }));
        return {
          contactId: c.id,
          label: c.locationLabel,
          lat: c.lat,
          lng: c.lng,
          residual: c.residual,
          cameras: optics.ground.slice(0, 4),
          satelliteViews: optics.space.slice(0, 2),
        };
      }),
    );
  });

export const getWatchContext = createServerFn({ method: "POST" })
  .validator(
    (input: {
      lat: number;
      lng: number;
      altM?: number | null;
      source?: string;
      classification?: string;
      shape?: string;
      speedKts?: number | null;
      headingDeg?: number | null;
      verticalFpm?: number | null;
      durationSec?: number | null;
      summary?: string;
      locationLabel?: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<WatchContext> => {
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    const altM = data.altM ?? null;
    const [optics, localAc, iss, weather, sw, balloons, sats, flare] = await Promise.all([
      camerasNear(lat, lng, altM).catch(() => ({ ground: [], space: [], total: 0 })),
      aircraftNear(lat, lng, 90).catch(() => []),
      fetchIss().catch(() => null),
      fetchWeather(lat, lng),
      fetchSpaceWeather(),
      fetchBalloons().then((list) => balloonsNear(list, lat, lng, 140)).catch(() => []),
      satellitesOver(lat, lng).catch(() => []),
      fetchSolarFlare(),
    ]);
    const aircraft = nearestAircraft(localAc, lat, lng, 14);
    const issDist = iss ? haversineKm(iss.lat, iss.lng, lat, lng) : null;
    const sky = visibleSky(skyBodiesAt(lat, lng), 3);
    const contact = {
      source: (data.source as Contact["source"]) ?? "sensor",
      classification: (data.classification as Contact["classification"]) ?? "unidentified",
      altitudeM: altM,
      speedKts: data.speedKts ?? null,
      headingDeg: data.headingDeg ?? null,
      verticalFpm: data.verticalFpm ?? null,
      reasons: [] as string[],
      shape: (data.shape as Contact["shape"]) ?? "unknown",
      durationSec: data.durationSec ?? null,
      summary: data.summary ?? "",
      liveVerdict: null,
      locationLabel: data.locationLabel ?? "",
      lat,
      lng,
    };
    const hypotheses = buildHypotheses({
      contact,
      aircraft,
      balloons,
      satellites: sats,
      sky,
      issDistKm: issDist,
      weather,
      spaceWeather: sw,
      cameraCount: optics.total || optics.ground.length,
      lat,
      lng,
    });
    const safety = buildSafetyNotes({ contact, aircraft, weather });
    return {
      cameras: optics.ground,
      cameraTotal: optics.total || optics.ground.length,
      aircraft,
      balloons,
      satellites: sats,
      skyBodies: sky,
      iss: iss && issDist !== null ? { ...iss, distKm: issDist } : null,
      weather,
      spaceWeather: sw,
      flare,
      hypotheses,
      residual: residualScore(hypotheses),
      satelliteViews: optics.space,
      safety,
    };
  });

export const getCameraFrame = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    try {
      const snap = await snapshotFor(data.id);
      if (!snap) return { ok: false as const, error: "No frame" };
      return { ok: true as const, mime: snap.mime, b64: snap.b64 };
    } catch {
      return { ok: false as const, error: "Frame unavailable" };
    }
  });
