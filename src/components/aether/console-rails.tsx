import { type ReactNode } from "react";
import { Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  classLabel,
  classTone,
  formatWhen,
  sourceLabel,
} from "@/lib/uap/format";
import { CLASSIFICATIONS, SOURCES } from "@/lib/uap/types";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import type { Classification, Contact, LiveVerdict, Source, StreamHealth } from "@/lib/uap/types";
import type { AlertEvent } from "@/lib/uap/alerts";
import { cn } from "@/lib/utils";
import { Detail } from "@/components/aether/console-rails-more";

export function ElevatedRail({
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

export function LiveSensorRail({
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

export function StreamRail({ streams }: { streams: StreamHealth[] }) {
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

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg px-4 py-3 sm:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

export function Feed({
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
  epoch: "all" | "live" | "archive";
  setEpoch: (v: "all" | "live" | "archive") => void;
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

export function Chip({
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
