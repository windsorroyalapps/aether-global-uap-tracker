import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { coords, formatWhen } from "@/lib/uap/format";
import { loadAreaFeed } from "@/lib/uap/imagery";
import { biomeFor, feedSrc } from "@/lib/uap/spectra";
import type { Sighting } from "@/lib/uap/types";
import { cn } from "@/lib/utils";

type Props = {
  contact: Sighting;
  onClose: () => void;
  onPlayed: () => void;
};

export function LiveFeed({ contact, onClose, onPlayed }: Props) {
  const qc = useQueryClient();
  const played = useRef(false);
  const onPlayedRef = useRef(onPlayed);
  const onCloseRef = useRef(onClose);
  onPlayedRef.current = onPlayed;
  onCloseRef.current = onClose;
  const biome = biomeFor(contact);
  const fallback = feedSrc(biome);

  const feed = useQuery({
    queryKey: ["area-feed", contact.id],
    queryFn: () => loadAreaFeed({ data: { id: contact.id } }),
  });

  useEffect(() => {
    if (!feed.data || "error" in feed.data || feed.data.frames.length === 0) return;
    void qc.invalidateQueries({ queryKey: ["spectra", contact.id] });
  }, [feed.data, contact.id, qc]);

  const frames = feed.data && !("error" in feed.data) ? feed.data.frames : [];
  const note = feed.data && !("error" in feed.data) ? feed.data.note : "";
  const source = feed.data && !("error" in feed.data) ? feed.data.source : "";
  const timed = feed.data && !("error" in feed.data) ? feed.data.timed : false;
  const real = frames.length > 0;

  const finish = () => {
    if (played.current) return;
    played.current = true;
    onPlayedRef.current();
    window.setTimeout(() => onCloseRef.current(), 420);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-3 sm:items-center sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Area imagery"
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-bg shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="relative aspect-video overflow-hidden bg-surface">
          {feed.isPending ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                Pulling archive for {formatWhen(contact.occurredAt)}…
              </p>
            </div>
          ) : real ? (
            <ArchivePlayer frames={frames} timed={timed} onDone={finish} />
          ) : (
            <video
              className="h-full w-full object-cover"
              src={fallback.video}
              poster={fallback.poster}
              autoPlay
              muted
              playsInline
              onEnded={finish}
            />
          )}
          <div className="feed-scan pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg/80 via-transparent to-bg/35" />

          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2 sm:left-4 sm:top-4">
            <span className="flex items-center gap-1.5 rounded-full border border-signal/40 bg-bg/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-signal">
              <span className="size-1.5 rounded-full bg-signal pulse-live" />
              {real ? "Archive" : "Simulated"}
            </span>
            {real && (
              <span className="rounded-full border border-border bg-bg/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {source}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-md border border-border bg-bg/70 text-fg sm:right-4 sm:top-4"
            aria-label="Close live feed"
          >
            <X className="size-4" />
          </button>

          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 sm:inset-x-4 sm:bottom-4">
            <div>
              <p className="font-display text-base font-semibold leading-tight sm:text-lg">
                {contact.locationLabel}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {coords(contact)} · {formatWhen(contact.occurredAt)}
              </p>
              {note && (
                <p className="mt-1 max-w-md font-mono text-[10px] leading-relaxed tracking-[0.08em] text-subtle">
                  {note}
                </p>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={finish}>
              Lock still
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchivePlayer({
  frames,
  timed,
  onDone,
}: {
  frames: { src: string; capturedAt: string | null }[];
  timed: boolean;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      if (!done.current) {
        done.current = true;
        onDoneRef.current();
      }
      return;
    }
    if (frames.length === 1) {
      const t = window.setTimeout(() => {
        if (!done.current) {
          done.current = true;
          onDoneRef.current();
        }
      }, 6400);
      const p = window.setInterval(() => {
        setProgress((v) => Math.min(1, v + 0.04));
      }, 250);
      return () => {
        window.clearTimeout(t);
        window.clearInterval(p);
      };
    }
    const step = timed ? 850 : 1100;
    let i = 0;
    const iv = window.setInterval(() => {
      i += 1;
      if (i >= frames.length) {
        window.clearInterval(iv);
        if (!done.current) {
          done.current = true;
          onDoneRef.current();
        }
        return;
      }
      setIdx(i);
      setProgress((i + 1) / frames.length);
    }, step);
    return () => window.clearInterval(iv);
  }, [frames, timed]);

  const frame = frames[idx] ?? frames[0];
  if (!frame) return null;

  return (
    <>
      <img
        src={frame.src}
        alt=""
        className={cn("h-full w-full object-cover", frames.length === 1 && "feed-ken")}
      />
      {frame.capturedAt && (
        <span className="absolute left-3 top-12 rounded-full border border-border bg-bg/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg sm:left-4">
          {frame.capturedAt.replace("T", " ").replace("Z", " UTC")}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-raised">
        <div
          className="h-full bg-accent transition-[width] duration-150 ease-linear"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
    </>
  );
}
