import { useMutation, useQuery, useState, useEffect, type ReactNode } from "react";
import { Activity, Filter, Globe2, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { fileReport } from "@/lib/uap/queries";
import { CLASSIFICATIONS, SHAPES, SOURCES } from "@/lib/uap/types";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import type { Classification, Contact, LiveVerdict, Shape, Sighting, Source, StreamHealth } from "@/lib/uap/types";
import type { AlertEvent } from "@/lib/uap/alerts";
import { cn } from "@/lib/utils";

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
