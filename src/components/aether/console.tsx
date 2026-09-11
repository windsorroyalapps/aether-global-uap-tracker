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

  // NOTE: remainder of file continues below via second commit if size fails
  return null as any;
}
