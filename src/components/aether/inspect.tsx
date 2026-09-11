import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OpticalPanel } from "@/components/aether/optics";
import { Badge } from "@/components/ui/badge";
import {
  coords,
  formatHeading,
  formatSpeed,
  formatVertical,
  formatWhen,
  sourceLabel,
} from "@/lib/uap/format";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import { detectionNotes } from "@/lib/uap/detect";
import { analyzeContact, analyzeLiveEvent, fileUapAssessment } from "@/lib/uap/analyze";
import { ensembleAnalyze, type ProviderKeys } from "@/lib/uap/ensemble";
import { formatDec, formatRa, skyOrigin } from "@/lib/uap/origin";
import type { Analysis, Contact } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

const filed = new Set<number>();

export function InspectPanel({ contact }: { contact: Contact | null }) {
  if (!contact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center px-5 py-10">
        <p className="font-display text-base font-semibold">Inspect a contact</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Tap a plot on the globe. Optics, kinematics, sky radiant, and any filed report open here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Kinematics contact={contact} />
      <OriginCard contact={contact} />
      <AutoReport contact={contact} />
      <div className="border-t border-border">
        <OpticalPanel contact={contact} hideHeader />
      </div>
    </div>
  );
}

function Kinematics({ contact }: { contact: Contact }) {
  const chance = uapProbability(contact);
  const candidate = isUapCandidate(contact);
  const heading = formatHeading(contact.headingDeg);
  const speed = formatSpeed(contact.speedKts);
  const vertical = formatVertical(contact.verticalFpm);
  const notes = detectionNotes(contact);
  return (
    <div className="space-y-3 p-4 pb-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("font-display text-base font-semibold leading-snug", candidate && "text-candidate")}>
            {contact.locationLabel}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {coords(contact)}  |  {sourceLabel(contact.source)}  |  {formatWhen(contact.occurredAt)}
          </p>
        </div>
        {candidate ? (
          <Badge variant="candidate">{chance}% UAP</Badge>
        ) : (
          <Badge variant="solid">{chance}% residual</Badge>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric label="Heading" value={heading ?? "No track"} />
        <Metric label="Velocity" value={speed ?? "Unknown"} />
        <Metric label="Vertical" value={vertical ?? "Unknown"} />
      </dl>
      {contact.altitudeM != null && (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          Altitude {(contact.altitudeM / 1000).toFixed(contact.altitudeM > 2000 ? 1 : 2)} km
        </p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n) => (
            <li key={n} className="text-xs leading-relaxed text-muted">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-0.5 text-sm tabular-nums text-fg">{value}</p>
    </div>
  );
}

function OriginCard({ contact }: { contact: Contact }) {
  const origin = useMemo(() => skyOrigin(contact), [contact]);
  const n = origin.nearest;
  return (
    <div className="mx-4 mb-2 rounded-xl border border-border bg-bg p-3">
      <div className="flex items-start gap-3">
        <RadiantDial az={origin.radiantAz} el={origin.radiantEl} heading={origin.headingDeg} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Incoming from space  |  reverse track
          </p>
          {n && origin.raHours != null && origin.decDeg != null ? (
            <>
              <p className="mt-1 text-sm font-medium text-fg">
                Nearest {n.kind === "star" ? "star" : n.kind === "center" ? "structure" : "galaxy"}: {n.name}
              </p>
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
                RA {formatRa(origin.raHours)}  |  Dec {formatDec(origin.decDeg)}  |  {n.sepDeg.toFixed(1)} deg off
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {n.note}. Radiant az {origin.radiantAz?.toFixed(0)} deg / el {origin.radiantEl?.toFixed(0)} deg. {origin.note}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{origin.note}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RadiantDial({
  az,
  el,
  heading,
}: {
  az: number | null;
  el: number | null;
  heading: number | null;
}) {
  const r = 38;
  const toXY = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [r + Math.cos(a) * rad, r + Math.sin(a) * rad];
  };
  const inbound = az != null ? toXY(az, r * 0.72) : null;
  const track = heading != null ? toXY(heading, r * 0.55) : null;
  return (
    <svg viewBox="0 0 76 76" className="size-[76px] shrink-0 text-muted" aria-hidden>
      <circle cx={r} cy={r} r={r - 1.5} fill="none" stroke="currentColor" strokeOpacity={0.35} />
      <circle cx={r} cy={r} r={r * 0.45} fill="none" stroke="currentColor" strokeOpacity={0.2} />
      <text x={r} y={11} textAnchor="middle" className="fill-muted" fontSize={8}>
        N
      </text>
      {track && (
        <line
          x1={r}
          y1={r}
          x2={track[0]}
          y2={track[1]}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeOpacity={0.55}
        />
      )}
      {inbound && (
        <line
          x1={inbound[0]}
          y1={inbound[1]}
          x2={r}
          y2={r}
          className="stroke-candidate"
          strokeWidth={2}
          markerEnd="url(#in)"
        />
      )}
      <defs>
        <marker id="in" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" className="fill-candidate" />
        </marker>
      </defs>
      <circle cx={r} cy={r} r={2.2} className="fill-fg" />
      {el != null && (
        <text x={r} y={70} textAnchor="middle" className="fill-candidate" fontSize={8}>
          {Math.round(el)} deg el
        </text>
      )}
    </svg>
  );
}

function AutoReport({ contact }: { contact: Contact }) {
  const qc = useQueryClient();
  const chance = uapProbability(contact);
  const candidate = isUapCandidate(contact);
  const origin = useMemo(() => skyOrigin(contact), [contact]);
  const liveHit = contact.liveVerdict ?? null;

  const originLine =
    origin.nearest && origin.raHours != null
      ? `${origin.nearest.name} (${origin.nearest.kind}) ${origin.nearest.sepDeg.toFixed(1)} deg from radiant RA ${formatRa(origin.raHours)} Dec ${formatDec(origin.decDeg ?? 0)}`
      : origin.note;

  const run = useMutation({
    mutationFn: async (): Promise<Analysis> => {
      if (!contact.live && contact.id > 0) {
        const res = await analyzeContact({ data: { id: contact.id } });
        if ("error" in res) throw new Error(res.error);
        return res;
      }
      let keys: ProviderKeys = {};
      try {
        keys = JSON.parse(localStorage.getItem("aether-ai-keys") ?? "{}") as ProviderKeys;
      } catch {
        keys = {};
      }
      const extra = [...(contact.reasons ?? []), ...detectionNotes(contact), originLine].join("; ");
      const ens = await ensembleAnalyze({
        data: {
          summary: contact.summary,
          lat: contact.lat,
          lng: contact.lng,
          locationLabel: contact.locationLabel,
          region: contact.region,
          source: contact.source,
          classification: contact.classification,
          extra,
          keys,
        },
      });
      if (!("error" in ens)) {
        const res: Analysis = {
          id: 0,
          sightingId: contact.id,
          assessment: ens.assessment,
          likelyOrigin: ens.likelyOrigin,
          threat: ens.threat as Analysis["threat"],
          createdAt: new Date().toISOString(),
        };
        if (candidate && !filed.has(contact.id)) {
          const filedRes = await fileUapAssessment({
            data: {
              lat: contact.lat,
              lng: contact.lng,
              locationLabel: contact.locationLabel,
              region: contact.region,
              summary: `${contact.summary}\n\nEnsemble: ${res.assessment}\nRadiant: ${originLine}`,
              shape: contact.shape,
              source: contact.source,
              confidence: chance,
              assessment: res.assessment,
              likelyOrigin: res.likelyOrigin,
              threat: res.threat,
            },
          });
          if (!("error" in filedRes)) {
            filed.add(contact.id);
            void qc.invalidateQueries({ queryKey: ["sightings"] });
          }
        }
        return res;
      }
      const res = await analyzeLiveEvent({
        data: {
          label: contact.locationLabel,
          lat: contact.lat,
          lng: contact.lng,
          summary: contact.summary,
          source: contact.source,
          residual: chance,
          fusion: (contact.reasons ?? []).join("; "),
          heading: formatHeading(contact.headingDeg),
          speed: formatSpeed(contact.speedKts),
          vertical: formatVertical(contact.verticalFpm),
          origin: originLine,
        },
      });
      if ("error" in res) throw new Error(res.error);
      if (candidate && !filed.has(contact.id)) {
        const filedRes = await fileUapAssessment({
          data: {
            lat: contact.lat,
            lng: contact.lng,
            locationLabel: contact.locationLabel,
            region: contact.region,
            summary: `${contact.summary}\n\nAI: ${res.assessment}\nRadiant: ${originLine}`,
            shape: contact.shape,
            source: contact.source,
            confidence: chance,
            assessment: res.assessment,
            likelyOrigin: res.likelyOrigin,
            threat: res.threat,
          },
        });
        if (!("error" in filedRes)) {
          filed.add(contact.id);
          void qc.invalidateQueries({ queryKey: ["sightings"] });
        }
      }
      return res;
    },
    onError: (err: Error) => {
      if (/unavailable/i.test(err.message)) return;
      toast.error(err.message || "Assessment failed.");
    },
  });

  // Keep live-path filing for uap-candidate hits; do NOT auto-run ensemble/AI on open.
  useEffect(() => {
    if (!liveHit) return;
    if (liveHit.verdict !== "uap-candidate" || filed.has(contact.id)) return;
    void fileUapAssessment({
      data: {
        lat: contact.lat,
        lng: contact.lng,
        locationLabel: contact.locationLabel,
        region: contact.region,
        summary: `${contact.summary}\n\nLIVE AI: ${liveHit.assessment}\nOptical: ${liveHit.opticalNotes}`,
        shape: contact.shape,
        source: contact.source,
        confidence: liveHit.confidence,
        assessment: liveHit.assessment,
        likelyOrigin: liveHit.likelyOrigin,
        threat: liveHit.threat,
      },
    }).then((res) => {
      if (res && !("error" in res)) {
        filed.add(contact.id);
        void qc.invalidateQueries({ queryKey: ["sightings"] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, liveHit?.verdict, liveHit?.at]);

  const result = liveHit
    ? {
        assessment: liveHit.assessment,
        likelyOrigin: liveHit.likelyOrigin,
        threat: liveHit.threat,
      }
    : run.data;
  const pending = !liveHit && run.isPending;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {candidate ? "Auto-filed UAP assessment" : "AI assessment"}
        {liveHit ? "  |  live optical" : ""}
        {result ? `  |  ${result.threat}` : pending ? "  |  running" : ""}
      </p>
      {pending && !result && <div className="mt-2 h-8 rounded-md scan-shimmer" />}
      {result && (
        <>
          <p className="mt-1 text-sm text-fg">{result.likelyOrigin}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{result.assessment}</p>
          {liveHit?.opticalNotes ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">Optics: {liveHit.opticalNotes}</p>
          ) : null}
          {candidate && filed.has(contact.id) && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-candidate">
              Filed to the global picture
            </p>
          )}
        </>
      )}
      {!pending && !result && (
        run.isError ? (
          <p className="mt-2 text-sm text-muted">Assessment unavailable in this environment.</p>
        ) : (
          <button
            type="button"
            className="mt-2 inline-flex h-9 items-center rounded-md border border-border bg-bg px-3 text-sm text-fg hover:bg-raised"
            onClick={() => run.mutate()}
          >
            Run assessment
          </button>
        )
      )}
    </div>
  );
}
