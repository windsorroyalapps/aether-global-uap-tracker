import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Globe } from "@/components/aether/globe";
import { LiveFeed } from "@/components/aether/live-feed";
import { SpectraStrip } from "@/components/aether/spectra-strip";
import { analyzeContact, assessUnscoredLive, generateBriefing, getAnalysis } from "@/lib/uap/analyze";
import { getCrossFix } from "@/lib/uap/crossfix";
import { loadGlobeTexture, SAT_MODES, SAT_LAYER_META, type SatMode } from "@/lib/uap/globe-tex";
import { globalUapIndex, primaryInbound, skyLine } from "@/lib/uap/sky";
import { classLabel, classTone, coords, formatDuration, formatWhen, sensorLabel, sensorShort, uapTone } from "@/lib/uap/format";
import { SENSOR_META, SENSOR_TYPES, type SensorType } from "@/lib/uap/sensors";
import { fileReport, listSightings } from "@/lib/uap/queries";
import { CLASSIFICATIONS, SHAPES, type Classification, type Shape, type Sighting } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

type Panel = "feed" | "report" | "brief";
type Klass = Classification | "all" | "live";

export function Console({ initial }: { initial: Sighting[] }) {
  const qc = useQueryClient();
  const sightings = useQuery({
    queryKey: ["sightings"],
    queryFn: () => listSightings(),
    initialData: initial,
    refetchInterval: 180_000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState<Klass>("all");
  const [sensor, setSensor] = useState<SensorType | "all">("all");
  const [hideLowBolides, setHideLowBolides] = useState(true);
  const [panel, setPanel] = useState<Panel>("feed");
  const [pickMode, setPickMode] = useState(false);
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);
  const [liveContact, setLiveContact] = useState<Sighting | null>(null);
  const [playedIds, setPlayedIds] = useState<Set<number>>(() => new Set());
  const [satLayer, setSatLayer] = useState<SatMode>("auto");

  const dayTex = useQuery({
    queryKey: ["globe-tex", "visible"],
    queryFn: () => loadGlobeTexture({ data: { layer: "visible" } }),
    staleTime: 60 * 60_000,
    enabled: satLayer === "auto" || satLayer === "visible",
  });
  const nightTex = useQuery({
    queryKey: ["globe-tex", "night"],
    queryFn: () => loadGlobeTexture({ data: { layer: "night" } }),
    staleTime: 60 * 60_000,
    enabled: satLayer === "auto" || satLayer === "night",
  });
  const irTex = useQuery({
    queryKey: ["globe-tex", "ir"],
    queryFn: () => loadGlobeTexture({ data: { layer: "ir" } }),
    staleTime: 60 * 60_000,
    enabled: satLayer === "ir",
  });

  const livePending = (sightings.data ?? []).filter((s) => s.source === "live" && !s.aiScored).length;
  const liveScore = useQuery({
    queryKey: ["ai-live", livePending],
    queryFn: () => assessUnscoredLive(),
    enabled: livePending > 0,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d && d.remaining === 0) return false;
      return 8_000;
    },
  });

  useEffect(() => {
    if (liveScore.data && liveScore.data.scored > 0) {
      void qc.invalidateQueries({ queryKey: ["sightings"] });
      void qc.invalidateQueries({ queryKey: ["analysis"] });
    }
  }, [liveScore.data, qc]);

  const contacts = sightings.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((s) => {
      if (klass === "live") {
        if (s.source !== "live") return false;
      } else if (klass !== "all" && s.classification !== klass) return false;
      if (sensor !== "all" && s.sensorType !== sensor) return false;
      if (hideLowBolides && s.source === "live" && s.aiScored && s.uapIndex < 35) return false;
      if (!q) return true;
      return (
        s.locationLabel.toLowerCase().includes(q) ||
        s.region.toLowerCase().includes(q) ||
        s.shape.includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.sensorType.includes(q) ||
        SENSOR_META[s.sensorType].label.toLowerCase().includes(q)
      );
    });
  }, [contacts, hideLowBolides, klass, query, sensor]);

  const selected = contacts.find((s) => s.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const anomalous = contacts.filter((s) => s.classification === "anomalous").length;
    const sensors = contacts.filter((s) => s.source === "sensor").length;
    const regions = new Set(contacts.map((s) => s.region)).size;
    const avg =
      contacts.length === 0
        ? 0
        : Math.round(contacts.reduce((a, s) => a + s.confidence, 0) / contacts.length);
    const live = contacts.filter((s) => s.source === "live");
    const live48 = live.filter((s) => Date.parse(s.occurredAt) >= Date.now() - 48 * 3600_000).length;
    return {
      total: contacts.length,
      anomalous,
      sensors,
      regions,
      avg,
      live: live.length,
      live48,
      uap: globalUapIndex(contacts),
      inbound: primaryInbound(contacts),
    };
  }, [contacts]);

  const openContact = (id: number) => {
    setSelectedId(id);
    setPanel("feed");
    const next = contacts.find((s) => s.id === id);
    if (next) setLiveContact(next);
  };

  const onPick = (lat: number, lng: number) => {
    setPick({ lat, lng });
    setPickMode(false);
    setPanel("report");
    toast("Coordinates locked from globe");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface">
            <Radar className="size-4 text-accent" />
          </span>
          <div>
            <p className="font-display text-lg font-semibold tracking-[-0.03em] leading-tight">
              AETHER
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Global UAP Detection
            </p>
          </div>
        </div>
        <Badge variant="live" className="ml-1">
          <span className="mr-1.5 size-1.5 rounded-full bg-signal pulse-live" />
          Live
        </Badge>
        {livePending > 0 && (
          <Badge variant="watch">AI scoring {livePending}</Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
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

      <section className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Stat label="Contacts" value={stats.total} />
        <Stat label="Anomalous" value={stats.anomalous} />
        <Stat label="Sensor tracks" value={stats.sensors} />
        <Stat label="Mean confidence" value={`${stats.avg}%`} />
      </section>
      <section className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Stat label="Live detections" value={stats.live} />
        <Stat label="Live last 48h" value={stats.live48} />
        <Stat label="UAP probability index" value={`${stats.uap}/100`} />
        <Stat label="Primary inbound" value={stats.inbound ?? "—"} />
      </section>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-[42vh] flex-1 bg-bg lg:min-h-0">
          {sightings.isLoading ? (
            <div className="flex h-full min-h-[42vh] items-center justify-center text-sm text-muted">
              Acquiring global picture…
            </div>
          ) : sightings.isError ? (
            <div className="flex h-full min-h-[42vh] items-center justify-center px-6 text-center text-sm text-muted">
              Network picture failed to load. Reload the console.
            </div>
          ) : (
            <Globe
              contacts={filtered}
              selectedId={selected?.id ?? null}
              onSelect={openContact}
              pickMode={pickMode}
              onPick={onPick}
              mode={satLayer}
              texture={
                satLayer === "ir"
                  ? irTex.data && !("error" in irTex.data)
                    ? irTex.data
                    : null
                  : satLayer === "night"
                    ? nightTex.data && !("error" in nightTex.data)
                      ? nightTex.data
                      : null
                    : dayTex.data && !("error" in dayTex.data)
                      ? dayTex.data
                      : null
              }
              nightTexture={nightTex.data && !("error" in nightTex.data) ? nightTex.data : null}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 sm:p-4">
            <p className="pointer-events-auto rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {pickMode ? "Tap globe to lock coordinates" : "Drag to rotate · tap a contact"}
            </p>
            <p className="rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {stats.regions} regions
            </p>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 sm:p-4">
            <div className="pointer-events-auto flex gap-1 rounded-md border border-border bg-bg/80 p-1">
              {SAT_MODES.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => setSatLayer(layer)}
                  className={cn(
                    "h-8 rounded-sm px-2.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                    satLayer === layer ? "bg-raised text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {SAT_LAYER_META[layer].short}
                </button>
              ))}
            </div>
            <p className="max-w-[55%] truncate rounded-md border border-border bg-bg/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {satLayer === "auto"
                ? dayTex.isPending || nightTex.isPending
                  ? "Loading terminator mosaic…"
                  : "NASA VIIRS · live terminator"
                : satLayer === "ir"
                  ? irTex.isPending
                    ? "Loading NASA mosaic…"
                    : irTex.data && "error" in irTex.data
                      ? irTex.data.error
                      : irTex.data
                        ? `${irTex.data.source}${irTex.data.acquired ? ` · ${irTex.data.acquired}` : ""}`
                        : "Satellite offline"
                  : satLayer === "night"
                    ? nightTex.isPending
                      ? "Loading NASA mosaic…"
                      : nightTex.data && "error" in nightTex.data
                        ? nightTex.data.error
                        : nightTex.data
                          ? `${nightTex.data.source}${nightTex.data.acquired ? ` · ${nightTex.data.acquired}` : ""}`
                          : "Satellite offline"
                    : dayTex.isPending
                      ? "Loading NASA mosaic…"
                      : dayTex.data && "error" in dayTex.data
                        ? dayTex.data.error
                        : dayTex.data
                          ? `${dayTex.data.source}${dayTex.data.acquired ? ` · ${dayTex.data.acquired}` : ""}`
                          : "Satellite offline"}
            </p>
          </div>
        </section>

        <aside className="flex w-full flex-col border-t border-border bg-surface lg:w-[400px] lg:border-t-0 lg:border-l">
          <div className="flex gap-1 border-b border-border p-2">
            {(
              [
                ["feed", "Contacts"],
                ["report", "Report"],
                ["brief", "Intel"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={cn(
                  "h-10 flex-1 rounded-md text-xs font-medium transition-colors duration-150",
                  panel === id ? "bg-raised text-fg" : "text-muted hover:text-fg",
                )}
              >
                {label}
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
              sensor={sensor}
              setSensor={setSensor}
              hideLowBolides={hideLowBolides}
              setHideLowBolides={setHideLowBolides}
              selected={selected}
              onSelect={openContact}
              autoVisible={selected ? playedIds.has(selected.id) : false}
              onReplay={() => {
                if (selected) setLiveContact(selected);
              }}
            />
          )}
          {panel === "report" && (
            <ReportForm
              pick={pick}
              pickMode={pickMode}
              setPickMode={setPickMode}
              onFiled={(s) => {
                void qc.invalidateQueries({ queryKey: ["sightings"] });
                setSelectedId(s.id);
                setPanel("feed");
                setPick(null);
                setLiveContact(s);
              }}
            />
          )}
          {panel === "brief" && <BriefingPanel />}
        </aside>
      </div>
      {liveContact && (
        <LiveFeed
          contact={liveContact}
          onClose={() => setLiveContact(null)}
          onPlayed={() =>
            setPlayedIds((prev) => {
              const next = new Set(prev);
              next.add(liveContact.id);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg px-4 py-3 sm:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-1 truncate font-display text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Feed({
  filtered,
  query,
  setQuery,
  klass,
  setKlass,
  sensor,
  setSensor,
  hideLowBolides,
  setHideLowBolides,
  selected,
  onSelect,
  autoVisible,
  onReplay,
}: {
  filtered: Sighting[];
  query: string;
  setQuery: (v: string) => void;
  klass: Klass;
  setKlass: (v: Klass) => void;
  sensor: SensorType | "all";
  setSensor: (v: SensorType | "all") => void;
  hideLowBolides: boolean;
  setHideLowBolides: (v: boolean | ((p: boolean) => boolean)) => void;
  selected: Sighting | null;
  onSelect: (id: number) => void;
  autoVisible: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 p-3">
        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search region, shape, sensor, narrative"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={klass === "all"} onClick={() => setKlass("all")}>
            All
          </Chip>
          <Chip active={klass === "live"} onClick={() => setKlass("live")}>
            Live
          </Chip>
          {CLASSIFICATIONS.map((c) => (
            <Chip key={c} active={klass === c} onClick={() => setKlass(c)}>
              {classLabel(c)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={sensor === "all"} onClick={() => setSensor("all")}>
            All sensors
          </Chip>
          {SENSOR_TYPES.map((t) => (
            <Chip key={t} active={sensor === t} onClick={() => setSensor(t)}>
              {SENSOR_META[t].short}
            </Chip>
          ))}
          <Chip active={hideLowBolides} onClick={() => setHideLowBolides((v) => !v)}>
            Floor 35
          </Chip>
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted">No contacts match this filter.</p>
        ) : (
          filtered.map((s) => (
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
                <span className="truncate text-sm font-medium">{s.locationLabel}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {s.source === "live" && <Badge variant="live">Live</Badge>}
                  <Badge variant={classTone(s.classification)}>{classLabel(s.classification)}</Badge>
                </div>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {sensorShort(s.sensorType)} · {s.region} · {s.shape} · {formatWhen(s.occurredAt)}
              </p>
              {s.originLabel && (
                <p className="truncate font-mono text-[10px] tracking-[0.08em] text-subtle">
                  Inbound {s.originLabel} · UAP {s.uapIndex}/100
                  {s.aiScored ? " · AI" : s.correlated ? " · corr" : s.source === "live" ? " · pending" : ""}
                </p>
              )}
            </button>
          ))
        )}
      </div>
      {selected && (
        <Detail
          key={selected.id}
          contact={selected}
          autoVisible={autoVisible}
          onReplay={onReplay}
        />
      )}
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

function Detail({
  contact,
  autoVisible,
  onReplay,
}: {
  contact: Sighting;
  autoVisible: boolean;
  onReplay: () => void;
}) {
  const qc = useQueryClient();
  const analysis = useQuery({
    queryKey: ["analysis", contact.id],
    queryFn: () => getAnalysis({ data: { id: contact.id } }),
  });
  const cross = useQuery({
    queryKey: ["crossfix", contact.id],
    queryFn: () => getCrossFix({ data: { id: contact.id } }),
    enabled: contact.source === "live",
  });
  const run = useMutation({
    mutationFn: () => analyzeContact({ data: { id: contact.id } }),
    onSuccess: (res) => {
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      void analysis.refetch();
      void qc.invalidateQueries({ queryKey: ["sightings"] });
    },
    onError: () => toast.error("Assessment failed."),
  });

  const result = analysis.data;
  const pending = run.isPending;
  const autoScoring = contact.source === "live" && !contact.aiScored && !result;
  const awaitingCorr = autoScoring && !contact.correlated;

  return (
    <div className="border-t border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold leading-snug">{contact.locationLabel}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {coords(contact)} · {formatDuration(contact.durationSec)}
          </p>
        </div>
        <Badge variant="solid">{contact.confidence}% conf</Badge>
      </div>
      <div className="mt-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            UAP probability index
            {contact.aiScored
              ? " · AI"
              : contact.source === "live"
                ? contact.correlated
                  ? " · pending AI"
                  : " · awaiting correlation"
                : ""}
          </p>
          <Badge variant={uapTone(contact.uapIndex)}>{contact.uapIndex}/100</Badge>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${Math.min(100, contact.uapIndex)}%` }}
          />
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          Inbound sky direction
        </p>
        <p className="mt-1 text-sm text-fg">{contact.originLabel ?? "Unknown"}</p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          Detection sensor
        </p>
        <p className="mt-1 text-sm text-fg">{sensorLabel(contact.sensorType)}</p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-subtle">
          {SENSOR_META[contact.sensorType].hint}
        </p>
        {cross.data && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              Multi-static cross-fix
              {cross.data.correlated ? " · final" : " · pending"}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg">
              {cross.data.eoFix ? "EO lock" : "EO gap"} · {cross.data.irFix ? "IR lock" : "IR none"} ·{" "}
              {cross.data.radarFix ? "radar kinematics" : "radar gap"}
            </p>
            {cross.data.latErrDeg != null && (
              <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-subtle">
                ±{cross.data.latErrDeg.toFixed(2)}° lat · ±{(cross.data.lngErrDeg ?? 0).toFixed(2)}° lng · ±
                {cross.data.timeErrSec ?? 0}s
              </p>
            )}
            <p className="mt-1 text-sm text-muted">
              {cross.data.weatherNote ?? "Weather dump pending"}
              {cross.data.cloudCover != null ? ` · cloud ${cross.data.cloudCover}%` : ""}
            </p>
            {cross.data.metar && (
              <p className="mt-1 font-mono text-[10px] tracking-[0.06em] text-subtle">{cross.data.metar}</p>
            )}
            {cross.data.notamNote && (
              <p className="mt-1 text-sm text-muted">{cross.data.notamNote}</p>
            )}
            <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-subtle">
              {cross.data.spaceFence}
              {cross.data.latencySec != null
                ? ` · dump lag ${Math.round(cross.data.latencySec / 60)} min`
                : ""}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{contact.summary}</p>
      <div className="mt-4 space-y-3">
        <SpectraStrip contact={contact} autoVisible={autoVisible} />
        <Button variant="secondary" className="w-full" onClick={onReplay}>
          Replay area feed
        </Button>
        {result ? (
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              AI assessment · {result.threat}
              {result.uapProbability != null ? ` · ${result.uapProbability}/100` : ""}
            </p>
            <p className="mt-1 text-sm text-fg">{result.likelyOrigin}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{result.assessment}</p>
          </div>
        ) : awaitingCorr ? (
          <p className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Holding UAP index until EO/IR/radar + weather/NOTAM dump…
          </p>
        ) : autoScoring ? (
          <p className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            AI scoring this live detection…
          </p>
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
  const [sensorType, setSensorType] = useState<SensorType>("optical");
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
          sensorType,
        },
      }),
    onSuccess: (s) => {
      toast.success("Contact filed to the global picture");
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
        Field reports are shared with every visitor of this console. Do not include names, emails, or
        private addresses.
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
        <Field label="Sensor">
          <select
            value={sensorType}
            onChange={(e) => setSensorType(e.target.value as SensorType)}
            className="flex h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg"
          >
            {SENSOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {SENSOR_META[t].label}
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
        Grok reads the latest contacts on the board and writes a calm watch-floor brief. Run it when
        you want a synthesis — it is not generated automatically.
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
