import { useEffect, useState } from "react";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-context";
import { auth, db, isTrustedDevice, secureSignOut, setTrustedDevice } from "./firebase";
import { toast } from "sonner";

type SyncControl = {
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "conflicts";
  request_id?: string;
  worker_seen_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  result?: { contacts?: number; meetings?: number; firestore_writes?: number; local_changes?: number; hermes_changes?: number };
};

function ThreeWaySyncCard() {
  const { can } = useAuth();
  const [control, setControl] = useState<SyncControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!can("sync.run") || !db) return;
    return onSnapshot(doc(db, "sync_control", "threeway"), (snapshot) => {
      setControl(snapshot.exists() ? snapshot.data() as SyncControl : null);
      setLoading(false);
      setError("");
    }, () => { setLoading(false); setError("Sync status is unavailable. Try again when connected."); });
  }, [can]);
  useEffect(() => {
    if (!submittedId || control?.request_id !== submittedId) return;
    if (control.status === "succeeded") { toast.success("Hermes, Mac and Firebase are synchronized."); setSubmittedId(""); }
    if (control.status === "failed" || control.status === "conflicts") { toast.error(control.error || "Sync needs attention on the Mac."); setSubmittedId(""); }
  }, [control, submittedId]);
  if (!can("sync.run")) return null;
  const busy = control?.status === "queued" || control?.status === "running";
  const runnerOnline = Boolean(control?.worker_seen_at && Date.now() - Date.parse(control.worker_seen_at) < 120_000);
  const run = async () => {
    const firestore = db;
    if (!firestore || !auth?.currentUser) return toast.error("Sign in again before starting synchronization.");
    setSubmitting(true);
    try {
      const requestId = crypto.randomUUID();
      const request = { status: "queued", request_id: requestId, requested_at: new Date().toISOString(), requested_by: auth.currentUser.uid };
      await runTransaction(firestore, async (transaction) => {
        const reference = doc(firestore, "sync_control", "threeway");
        const snapshot = await transaction.get(reference);
        if (snapshot.exists() && ["queued", "running"].includes(String(snapshot.data().status))) throw new Error("A sync is already in progress.");
        if (snapshot.exists()) transaction.update(reference, request);
        else transaction.set(reference, { id: "threeway", ...request });
      });
      setSubmittedId(requestId);
      toast.success("Sync requested. The Mac runner will start it shortly.");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Could not request synchronization."); }
    finally { setSubmitting(false); }
  };
  return <section className="settings-card settings-primary-card" aria-live="polite">
    <div className="settings-card-body">
      <h2>Hermes · Mac · Firebase</h2>
      <p>Merge contact, meeting, holiday, canvas, follow-up, OSINT and photo changes across your three data stores.</p>
      {error && <p role="alert">{error}</p>}
      <div className="settings-current">
        <div><span>Sync status</span><strong>{loading ? "Loading…" : control?.status === "queued" ? "Waiting for Mac" : control?.status === "running" ? "Synchronizing…" : control?.status === "succeeded" ? "Completed" : control?.status === "conflicts" ? "Needs conflict review" : control?.status === "failed" ? "Failed" : "Ready"}</strong></div>
        <div><span>Mac runner</span><strong>{loading ? "Checking…" : runnerOnline ? "Online" : "Offline"}</strong></div>
        {control?.finished_at && <div><span>Last finished</span><strong>{new Date(control.finished_at).toLocaleString()}</strong></div>}
      </div>
      {control?.status === "succeeded" && control.result && <p role="status">{control.result.contacts ?? 0} contacts · {control.result.meetings ?? 0} meetings · {control.result.firestore_writes ?? 0} Firebase changes · {control.result.local_changes ?? 0} Mac changes · {control.result.hermes_changes ?? 0} Hermes changes</p>}
      {(control?.status === "failed" || control?.status === "conflicts") && <p role="alert">{control.error || "Review the private sync report on the Mac."}</p>}
      <Button disabled={loading || submitting || busy || Boolean(error)} onClick={() => void run()}>{submitting ? "Requesting…" : control?.status === "running" ? "Sync in progress" : control?.status === "queued" ? "Waiting for Mac" : "Run three-way sync"}</Button>
      {!runnerOnline && !loading && <p>The Mac must be awake with Docker and Tailscale running. A request will wait until its runner starts.</p>}
    </div>
  </section>;
}

function TrustedDeviceCard() {
  const [trusted, setTrusted] = useState(isTrustedDevice);
  return <section className="settings-card settings-primary-card"><div className="settings-card-body"><h2>Offline access</h2><p>Keep a cached copy of your private CRM data on this trusted device so routine edits can be made without a connection. Turning this off removes the cache after all local edits are synced.</p>
    <label className="accounts-check"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />Trust this device for offline access</label>
    <Button onClick={() => void setTrustedDevice(trusted).then(() => { toast.success("Device preference saved"); setTimeout(() => window.location.reload(), 500); }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not save device preference"))} disabled={trusted === isTrustedDevice()}>Save device preference</Button>
  </div></section>;
}

export function SettingsModule({ embedded = false }: { embedded?: boolean }) {
  return <div className={embedded ? "settings-content" : "settings-module"}>
    {!embedded && <div className="module-heading"><div><p className="eyebrow">Administration</p><h1 className="module-title">Settings</h1></div></div>}
    <div className="settings-grid"><ThreeWaySyncCard /><TrustedDeviceCard /><section className="settings-card"><div className="settings-card-body"><h2>Online services</h2><p>AI message generation and live OSINT collection require a private server. They are unavailable in this GitHub Pages release; saved history remains private.</p></div></section></div>
  </div>;
}

export function AccountSettingsModule() {
  const { user } = useAuth();
  const logout = async () => {
    try { await secureSignOut(); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Unsynced edits") || !window.confirm("Discard unsynced edits on this device and sign out?")) { toast.error(error instanceof Error ? error.message : "Could not sign out"); return; }
      await secureSignOut(true);
    }
    window.location.assign(import.meta.env.BASE_URL);
  };
  return <div className="settings-content"><div className="settings-grid"><section className="settings-card"><div className="settings-card-body"><h2>Account</h2><p>{user?.display_name} · {user?.username}</p><p>Role: {user?.role_id}</p><Button variant="outline" onClick={() => { void logout().catch((error) => toast.error(error instanceof Error ? error.message : "Could not sign out")); }}>Sign out</Button></div></section><TrustedDeviceCard /></div></div>;
}
