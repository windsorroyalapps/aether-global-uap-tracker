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
import { analyzeContact, generateBriefing, getAnalysis } from "@/lib/uap/analyze";
import { classLabel, classTone, coords, formatDuration, formatWhen } from "@/lib/uap/format";
import { fileReport, listSightings } from "@/lib/uap/queries";
import { CLASSIFICATIONS, SHAPES, type Classification, type Shape, type Sighting } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

type Panel = "feed" | "report" | "brief";

export function Console({ initial }: { initial: Sighting[] }) {
  const qc = useQueryClient();
  const sightings = useQuery({
    queryKey: ["sightings"],
    queryFn: () => listSightings(),
    initialData: initial,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState<Classification | "all">("all");
  const [panel, setPanel] = useState<Panel>("feed");
  const [pickMode, setPickMode] = useState(false);
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);

  const contacts = sightings.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((s) => {
      if (klass !== "all" && s.classification !== klass) return false;
      if (!q) return true;
      return (
        s.locationLabel.toLowerCase().includes(q) ||
        s.region.toLowerCase().includes(q) ||
        s.shape.includes(q) ||
        s.summary.toLowerCase().includes(q)
      );
    });
  }, [contacts, klass, query]);

  const selected = contacts.find((s) => s.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const anomalous = contacts.filter((s) => s.classification === "anomalous").length;
    const sensors = contacts.filter((s) => s.source === "sensor").length;
    const regions = new Set(contacts.map((s) => s.region)).size;
    const avg =
      contacts.length === 0
        ? 0
        : Math.round(contacts.reduce((a, s) => a + s.confidence, 0) / contacts.length);
    return { total: contacts.length, anomalous, sensors, regions, avg };
  }, [contacts]);

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
              onSelect={(id) => {
                setSelectedId(id);
                setPanel("feed");
              }}
              pickMode={pickMode}
              onPick={onPick}
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
              selected={selected}
              onSelect={setSelectedId}
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
              }}
            />
          )}
          {panel === "brief" && <BriefingPanel />}
        </aside>
      </div>
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
  selected,
  onSelect,
}: {
  filtered: Sighting[];
  query: string;
  setQuery: (v: string) => void;
  klass: Classification | "all";
  setKlass: (v: Classification | "all") => void;
  selected: Sighting | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 p-3">
        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search region, shape, narrative"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={klass === "all"} onClick={() => setKlass("all")}>
            All
          </Chip>
          {CLASSIFICATIONS.map((c) => (
            <Chip key={c} active={klass === c} onClick={() => setKlass(c)}>
              {classLabel(c)}
            </Chip>
          ))}
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
                <Badge variant={classTone(s.classification)}>{classLabel(s.classification)}</Badge>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {s.region} · {s.shape} · {formatWhen(s.occurredAt)}
              </p>
            </button>
          ))
        )}
      </div>
      {selected && <Detail key={selected.id} contact={selected} />}
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

function Detail({ contact }: { contact: Sighting }) {
  const analysis = useQuery({
    queryKey: ["analysis", contact.id],
    queryFn: () => getAnalysis({ data: { id: contact.id } }),
  });
  const run = useMutation({
    mutationFn: () => analyzeContact({ data: { id: contact.id } }),
    onSuccess: (res) => {
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      void analysis.refetch();
    },
    onError: () => toast.error("Assessment failed."),
  });

  const result = analysis.data;
  const pending = run.isPending;

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
      <p className="mt-3 text-sm leading-relaxed text-muted">{contact.summary}</p>
      <div className="mt-4">
        {result ? (
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
