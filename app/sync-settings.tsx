"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CloudDownload, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-context";

type Change = { kind: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
type Conflict = { kind: string; id: string; fields: string[]; local: Record<string, unknown> | null; remote: Record<string, unknown> | null };
type History = { created_at: string; incoming: Change[]; outgoing: Change[]; conflicts: number };
type SyncStatus = { initialized: boolean; connected: boolean; pending: number; conflicts: Conflict[]; history: History[] };
type Device = { id: string; label: string; created_at: string; expires_at: string; last_used_at: string | null };

function describe(change: Change) {
  const record = change.after || change.before;
  const name = String(record?.name || record?.title || record?.contact_id || change.id);
  const action = !change.before ? "Added" : !change.after ? "Deleted" : "Updated";
  const fields = change.before && change.after
    ? Object.keys({ ...change.before, ...change.after }).filter(field => JSON.stringify(change.before?.[field]) !== JSON.stringify(change.after?.[field]))
    : [];
  return `${action} ${change.kind}: ${name}${fields.length ? ` · ${fields.join(", ")}` : ""}`;
}

function ChangeList({ changes }: { changes: Change[] }) {
  const [expanded, setExpanded] = useState(false);
  const render = (item: Change) => <li key={`${item.kind}:${item.id}`}><details><summary>{describe(item)}</summary><div className="sync-history-versions"><div><strong>Before</strong><pre>{item.before ? JSON.stringify(item.before, null, 2) : "Not present"}</pre></div><div><strong>After</strong><pre>{item.after ? JSON.stringify(item.after, null, 2) : "Deleted"}</pre></div></div></details></li>;
  return <><ul>{changes.slice(0, expanded ? undefined : 20).map(render)}</ul>{changes.length > 20 && <button type="button" className="sync-history-more" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show ${changes.length - 20} more changes`}</button>}</>;
}

export function SyncSettings() {
  const { user, offline } = useAuth();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [key, setKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [label, setLabel] = useState("My Mac");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(offline ? "/api/sync/status" : "/api/sync/devices", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as SyncStatus & { devices?: Device[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Sync settings could not be loaded.");
    if (offline) setStatus(body);
    else setDevices(body.devices || []);
  }, [offline]);
  useEffect(() => {
    if (user?.role_id !== "owner") return;
    let active = true;
    fetch(offline ? "/api/sync/status" : "/api/sync/devices", { cache: "no-store" })
      .then(response => response.json() as Promise<SyncStatus & { devices?: Device[]; error?: string }>)
      .then(body => { if (active) { if (offline) setStatus(body); else setDevices(body.devices || []); } })
      .catch(() => toast.error("Sync settings could not be loaded."));
    return () => { active = false; };
  }, [offline, user?.role_id]);
  if (user?.role_id !== "owner") return null;

  const connect = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/sync/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: key.trim() }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not connect this Mac.");
      setKey(""); await load(); toast.success("This Mac is connected to Hermes.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not connect this Mac."); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/sync/run", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { downloaded?: number; uploaded?: number; conflicts?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "Sync could not finish.");
      setMessage(`${body.uploaded || 0} local changes uploaded · ${body.downloaded || 0} cloud changes downloaded · ${body.conflicts || 0} to review`);
      await load();
      window.dispatchEvent(new Event("contactgraph:sync"));
      toast.success("Sync finished. Review the changes below.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Sync could not finish."); }
    finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/sync/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: label.trim() }) });
      const body = await response.json().catch(() => ({})) as { token?: string; error?: string };
      if (!response.ok || !body.token) throw new Error(body.error || "Could not create a sync key.");
      setNewKey(body.token); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create a sync key."); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm("Revoke this Mac's sync key? It will need a new key before it can sync again.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/sync/devices", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("Could not revoke this key.");
      await load(); toast.success("Sync key revoked.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not revoke this key."); }
    finally { setBusy(false); }
  };

  return <section className="settings-card settings-primary-card sync-settings">
    <header><div className="settings-icon"><RefreshCw /></div><div><h2>Offline sync</h2><p>{offline ? "Work on this Mac during a flight, then press Sync now when Hermes is reachable." : "Connect your private Mac copy to this cloud workspace."}</p></div></header>
    <div className="settings-card-body">
      {offline ? <>
        <div className="settings-current"><div><span>Cloud connection</span><strong>{status?.connected ? "Sync key saved on this Mac" : "Not connected"}</strong></div><div><span>Local changes waiting</span><strong>{status?.pending ?? "…"}</strong></div><div><span>Sync errors to review</span><strong>{status?.conflicts.length ?? "…"}</strong></div></div>
        <label className="settings-key-field"><span>{status?.connected ? "Replace an expired or revoked key" : "Paste the key created at contacts.vusalkhalilov.com → Settings"}</span><div><Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder="cgs_…" /><Button disabled={busy || !key.trim()} onClick={() => void connect()}><KeyRound />{status?.connected ? "Replace key" : "Connect"}</Button></div></label>
        <div className="sync-buttons"><Button disabled={busy || !status?.connected} onClick={() => void sync()}><CloudDownload />{busy ? "Syncing…" : status?.initialized ? "Sync now" : "Download cloud data"}</Button><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw />Refresh status</Button></div>
        {message && <p className="sync-message" role="status"><CheckCircle2 />{message}</p>}
        <p className="settings-security-note">Changes to the same field stay on this Mac for review in <strong>Duplication and sync errors</strong>. The cloud version stays available there too. Sync never sends messages.</p>
        {status?.history.map((run, index) => <div className="sync-history" key={`${run.created_at}-${index}`}><h3>{new Date(`${run.created_at}Z`).toLocaleString()} · {run.outgoing.length} uploaded, {run.incoming.length} downloaded</h3>{run.outgoing.length > 0 && <><strong>From this Mac</strong><ChangeList changes={run.outgoing} /></>}{run.incoming.length > 0 && <><strong>From Hermes</strong><ChangeList changes={run.incoming} /></>}{!run.incoming.length && !run.outgoing.length && <p>No record changes.</p>}</div>)}
      </> : <>
        <p>Create a key while signed in as Owner, then paste it into Settings on <strong>http://127.0.0.1:4177</strong>. The key is shown only once and expires after 180 days.</p>
        <label>Device name<Input maxLength={80} value={label} onChange={event => setLabel(event.target.value)} /></label><Button disabled={busy || !label.trim()} onClick={() => void create()}><KeyRound />Create sync key</Button>
        {newKey && <div className="sync-new-key"><strong>Copy this key now</strong><code>{newKey}</code><Button variant="outline" onClick={() => void navigator.clipboard.writeText(newKey).then(() => toast.success("Sync key copied."))}>Copy key</Button><p>Store it only in the local ContactGraph Settings page. Close this panel after connecting.</p></div>}
        <div className="sync-device-list"><h3>Connected devices</h3>{devices.length ? devices.map(device => <div key={device.id}><div><strong>{device.label}</strong><small>Created {new Date(`${device.created_at}Z`).toLocaleDateString()} · {device.last_used_at ? `Last sync ${new Date(`${device.last_used_at}Z`).toLocaleString()}` : "Never used"} · Expires {new Date(`${device.expires_at}Z`).toLocaleDateString()}</small></div><Button variant="outline" disabled={busy} onClick={() => void revoke(device.id)}><Trash2 />Revoke</Button></div>) : <p>No sync keys yet.</p>}</div>
      </>}
    </div>
  </section>;
}
