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
    refetchIntervalInBackground: false,
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
    enabled: liveDetections.length > 0 && panel !== "optical",
    queryFn: () =>
      sweepLiveSensors({
        data: { items: liveDetections.slice(0, 4).map(compactContact) },
      }),
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
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
    refetchInterval: false,
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
    refetchIntervalInBackground: false,
  });
  const duty = useQuery({
    queryKey: ["duty-review"],
    queryFn: () => dutyReviewPending(),
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
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
