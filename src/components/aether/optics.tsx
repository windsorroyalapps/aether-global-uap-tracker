import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ExternalLink, Plane, Satellite } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { kmLabel } from "@/lib/uap/format";
import { getCameraFrame, getWatchContext } from "@/lib/uap/live";
import type { CameraHit, Contact } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

export function OpticalPanel({ contact }: { contact: Contact | null }) {
  const ctx = useQuery({
    queryKey: ["watch", contact?.id],
    enabled: Boolean(contact),
    queryFn: () =>
      getWatchContext({
        data: {
          lat: contact!.lat,
          lng: contact!.lng,
          altM: contact!.altitudeM ?? null,
          source: contact!.source,
          classification: contact!.classification,
          shape: contact!.shape,
        },
      }),
  });
  const [onlyFacing, setOnlyFacing] = useState(false);
  const [onlySky, setOnlySky] = useState(false);

  const cams = useMemo(() => {
    const list = ctx.data?.cameras ?? [];
    return list.filter((c) => {
      if (onlyFacing && !c.facing) return false;
      if (onlySky && c.kind !== "sky" && c.kind !== "airport") return false;
      return true;
    });
  }, [ctx.data?.cameras, onlyFacing, onlySky]);

  if (!contact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 px-5 py-10">
        <p className="font-display text-base font-semibold">Public optical net</p>
        <p className="text-sm leading-relaxed text-muted">
          Select a contact to pull every official public camera that could see it — wildfire PTZ,
          DOT 511, airport approaches, and geostationary imagery. Private CCTV is never accessed.
        </p>
      </div>
    );
  }

  if (ctx.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-10 rounded-md scan-shimmer" />
        <div className="grid grid-cols-2 gap-2">
          <div className="aspect-video rounded-lg bg-raised" />
          <div className="aspect-video rounded-lg bg-raised" />
        </div>
      </div>
    );
  }

  if (ctx.isError || !ctx.data) {
    return <p className="px-4 py-8 text-sm text-muted">Optical correlators failed to load.</p>;
  }

  const data = ctx.data;
  const sky = data.skyBodies.filter((b) => b.el > 5);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div>
        <p className="font-display text-base font-semibold leading-snug">{contact.locationLabel}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          Residual {data.residual}% · {data.cameraTotal} cameras in range · {data.aircraft.length}{" "}
          tracks · {data.balloons.length} sondes
        </p>
      </div>

      <div className="rounded-xl border border-border bg-bg p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          Fusion hypotheses
        </p>
        <ul className="mt-2 space-y-2">
          {data.hypotheses.map((h) => (
            <li key={h.label} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-fg">{h.label}</p>
                <p className="text-xs leading-relaxed text-muted">{h.note}</p>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-muted">{h.weight}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        {data.iss && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <Satellite className="size-3.5 text-accent" />
            <p className="text-sm text-muted">
              ISS {kmLabel(data.iss.distKm)} from plot · {data.iss.altKm.toFixed(0)} km alt
            </p>
          </div>
        )}
        {data.satellites.length > 0 && (
          <ul className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11px] text-muted">
            {data.satellites.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-0.5">
                <span className="truncate text-fg">{s.name}</span>
                <span className="tabular-nums">
                  el {s.el?.toFixed(0) ?? "—"}° · {s.rangeKm ? `${Math.round(s.rangeKm)} km` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {sky.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            Sky {sky.map((b) => `${b.name} ${b.el.toFixed(0)}°`).join(" · ")}
          </p>
        )}
        {data.weather && (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            Cloud {data.weather.cloudCover ?? "—"}%
            {data.weather.visibilityKm != null
              ? ` · vis ${data.weather.visibilityKm.toFixed(0)} km`
              : ""}{" "}
            · {data.spaceWeather.kpLabel}
            {data.flare ? ` · X-ray ${data.flare.class}` : ""}
          </p>
        )}
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Ground cameras with a possible view
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setOnlyFacing((v) => !v)}
              className={cn(
                "h-8 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.12em]",
                onlyFacing ? "border-accent/40 bg-raised text-fg" : "border-border text-muted",
              )}
            >
              Facing
            </button>
            <button
              type="button"
              onClick={() => setOnlySky((v) => !v)}
              className={cn(
                "h-8 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.12em]",
                onlySky ? "border-accent/40 bg-raised text-fg" : "border-border text-muted",
              )}
            >
              Sky
            </button>
          </div>
        </div>
        {data.cameras.length === 0 ? (
          <p className="text-sm text-muted">
            No official public cameras in optical range. Geostationary frames still apply.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted">
              Showing {cams.length} of {data.cameraTotal} in range. Official public feeds only.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cams.map((cam) => (
                <CameraCard key={cam.id} cam={cam} />
              ))}
            </div>
          </>
        )}
      </section>

      {data.satelliteViews.length > 0 && (
        <section>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Wide-field satellite
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.satelliteViews.map((cam) => (
              <CameraCard key={cam.id} cam={cam} />
            ))}
          </div>
        </section>
      )}

      {data.balloons.length > 0 && (
        <section>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Radiosondes in the box
          </p>
          <ul className="space-y-1">
            {data.balloons.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted"
              >
                <span className="truncate text-fg">{b.name}</span>
                <span className="tabular-nums">
                  {(b.altM / 1000).toFixed(1)} km · {b.kind ?? "sonde"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.aircraft.length > 0 && (
        <section>
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <Plane className="size-3" /> Nearby ADS-B
          </p>
          <ul className="space-y-1">
            {data.aircraft.slice(0, 8).map((a) => (
              <li
                key={a.hex}
                className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted"
              >
                <span className="truncate text-fg">{a.callsign}</span>
                <span className="tabular-nums">
                  {a.altFt ?? "—"} ft · {a.gsKts ?? "—"} kts
                  {a.mil ? " · MIL" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CameraCard({ cam }: { cam: CameraHit }) {
  const frame = useQuery({
    queryKey: ["frame", cam.id],
    queryFn: () => getCameraFrame({ data: { id: cam.id } }),
    staleTime: 20_000,
  });
  const src =
    frame.data && frame.data.ok ? `data:${frame.data.mime};base64,${frame.data.b64}` : null;

  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-raised">
      <div className="relative aspect-video bg-bg">
        {src ? (
          <img src={src} alt={cam.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center gap-2 text-xs text-muted">
            <Camera className="size-3.5" />
            {frame.isLoading ? "Acquiring frame…" : "Frame unavailable"}
          </div>
        )}
      </div>
      <figcaption className="space-y-1 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium leading-snug">{cam.name}</p>
          {cam.facing ? <Badge variant="live">Facing</Badge> : <Badge>Oblique</Badge>}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {cam.network} · {kmLabel(cam.distanceKm)} · el {cam.elevationDeg.toFixed(0)}° · {cam.kind}
        </p>
        {cam.pageUrl && (
          <a
            href={cam.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            Open source feed <ExternalLink className="size-3" />
          </a>
        )}
      </figcaption>
    </figure>
  );
}
