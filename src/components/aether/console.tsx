import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Crosshair,
  Filter,
  Globe2,
  MapPin,
  Radar,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Globe } from "@/components/aether/globe";
import { FloorPanel } from "@/components/aether/floor";
import { InspectPanel } from "@/components/aether/inspect";
import { LiveOpticsStrip } from "@/components/aether/optics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { analyzeContact, analyzeLiveEvent, generateBriefing, getAnalysis } from "@/lib/uap/analyze";
import {
  classLabel,
  classTone,
  coords,
  formatDuration,
  formatWhen,
  sourceLabel,
} from "@/lib/uap/format";
import { getLivePicture, getWatchContext, liveOpticsForTracks, sweepLiveSensors } from "@/lib/uap/live";
import { compactContact } from "@/lib/uap/live-sensor";
import { fileReport, listSightings } from "@/lib/uap/queries";
import { listQueue } from "@/lib/uap/archive";
import { classifyAlert, pageNative, shouldPage, armNativePush, tabHidden, type AlertEvent } from "@/lib/uap/alerts";
import { dutyReviewPending } from "@/lib/uap/ensemble";
import { asContact, CLASSIFICATIONS, SHAPES, SOURCES } from "@/lib/uap/types";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import type { Classification, Contact, LiveVerdict, Shape, Sighting, Source, StreamHealth } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

type Panel = "feed" | "optical" | "report" | "floor" | "brief";
type Epoch = "all" | "live" | "archive";

const NO_OVERLAY: { lat: number; lng: number }[] = [];

export function Console({ initial }: { initial: Sighting[] }) {
  const qc = useQueryClient();
  const sightings = useQuery({
    queryKey: ["sightings"],
    queryFn: () => listSightings(),
    initialData: initial,
  });
  const live = useQuery({
    queryKey: ["live"],
    queryFn: () => getLivePicture(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: 20_000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState<Classification | "all">("all");
  const [source, setSource] = useState<Source | "all">("all");
  const [epoch, setEpoch] = useState<Epoch>("all");
  const [panel, setPanel] = useState<Panel>("feed");
  const [pickMode, setPickMode] = useState(false);
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);
  const [showTraffic, setShowTraffic] = useState(false);

  const archive = useMemo(
    () => (sightings.data ?? []).map((s) => asContact(s)),
    [sightings.data],
  );
  const liveDetections = live.data?.detections ?? [];
  const sweep = useQuery({
    queryKey: ["live-sweep"],
    enabled: liveDetections.length > 0,
    queryFn: () =>
      sweepLiveSensors({
        data: { items: liveDetections.slice(0, 4).map(compactContact) },
      }),
    refetchInterval: 45_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
    retry: 0,
  });
  const liveOptics = useQuery({
    queryKey: ["live-optics"],
    enabled: liveDetections.length > 0 && panel === "optical",
    queryFn: () =>
      liveOpticsForTracks({
        data: { items: liveDetections.slice(0, 2).map(compactContact) },
      }),
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    retry: 0,
  });
  const verdictById = useMemo(() => {
    const m = new Map<number, LiveVerdict>();
    for (const v of live.data?.verdicts ?? []) m.set(v.contactId, v);
    for (const v of sweep.data ?? []) m.set(v.contactId, v);
    return m;
  }, [live.data?.verdicts, sweep.data]);
  const contacts = useMemo(() => {
    const merged = [...liveDetections, ...archive];
    const seen = new Set<number>();
    const out: Contact[] = [];
    for (const c of merged) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const v = verdictById.get(c.id);
      out.push(v ? { ...c, liveVerdict: v } : c);
    }
    return out;
  }, [archive, liveDetections, verdictById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((s) => {
      if (klass !== "all" && s.classification !== klass) return false;
      if (source !== "all" && s.source !== source) return false;
      if (epoch === "live" && !s.live) return false;
      if (epoch === "archive" && s.live) return false;
      if (!q) return true;
      return (
        s.locationLabel.toLowerCase().includes(q) ||
        s.region.toLowerCase().includes(q) ||
        s.shape.includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.source.includes(q)
      );
    });
  }, [contacts, klass, query, epoch, source]);

  const selected = contacts.find((s) => s.id === selectedId) ?? null;
  const autoOpened = useRef<Set<number>>(new Set());
  const queue = useQuery({
    queryKey: ["queue"],
    queryFn: () => listQueue(),
    refetchInterval: 45_000,
    refetchIntervalInBackground: true,
  });
  const duty = useQuery({
    queryKey: ["duty-review"],
    queryFn: () => dutyReviewPending(),
    refetchInterval: 90_000,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    void armNativePush();
  }, []);

  const alerts = useMemo(
    () => contacts.filter((c) => c.live).map(classifyAlert),
    [contacts],
  );
  const elevated = alerts.filter((a) => a.tier === "elevated");
  const pendingN = (queue.data ?? []).filter((s) => s.reviewStatus === "pending").length;

  const alertSig = alerts.map((a) => `${a.contactId}:${a.tier}`).join("|");
  useEffect(() => {
    const hidden = tabHidden();
    let first = true;
    for (const ev of alerts) {
      if (!shouldPage(ev)) continue;
      if (hidden || ev.tier === "elevated") pageNative(ev);
      if (hidden) continue;
      if (ev.tier === "elevated") {
        toast.error(`Elevated · ${ev.label}`, { description: ev.reason });
        if (first) {
          first = false;
          setSelectedId(ev.contactId);
        }
      } else if (ev.tier === "candidate") {
        toast(`Candidate · ${ev.label}`, { description: ev.reason });
      }
    }
    // keyed by alertSig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertSig]);

  useEffect(() => {
    if (!duty.data?.reviewed || !duty.data.label) return;
    const hidden = tabHidden();
    const body = `AI sealed ${duty.data.label}`;
    if (hidden) {
      pageNative({
        contactId: duty.data.reviewed,
        label: duty.data.label,
        tier: "watch",
        reason: "duty AI review",
        key: `duty:${duty.data.reviewed}`,
        residual: 0,
      });
    } else {
      toast.success(body);
    }
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["sightings"] });
  }, [duty.data?.reviewed, duty.data?.label, qc]);

  useEffect(() => {
    const liveIds = new Set(liveDetections.map((d) => d.id));
    const flagged = [...verdictById.values()].find(
      (v) => v.verdict === "uap-candidate" && !autoOpened.current.has(v.contactId) && liveIds.has(v.contactId),
    );
    if (!flagged) return;
    autoOpened.current.add(flagged.contactId);
    toast(`UAP candidate · ${flagged.likelyOrigin}`);
  }, [liveDetections, verdictById]);

  const stats = useMemo(() => {
    const anomalous = contacts.filter((s) => s.classification === "anomalous").length;
    const liveN = contacts.filter((s) => s.live).length;
    const avg =
      contacts.length === 0
        ? 0
        : Math.round(contacts.reduce((a, s) => a + s.confidence, 0) / contacts.length);
    return { total: contacts.length, anomalous, liveN, avg };
  }, [contacts]);

  const watch = useQuery({
    queryKey: ["watch", selected?.id],
    enabled: Boolean(selected) && panel === "optical",
    queryFn: () =>
      getWatchContext({
        data: {
          lat: selected!.lat,
          lng: selected!.lng,
          altM: selected!.altitudeM ?? null,
          source: selected!.source,
          classification: selected!.classification,
          shape: selected!.shape,
          speedKts: selected!.speedKts ?? null,
          headingDeg: selected!.headingDeg ?? null,
          verticalFpm: selected!.verticalFpm ?? null,
          durationSec: selected!.durationSec,
          summary: selected!.summary,
          locationLabel: selected!.locationLabel,
        },
      }),
    staleTime: 18_000,
  });

  const overlayCameras = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>();
    for (const t of liveOptics.data ?? []) {
      for (const c of [...t.cameras, ...t.satelliteViews]) {
        if (c.kind === "space") continue;
        m.set(c.id, { lat: c.lat, lng: c.lng });
      }
    }
    for (const c of watch.data?.cameras ?? []) m.set(c.id, { lat: c.lat, lng: c.lng });
    return [...m.values()];
  }, [liveOptics.data, watch.data?.cameras]);

  const onPick = useCallback((lat: number, lng: number) => {
    setPick({ lat, lng });
    setPickMode(false);
    setPanel("report");
    toast("Coordinates locked from globe");
  }, []);
  const onGlobeSelect = useCallback((id: number) => {
    setSelectedId(id);
    setPanel("optical");
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface">
            <Radar className="size-4 text-accent" />
          </span>
          <div>
            <p className="font-display text-lg font-semibold leading-tight tracking-[-0.03em]">
              AETHER
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Global UAP Detection
            </p>
          </div>
        </div>
        <Badge variant="live" className="ml-1">
          <span className="mr-1.5 size-1.5 rounded-full bg-signal pulse-live" />
          {live.isFetching ? "Syncing" : "Live fusion"}
        </Badge>
        {elevated.length > 0 && (
          <Badge variant="alert">{elevated.length} elevated</Badge>
        )}
        <Badge variant="live">Duty 24/7</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant={showTraffic ? "default" : "secondary"}
            size="sm"
            onClick={() => setShowTraffic((v) => !v)}
          >
            ADS-B layer
          </Button>
          <Button
            variant={panel === "brief" ? "default" : "secondary"}
            size="sm"
            onClick={() => setPanel("brief")}
          >
            <Sparkles className="size-3.5" />
            Briefing
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setPanel("report");
              setPickMode(true);
            }}
          >
            <Crosshair className="size-3.5" />
            File contact
          </Button>
        </div>
      </header>

      <StreamRail streams={live.data?.streams ?? []} />
      <LiveSensorRail
        verdicts={[...verdictById.values()]}
        pending={sweep.isFetching}
        onOpen={(id) => {
          setSelectedId(id);
          setPanel("optical");
        }}
      />
      <ElevatedRail
        events={elevated}
        onOpen={(id) => {
          setSelectedId(id);
          setPanel("optical");
        }}
      />
      <LiveOpticsStrip
        tracks={liveOptics.data ?? []}
        pending={liveOptics.isFetching && !(liveOptics.data && liveOptics.data.length > 0)}
        onOpen={(id) => {
          setSelectedId(id);
          setPanel("optical");
        }}
      />

      <section className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Stat label="Fused contacts" value={stats.total} />
        <Stat label="Live residuals" value={stats.liveN} />
        <Stat label="Anomalous" value={stats.anomalous} />
        <Stat label="Mean confidence" value={`${stats.avg}%`} />
      </section>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-[42vh] flex-1 bg-bg lg:min-h-0">
          {sightings.isError ? (
            <div className="flex h-full min-h-[42vh] items-center justify-center px-6 text-center text-sm text-muted">
              Network picture failed to load. Reload the console.
            </div>
          ) : (
            <Globe
              contacts={filtered.slice(0, 80)}
              selectedId={selected?.id ?? null}
              onSelect={onGlobeSelect}
              pickMode={pickMode}
              onPick={onPick}
              aircraft={showTraffic ? (live.data?.aircraft ?? NO_OVERLAY) : NO_OVERLAY}
              balloons={live.data?.balloons ?? NO_OVERLAY}
              satellites={live.data?.satellites ?? NO_OVERLAY}
              iss={live.data?.iss ?? null}
              cameras={overlayCameras}
              showTraffic={showTraffic}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 sm:p-4">
            <p className="pointer-events-auto rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {pickMode ? "Tap globe to lock coordinates" : "Tap a plot to inspect"}
            </p>
            <p className="rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {live.data?.iss
                ? `ISS ${live.data.iss.lat.toFixed(1)}°, ${live.data.iss.lng.toFixed(1)}°`
                : "ISS acquiring"}
              {live.data?.balloons?.length ? ` · ${live.data.balloons.length} sondes` : ""}
              {overlayCameras.length ? ` · ${overlayCameras.length} cams` : ""}
            </p>
          </div>
        </section>

        <aside className="flex w-full flex-col border-t border-border bg-surface lg:w-[420px] lg:border-t-0 lg:border-l">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2">
            {(
              [
                ["feed", "Contacts"],
                ["optical", "Inspect"],
                ["report", "Report"],
                ["floor", "Floor"],
                ["brief", "Intel"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={cn(
                  "h-10 min-w-16 flex-1 rounded-md px-2 text-xs font-medium transition-colors duration-150",
                  panel === id ? "bg-raised text-fg" : "text-muted hover:text-fg",
                )}
              >
                {label}
                {id === "floor" && elevated.length > 0 && (
                  <span className="ml-1 font-mono text-[10px] text-alert">{elevated.length}</span>
                )}
                {id === "floor" && pendingN > 0 && (
                  <span className="ml-1 font-mono text-[10px] text-watch">{pendingN}</span>
                )}
              </button>
            ))}
          </div>

          {panel === "feed" && (
            <Feed
              filtered={filtered}
              query={query}
              setQuery={setQuery}
              klass={klass}
              setKlass={setKlass}
              source={source}
              setSource={setSource}
              epoch={epoch}
              setEpoch={setEpoch}
              selected={selected}
              onSelect={(id) => {
                setSelectedId(id);
                setPanel("optical");
              }}
              onOpenOptics={() => setPanel("optical")}
            />
          )}
          {panel === "optical" && <InspectPanel contact={selected} />}
          {panel === "report" && (
            <ReportForm
              pick={pick}
              pickMode={pickMode}
              setPickMode={setPickMode}
              onFiled={() => {
                void qc.invalidateQueries({ queryKey: ["sightings"] });
                void qc.invalidateQueries({ queryKey: ["queue"] });
                setPick(null);
                setPanel("floor");
              }}
            />
          )}
          {panel === "brief" && <BriefingPanel />}
          {panel === "floor" && <FloorPanel />}
        </aside>
      </div>
    </div>
  );
}

function ElevatedRail({
  events,
  onOpen,
}: {
  events: AlertEvent[];
  onOpen: (id: number) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border bg-bg px-3 py-2 sm:px-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-alert">
        <span className="size-1.5 rounded-full bg-alert pulse-live" />
        Elevated
      </span>
      {events.map((ev) => (
        <button
          key={`${ev.contactId}:${ev.key}`}
          type="button"
          onClick={() => onOpen(ev.contactId)}
          className="inline-flex h-8 max-w-[280px] shrink-0 items-center gap-1.5 rounded-full border border-alert/40 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg"
        >
          <span className="truncate text-alert">{ev.label}</span>
          <span className="truncate text-muted">{ev.reason}</span>
        </button>
      ))}
    </div>
  );
}

function LiveSensorRail({
  verdicts,
  pending,
  onOpen,
}: {
  verdicts: LiveVerdict[];
  pending: boolean;
  onOpen: (id: number) => void;
}) {
  const ranked = [...verdicts].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border bg-bg px-3 py-2 sm:px-4">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        <span
          className={
            pending ? "size-1.5 rounded-full bg-candidate pulse-live" : "size-1.5 rounded-full bg-signal"
          }
        />
        {pending ? "Live AI scoring optics…" : "Live AI"}
      </span>
      {ranked.length === 0 && !pending && (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
          Waiting for residual contacts
        </span>
      )}
      {ranked.slice(0, 8).map((v) => (
        <button
          key={v.contactId}
          type="button"
          onClick={() => onOpen(v.contactId)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg"
        >
          <span
            className={
              v.verdict === "uap-candidate"
                ? "size-1.5 rounded-full bg-candidate"
                : v.verdict === "prosaic"
                  ? "size-1.5 rounded-full bg-muted"
                  : "size-1.5 rounded-full bg-watch"
            }
          />
          <span className={v.verdict === "uap-candidate" ? "text-candidate" : "text-muted"}>
            {v.verdict === "uap-candidate" ? "UAP" : v.verdict}
          </span>
          <span className="max-w-[140px] truncate text-fg">{v.likelyOrigin}</span>
          <span className="text-muted">
            {v.framesUsed} {v.spectra.includes("infrared") ? "IR" : "vis"}
          </span>
        </button>
      ))}
    </div>
  );
}

function StreamRail({ streams }: { streams: StreamHealth[] }) {
  if (streams.length === 0) {
    return (
      <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Acquiring live streams…
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2 sm:px-4">
      {streams.map((s) => (
        <span
          key={s.id}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
          title={s.detail}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              s.ok ? "bg-signal pulse-live" : "bg-alert",
            )}
          />
          <span className="text-muted">{s.label}</span>
          <span className="text-fg">{s.ok ? s.detail : "down"}</span>
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg px-4 py-3 sm:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Feed({
  filtered,
  query,
  setQuery,
  klass,
  setKlass,
  source,
  setSource,
  epoch,
  setEpoch,
  selected,
  onSelect,
  onOpenOptics,
}: {
  filtered: Contact[];
  query: string;
  setQuery: (v: string) => void;
  klass: Classification | "all";
  setKlass: (v: Classification | "all") => void;
  source: Source | "all";
  setSource: (v: Source | "all") => void;
  epoch: Epoch;
  setEpoch: (v: Epoch) => void;
  selected: Contact | null;
  onSelect: (id: number) => void;
  onOpenOptics: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 p-3">
        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search region, shape, stream"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "live", "archive"] as const).map((e) => (
            <Chip key={e} active={epoch === e} onClick={() => setEpoch(e)}>
              {e === "all" ? "All epochs" : e === "live" ? "Live" : "Archive"}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={klass === "all"} onClick={() => setKlass("all")}>
            All classes
          </Chip>
          {CLASSIFICATIONS.map((c) => (
            <Chip key={c} active={klass === c} onClick={() => setKlass(c)}>
              {classLabel(c)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={source === "all"} onClick={() => setSource("all")}>
            All streams
          </Chip>
          {SOURCES.filter((s) => s !== "optical").map((s) => (
            <Chip key={s} active={source === s} onClick={() => setSource(s)}>
              {sourceLabel(s)}
            </Chip>
          ))}
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted">No contacts match this filter.</p>
        ) : (
          filtered.slice(0, 80).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors duration-150",
                selected?.id === s.id ? "bg-raised" : "hover:bg-raised/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm font-medium", isUapCandidate(s) && "text-candidate")}>
                  {s.locationLabel}
                </span>
                {isUapCandidate(s) ? (
                  <Badge variant="candidate">{uapProbability(s)}% UAP</Badge>
                ) : (
                  <Badge variant={classTone(s.classification)}>{classLabel(s.classification)}</Badge>
                )}
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {s.live ? "Live" : "File"} · {sourceLabel(s.source)} · {s.region} · {formatWhen(s.occurredAt)}
              </p>
            </button>
          ))
        )}
      </div>
      {selected && <Detail key={selected.id} contact={selected} onOpenOptics={onOpenOptics} />}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150",
        active ? "border-accent/40 bg-raised text-fg" : "border-border text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Detail({ contact, onOpenOptics }: { contact: Contact; onOpenOptics: () => void }) {
  const analysis = useQuery({
    queryKey: ["analysis", contact.id],
    enabled: !contact.live,
    queryFn: () => getAnalysis({ data: { id: contact.id } }),
  });
  const [liveResult, setLiveResult] = useState<(typeof analysis.data) | null>(null);
  const run = useMutation({
    mutationFn: () =>
      contact.live
        ? analyzeLiveEvent({
            data: {
              label: contact.locationLabel,
              lat: contact.lat,
              lng: contact.lng,
              summary: contact.summary,
              source: contact.source,
              residual: contact.residual ?? null,
              fusion: (contact.reasons ?? []).join("; "),
            },
          })
        : analyzeContact({ data: { id: contact.id } }),
    onSuccess: (res) => {
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      if (contact.live) setLiveResult(res);
      else void analysis.refetch();
    },
    onError: () => toast.error("Assessment failed."),
  });

  const result = contact.live ? liveResult : analysis.data;
  const pending = run.isPending;

  return (
    <div className="border-t border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold leading-snug">{contact.locationLabel}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {coords(contact)} · {formatDuration(contact.durationSec)} · {sourceLabel(contact.source)}
          </p>
        </div>
        {isUapCandidate(contact) ? (
          <Badge variant="candidate">{uapProbability(contact)}% UAP</Badge>
        ) : (
          <Badge variant="solid">{contact.confidence}% conf</Badge>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{contact.summary}</p>
      {contact.reasons && contact.reasons.length > 0 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-watch">
          {contact.reasons.join(" · ")}
        </p>
      )}
      <Button variant="secondary" className="mt-3 w-full" onClick={onOpenOptics}>
        Nearby cameras and correlators
      </Button>
      <div className="mt-4">
        {result && !("error" in result) ? (
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              AI assessment · {result.threat}
            </p>
            <p className="mt-1 text-sm text-fg">{result.likelyOrigin}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{result.assessment}</p>
          </div>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={() => run.mutate()}
          >
            <Sparkles className="size-3.5" />
            {pending ? "Running assessment…" : "Run AI assessment"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReportForm({
  pick,
  pickMode,
  setPickMode,
  onFiled,
}: {
  pick: { lat: number; lng: number } | null;
  pickMode: boolean;
  setPickMode: (v: boolean) => void;
  onFiled: (s: Sighting) => void;
}) {
  const [lat, setLat] = useState(pick?.lat.toFixed(3) ?? "");
  const [lng, setLng] = useState(pick?.lng.toFixed(3) ?? "");
  const [locationLabel, setLocationLabel] = useState("");
  const [region, setRegion] = useState("Unspecified");
  const [shape, setShape] = useState<Shape>("unknown");
  const [duration, setDuration] = useState("");
  const [summary, setSummary] = useState("");
  const [callsign, setCallsign] = useState("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 16));

  useEffect(() => {
    if (!pick) return;
    setLat(pick.lat.toFixed(3));
    setLng(pick.lng.toFixed(3));
  }, [pick]);

  const mut = useMutation({
    mutationFn: () =>
      fileReport({
        data: {
          lat: Number(lat),
          lng: Number(lng),
          locationLabel,
          region,
          occurredAt: new Date(when).toISOString(),
          shape,
          durationSec: duration ? Number(duration) : null,
          summary,
          callsign,
        },
      }),
    onSuccess: (s) => {
      toast.success("Sealed pending review — nothing deleted");
      onFiled(s);
    },
    onError: (err: Error) => toast.error(err.message || "Could not file contact."),
  });

  return (
    <form
      className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <p className="text-sm text-muted">
        Sealed on ingest — nothing is deleted. Globe plot only after AI or administrator review. No
        names, emails, or private addresses.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Longitude">
          <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" required />
        </Field>
      </div>
      <Button
        type="button"
        variant={pickMode ? "default" : "secondary"}
        className="w-full"
        onClick={() => setPickMode(!pickMode)}
      >
        <Globe2 className="size-3.5" />
        {pickMode ? "Picking on globe…" : "Pick on globe"}
      </Button>
      <Field label="Location label">
        <Input
          value={locationLabel}
          onChange={(e) => setLocationLabel(e.target.value)}
          placeholder="City, range, or body of water"
          required
        />
      </Field>
      <Field label="Region">
        <Input value={region} onChange={(e) => setRegion(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shape">
          <select
            value={shape}
            onChange={(e) => setShape(e.target.value as Shape)}
            className="flex h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg"
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration (sec)">
          <Input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            inputMode="numeric"
            placeholder="Optional"
          />
        </Field>
      </div>
      <Field label="Observed (local)">
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Station ID (optional)">
        <Input
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="e.g. FIELD-7"
          maxLength={16}
        />
      </Field>
      <Field label="Narrative">
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What was seen, how it moved, sensors involved."
          required
        />
      </Field>
      <Button type="submit" className="w-full" disabled={mut.isPending}>
        <MapPin className="size-3.5" />
        {mut.isPending ? "Filing…" : "File to network"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function BriefingPanel() {
  const [text, setText] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => generateBriefing(),
    onSuccess: (res) => {
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setText(res.text);
    },
    onError: () => toast.error("Briefing failed."),
  });

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-sm leading-relaxed text-muted">
        Grok reads the live fusion picture plus the latest files on the board. Run it when you want
        a synthesis — it is not generated automatically.
      </p>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>
        <Activity className="size-3.5" />
        {mut.isPending ? "Composing…" : text ? "Refresh briefing" : "Generate global briefing"}
      </Button>
      {mut.isPending && <div className="h-10 rounded-md scan-shimmer" />}
      {text && (
        <div className="rounded-xl border border-border bg-bg p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{text}</p>
        </div>
      )}
    </div>
  );
}
