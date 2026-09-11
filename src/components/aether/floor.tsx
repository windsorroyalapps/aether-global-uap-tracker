import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportSnapshot, ingestReplica, listLedger, listQueue, listSnapshots, reviewReport, sealServerBackup, type ReplicaRecord } from "@/lib/uap/archive";
import { ensureServiceWorker } from "@/lib/uap/alerts";
import { aiReviewReport, PROVIDER_IDS, type ProviderKeys } from "@/lib/uap/ensemble";
import { officerLogin, officerSession } from "@/lib/uap/officer";
import { clearOfficer, loadOfficer, saveOfficer, type OfficerSession } from "@/lib/uap/officer-session";
import { useP2PRoom } from "@/lib/multiplayer";
import { formatWhen } from "@/lib/uap/format";

const KEYS_KEY = "aether-ai-keys";

function loadKeys(): ProviderKeys {
  try {
    return JSON.parse(localStorage.getItem(KEYS_KEY) ?? "{}") as ProviderKeys;
  } catch {
    return {};
  }
}

export function FloorPanel() {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ["queue"], queryFn: () => listQueue(), refetchInterval: 20_000 });
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: () => listLedger(), refetchInterval: 30_000 });
  const backups = useQuery({ queryKey: ["backups"], queryFn: () => listSnapshots(), refetchInterval: 45_000 });
  const [keys, setKeys] = useState<ProviderKeys>({});
  const [session, setSession] = useState<OfficerSession | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const p2p = useP2PRoom({ room: "aether-archive", name: "archive" });
  const seeded = useRef(new Set<string>());

  useEffect(() => {
    setKeys(loadKeys());
    const s = loadOfficer();
    if (!s) return;
    void officerSession({ data: { token: s.token } }).then((r) => {
      if (r.ok) setSession(s);
      else {
        clearOfficer();
        setSession(null);
      }
    });
  }, []);

  useEffect(() => {
    return p2p.onMessage((from, data) => {
      const msg = data as { kind?: string; records?: ReplicaRecord[] };
      if (!msg || msg.kind !== "snapshot" || !Array.isArray(msg.records)) return;
      void ingestReplica({ data: { peerId: from, records: msg.records } }).then((r) => {
        if (r.inserted > 0) {
          toast.success(`P2P merge: ${r.inserted} sealed records`);
          void qc.invalidateQueries({ queryKey: ["sightings"] });
          void qc.invalidateQueries({ queryKey: ["queue"] });
        }
      });
    });
  }, [p2p, qc]);

  useEffect(() => {
    const live = p2p.peers.filter((p) => p.connectionState === "connected");
    if (live.length === 0) return;
    const ids = [p2p.selfId, ...live.map((p) => p.id)].sort();
    if (ids[0] !== p2p.selfId) return;
    const key = live.map((p) => p.id).join(",");
    if (seeded.current.has(key)) return;
    seeded.current.add(key);
    void exportSnapshot().then((snap) => {
      p2p.send({ kind: "snapshot", records: snap.records });
    });
  }, [p2p, p2p.peers, p2p.selfId, p2p.send]);

  const saveKeys = () => {
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    toast.success("Keys stay in this browser only");
  };

  const login = useMutation({
    mutationFn: () => officerLogin({ data: { username: user, password: pass } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const next = { token: res.token, callsign: res.callsign };
      saveOfficer(next);
      setSession(next);
      setPass("");
      toast.success(`Watch officer ${res.callsign} on duty`);
      void ensureServiceWorker();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: (id: number) => aiReviewReport({ data: { id, keys } }),
    onSuccess: (res) => {
      if ("error" in res) toast.error(res.error);
      else toast.success(`AI review: ${res.verdict}`);
      void qc.invalidateQueries({ queryKey: ["queue"] });
      void qc.invalidateQueries({ queryKey: ["sightings"] });
      void qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adminMut = useMutation({
    mutationFn: (p: { id: number; status: "admin-reviewed" | "held" }) =>
      reviewReport({ data: { id: p.id, status: p.status, token: session?.token ?? "" } }),
    onSuccess: (res) => {
      if (res && "error" in res) toast.error(res.error);
      else toast.success("Archive updated — nothing deleted");
      void qc.invalidateQueries({ queryKey: ["queue"] });
      void qc.invalidateQueries({ queryKey: ["sightings"] });
      void qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });

  const connected = p2p.peers.filter((p) => p.connectionState === "connected").length;
  const pendingN = (queue.data ?? []).filter((s) => s.reviewStatus === "pending").length;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-candidate">Sciencing, not silencing</p>
        <p className="mt-1 text-sm text-muted">
          Field reports are sealed on ingest. Nothing is deleted. The globe only shows AI- or administrator-reviewed
          records. Pending stays in the ledger until reviewed.
        </p>
      </div>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Watch officer</p>
          {session ? <Badge variant="live">{session.callsign}</Badge> : <Badge variant="watch">off duty</Badge>}
        </div>
        {session ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-fg">{session.callsign} is on the floor</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                clearOfficer();
                setSession(null);
                toast.message("Watch officer signed off");
              }}
            >
              Sign off
            </Button>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="officer-user">Callsign</Label>
              <Input
                id="officer-user"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="Watch officer callsign"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="officer-pass">Password</Label>
              <Input
                id="officer-pass"
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Duty password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Checking…" : "Assume the floor"}
            </Button>
          </form>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Detection residual (kept, not silenced)</p>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
          <li>Transmedium — open-water / near-surface / descending toward sea</li>
          <li>Kinematic jerk — hover-then-sprint, extreme vertical vs speed</li>
          <li>Dragless energy — high speed below 600 m, unmatched envelope</li>
          <li>Coincidence gap — empty ADS-B / balloon / satellite box is retained</li>
          <li>Persistent luminous — orb/lights held, not a single-flash flare</li>
          <li>Tasman basin watch — P-8 operating area stays on the map</li>
          <li>Dark IFF over water — unnamed / no-call track retained</li>
          <li>Periodic pulse — 8–40 s lights, not a meteor</li>
          <li>Pacing / formation — nearby residuals on similar heading</li>
          <li>Optical stare — public cameras in LOS are evidence, not a veto</li>
          <li>IR/visual dual-band — GOES IR plus CCTV both kept</li>
          <li>Aviation conflict — residual inside another airframe’s box is a traffic problem first</li>
          <li>Airport approach — slow/low near a hub is usually a landing, not a UAP</li>
          <li>Starlink train / twilight flare — strings of lights at dusk are constellation passes</li>
          <li>UAV envelope — low/slow inland is sUAS until kinematics break it</li>
          <li>Thunderstorm — lightning and sprites before anomaly</li>
          <li>Azimuth match — heading that tracks Venus, Jupiter, or a sat is prosaic</li>
          <li>Dark in dense airspace — unnamed inside a busy ADS-B picture is retained</li>
          <li>Public generating station — inform, never approach</li>
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Your analysis keys</p>
        <p className="text-xs text-muted">Grok uses the console key if you leave it blank. Other keys never leave this browser except for the review call.</p>
        {PROVIDER_IDS.map((id) => (
          <div key={id} className="space-y-1">
            <Label className="text-[11px] uppercase tracking-[0.12em] text-muted">{id}</Label>
            <Input
              type="password"
              autoComplete="off"
              value={keys[id] ?? ""}
              onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
              placeholder={id === "grok" ? "optional — console default" : `paste ${id} key`}
            />
          </div>
        ))}
        <Button type="button" variant="secondary" className="w-full" onClick={saveKeys}>
          Save keys locally
        </Button>
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">P2P archive mesh</p>
        <p className="text-sm text-fg">
          {p2p.joined ? `${connected} peer${connected === 1 ? "" : "s"} connected` : "Joining mesh…"} · room {p2p.room}
        </p>
        {p2p.peers.map((p) => (
          <p key={p.id} className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {p.id} · {p.connectionState}
            {p.rttMs != null ? ` · ${p.rttMs} ms` : ""}
          </p>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            void exportSnapshot().then((snap) => {
              const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `aether-archive-${snap.at.slice(0, 10)}.json`;
              a.click();
            });
          }}
        >
          Download sealed snapshot
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            void sealServerBackup().then((r) => {
              toast.success(`Server backup sealed · ${r.count} records`);
              void qc.invalidateQueries({ queryKey: ["backups"] });
              void qc.invalidateQueries({ queryKey: ["ledger"] });
            });
          }}
        >
          Seal server backup
        </Button>
        <Button
          type="button"
          className="w-full"
          onClick={() => {
            void exportSnapshot().then((snap) => {
              p2p.send({ kind: "snapshot", records: snap.records });
              toast.success(`Pushed ${snap.count} records to mesh`);
            });
          }}
        >
          Push archive to peers
        </Button>
        {(backups.data ?? []).slice(0, 4).map((b) => (
          <p key={b.id} className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            backup {b.created_at.slice(0, 16)} · {b.contact_count} sealed
          </p>
        ))}
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Review queue</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {pendingN} pending · admin seal requires watch officer duty
        </p>
        {(queue.data ?? []).length === 0 && (
          <p className="text-sm text-muted">Queue clear. New field reports land here first.</p>
        )}
        {(queue.data ?? []).map((s) => (
          <article key={s.id} className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{s.locationLabel}</p>
              <Badge variant={s.reviewStatus === "held" ? "watch" : "default"}>{s.reviewStatus}</Badge>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {formatWhen(s.occurredAt)} · {s.region}
            </p>
            <p className="text-xs leading-relaxed text-muted">{s.summary}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => review.mutate(s.id)} disabled={review.isPending}>
                AI review
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!session}
                onClick={() => adminMut.mutate({ id: s.id, status: "admin-reviewed" })}
              >
                Admin seal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!session}
                onClick={() => adminMut.mutate({ id: s.id, status: "held" })}
              >
                Hold
              </Button>
            </div>
          </article>
        ))}
      </section>

      <section className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Ledger (append-only)</p>
        {(ledger.data ?? []).slice(0, 12).map((row) => (
          <p key={row.id} className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            {row.created_at.slice(0, 16)} · {row.actor} · {row.action}
          </p>
        ))}
      </section>
    </div>
  );
}
