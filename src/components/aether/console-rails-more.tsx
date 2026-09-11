import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, Globe2, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { analyzeContact, analyzeLiveEvent, generateBriefing, getAnalysis } from "@/lib/uap/analyze";
import {
  coords,
  formatDuration,
  sourceLabel,
} from "@/lib/uap/format";
import { fileReport } from "@/lib/uap/queries";
import { SHAPES } from "@/lib/uap/types";
import { isUapCandidate, uapProbability } from "@/lib/uap/infer";
import type { Contact, Shape, Sighting } from "@/lib/uap/types";

export function Detail({ contact, onOpenOptics }: { contact: Contact; onOpenOptics: () => void }) {
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

export function ReportForm({
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

export function BriefingPanel() {
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
