import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Aperture } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SPECTRUM_BANDS,
  SPECTRUM_META,
  acquireSpectra,
  biomeFor,
  feedSrc,
  listSpectra,
  type SpectrumBand,
} from "@/lib/uap/spectra";
import type { Sighting } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

export function SpectraStrip({
  contact,
  autoVisible,
}: {
  contact: Sighting;
  autoVisible: boolean;
}) {
  const poster = feedSrc(biomeFor(contact)).poster;
  const [open, setOpen] = useState<SpectrumBand | null>(null);
  const autoFired = useRef(false);

  const q = useQuery({
    queryKey: ["spectra", contact.id],
    queryFn: () => listSpectra({ data: { id: contact.id } }),
  });

  const have = new Map((q.data ?? []).map((s) => [s.band, s]));

  const run = useMutation({
    mutationFn: (bands: SpectrumBand[]) =>
      acquireSpectra({ data: { id: contact.id, bands } }),
    onSuccess: (res) => {
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      void q.refetch();
    },
    onError: () => toast.error("Spectrum capture failed."),
  });

  const missing = SPECTRUM_BANDS.filter((b) => !have.has(b));
  const err =
    (run.data && "error" in run.data && run.data.error) ||
    (q.error instanceof Error ? q.error.message : null);
  const provenance = [...have.values()].find((s) => s.source && s.source !== "ai");

  useEffect(() => {
    autoFired.current = false;
  }, [contact.id]);

  useEffect(() => {
    if (autoFired.current || run.isPending || q.isLoading) return;
    const rows = q.data ?? [];
    const std = contact.shape === "cylinder" || contact.shape === "triangle";
    if (std) {
      const need = (["visible", "ir", "radar"] as SpectrumBand[]).filter(
        (b) => !rows.some((s) => s.band === b),
      );
      if (need.length === 0) return;
      autoFired.current = true;
      run.mutate(need);
      return;
    }
    if (!autoVisible) return;
    if (rows.some((s) => s.band === "visible")) return;
    autoFired.current = true;
    run.mutate(["visible"]);
  }, [autoVisible, contact.id, contact.shape, q.data, q.isLoading, run.isPending]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          {provenance
            ? `Archive · ${provenance.source}`
            : "Area stills · spectra"}
        </p>
        {missing.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            disabled={run.isPending}
            onClick={() => run.mutate(missing)}
          >
            <Aperture className="size-3.5" />
            {run.isPending ? "Fetching archive…" : "Acquire bands"}
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-alert">{err}</p>}
      <div className="grid grid-cols-5 gap-1.5">
        {SPECTRUM_BANDS.map((band) => {
          const still = have.get(band);
          return (
            <button
              key={band}
              type="button"
              onClick={() => {
                if (still) setOpen(band === open ? null : band);
                else if (!run.isPending) run.mutate([band]);
              }}
              className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-raised"
              aria-label={SPECTRUM_META[band].label}
            >
              <img
                src={still?.src ?? poster}
                alt=""
                className={cn("h-full w-full object-cover", !still && `spectrum-${band}`)}
              />
              {!still && run.isPending && <span className="absolute inset-0 scan-shimmer" />}
              <span className="absolute inset-x-0 bottom-0 bg-bg/70 px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fg">
                {SPECTRUM_META[band].short}
              </span>
            </button>
          );
        })}
      </div>
      {open && have.get(open) && (
        <button
          type="button"
          className="relative block w-full overflow-hidden rounded-lg border border-border"
          onClick={() => setOpen(null)}
        >
          <img src={have.get(open)?.src} alt="" className="max-h-56 w-full object-cover" />
          <span className="absolute left-2 top-2 rounded-full border border-border bg-bg/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]">
            {SPECTRUM_META[open].label}
            {have.get(open)?.source ? ` · ${have.get(open)?.source}` : ""}
          </span>
        </button>
      )}
      {provenance?.note && (
        <p className="font-mono text-[10px] leading-relaxed tracking-[0.06em] text-subtle">
          {provenance.note}
          {provenance.capturedAt ? ` · ${provenance.capturedAt}` : ""}
        </p>
      )}
    </div>
  );
}
