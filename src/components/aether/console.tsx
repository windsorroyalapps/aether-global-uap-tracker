import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Crosshair, Radar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Globe } from "@/components/aether/globe";
import { FloorPanel } from "@/components/aether/floor";
import { InspectPanel } from "@/components/aether/inspect";
import {
  ElevatedRail,
  LiveSensorRail,
  StreamRail,
  Stat,
  Feed,
} from "@/components/aether/console-rails";
import { BriefingPanel, ReportForm } from "@/components/aether/console-rails-more";
import { LiveOpticsStrip } from "@/components/aether/optics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLivePicture, getWatchContext, liveOpticsForTracks, sweepLiveSensors } from "@/lib/uap/live";
import { compactContact } from "@/lib/uap/live-sensor";
import { listSightings } from "@/lib/uap/queries";
import { listQueue } from "@/lib/uap/archive";
import {
  classifyAlert,
  pageNative,
  shouldPage,
  ensureServiceWorker,
  enablePushNotifications,
  disablePushNotifications,
  isPushOptedIn,
  tabHidden,
} from "@/lib/uap/alerts";
import { notifyLiveContacts } from "@/lib/uap/push-api";
import { dutyReviewPending } from "@/lib/uap/ensemble";
import { asContact } from "@/lib/uap/types";
import type { Classification, Contact, LiveVerdict, Sighting, Source } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

type Panel = "feed" | "optical" | "report" | "floor" | "brief";
type Epoch = "all" | "live" | "archive";

type Layers = {
  traffic: boolean;
  sondes: boolean;
  sats: boolean;
  optics: boolean;
  archive: boolean;
};

const LAYERS_KEY = "aether-layers-v1";
const DEFAULT_LAYERS: Layers = {
  traffic: false,
  sondes: true,
  sats: true,
  optics: true,
  archive: true,
};

function loadLayers(): Layers {
  if (typeof window === "undefined") return DEFAULT_LAYERS;
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (!raw) return DEFAULT_LAYERS;
    const parsed = JSON.parse(raw) as Partial<Layers>;
    return { ...DEFAULT_LAYERS, ...parsed };
  } catch {
    return DEFAULT_LAYERS;
  }
}

const NO_OVERLAY: { lat: number; lng: number }[] = [];

const LAYER_TOGGLES: { key: keyof Layers; label: string }[] = [
  { key: "traffic", label: "ADS-B" },
  { key: "sondes", label: "Sondes" },
  { key: "sats", label: "Sats" },
  { key: "optics", label: "Optics" },
  { key: "archive", label: "Archive" },
];

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
    refetchInterval: 45_000,
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
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    setLayers(loadLayers());
  }, []);

  const setLayer = useCallback((key: keyof Layers, value: boolean) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

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
    enabled: layers.optics && liveDetections.length > 0,
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

  const globeContacts = useMemo(() => {
    const base =
      !layers.archive && epoch === "all"
        ? filtered.filter((c) => c.live)
        : filtered;
    return base.slice(0, 60);
  }, [filtered, layers.archive, epoch]);

  const selected = contacts.find((s) => s.id === selectedId) ?? null;
  const autoOpened = useRef<Set<number>>(new Set());
  const notifiedPushIds = useRef<Set<number>>(new Set());
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
    setPushOn(isPushOptedIn());
    void ensureServiceWorker();
  }, []);

  const togglePush = useCallback(async () => {
    setPushBusy(true);
    try {
      if (pushOn) {
        const res = await disablePushNotifications();
        if (res.ok) {
          setPushOn(false);
          toast.message("Alerts off");
        } else toast.error(`Could not disable alerts: ${res.error}`);
      } else {
        const res = await enablePushNotifications();
        if (res.ok) {
          setPushOn(true);
          toast.success("Alerts on — closed-app push armed");
        } else if (res.error === "no-vapid") {
          toast.error("Push not configured (missing VAPID keys on server)");
        } else if (res.error === "permission-denied") {
          toast.error("Notification permission denied");
        } else {
          toast.error(`Could not enable alerts: ${res.error}`);
        }
      }
    } finally {
      setPushBusy(false);
    }
  }, [pushOn]);

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
    const fresh = contacts
      .filter((c) => c.live && !notifiedPushIds.current.has(c.id))
      .filter((c) => {
        const ev = classifyAlert(c);
        return ev.tier === "candidate" || ev.tier === "elevated";
      })
      .slice(0, 8);
    if (fresh.length === 0) return;
    for (const c of fresh) notifiedPushIds.current.add(c.id);
    void notifyLiveContacts({
      data: {
        items: fresh.map((c) => ({
          id: c.id,
          locationLabel: c.locationLabel,
          residual: c.residual ?? c.confidence,
          confidence: c.confidence,
          classification: c.classification,
          source: c.source,
          lat: c.lat,
          lng: c.lng,
          shape: c.shape,
          summary: c.summary.slice(0, 500),
          reasons: c.reasons ?? [],
          durationSec: c.durationSec,
          altitudeM: c.altitudeM ?? null,
          speedKts: c.speedKts ?? null,
          headingDeg: c.headingDeg ?? null,
          verticalFpm: c.verticalFpm ?? null,
          liveVerdict: c.liveVerdict ?? null,
        })),
      },
    }).catch(() => undefined);
  }, [contacts]);

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
    if (!layers.optics) return NO_OVERLAY;
    const m = new Map<string, { lat: number; lng: number }>();
    for (const t of liveOptics.data ?? []) {
      for (const c of [...t.cameras, ...t.satelliteViews]) {
        if (c.kind === "space") continue;
        m.set(c.id, { lat: c.lat, lng: c.lng });
      }
    }
    for (const c of watch.data?.cameras ?? []) m.set(c.id, { lat: c.lat, lng: c.lng });
    return [...m.values()];
  }, [layers.optics, liveOptics.data, watch.data?.cameras]);

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
            variant={pushOn ? "default" : "secondary"}
            size="sm"
            disabled={pushBusy}
            onClick={() => void togglePush()}
          >
            {pushOn ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
            {pushOn ? "Alerts on" : "Enable alerts"}
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
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 sm:px-4">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Layers
        </span>
        {LAYER_TOGGLES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setLayer(key, !layers[key])}
            className={cn(
              "h-7 rounded-full border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              layers[key]
                ? "border-accent/40 bg-raised text-fg"
                : "border-border text-muted hover:text-fg",
            )}
            aria-pressed={layers[key]}
          >
            {label}
          </button>
        ))}
      </div>
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
      {layers.optics ? (
        <LiveOpticsStrip
          tracks={liveOptics.data ?? []}
          pending={liveOptics.isFetching && !(liveOptics.data && liveOptics.data.length > 0)}
          onOpen={(id) => {
            setSelectedId(id);
            setPanel("optical");
          }}
        />
      ) : (
        <div className="border-b border-border bg-surface px-3 py-2 sm:px-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Optics layer off
          </p>
        </div>
      )}

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
              contacts={globeContacts}
              selectedId={selected?.id ?? null}
              onSelect={onGlobeSelect}
              pickMode={pickMode}
              onPick={onPick}
              aircraft={layers.traffic ? (live.data?.aircraft ?? NO_OVERLAY) : NO_OVERLAY}
              balloons={layers.sondes ? (live.data?.balloons ?? NO_OVERLAY) : NO_OVERLAY}
              satellites={layers.sats ? (live.data?.satellites ?? NO_OVERLAY) : NO_OVERLAY}
              iss={layers.sats ? (live.data?.iss ?? null) : null}
              cameras={overlayCameras}
              showTraffic={layers.traffic}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 sm:p-4">
            <p className="pointer-events-auto rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {pickMode ? "Tap globe to lock coordinates" : "Tap a plot to inspect"}
            </p>
            <p className="rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {layers.sats && live.data?.iss
                ? `ISS ${live.data.iss.lat.toFixed(1)}°, ${live.data.iss.lng.toFixed(1)}°`
                : layers.sats
                  ? "ISS acquiring"
                  : "Sats off"}
              {layers.sondes && live.data?.balloons?.length
                ? ` · ${live.data.balloons.length} sondes`
                : ""}
              {layers.optics && overlayCameras.length
                ? ` · ${overlayCameras.length} cams`
                : ""}
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
