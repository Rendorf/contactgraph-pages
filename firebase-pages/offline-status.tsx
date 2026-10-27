import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPending, resolveConflict, syncPending, type Pending } from "./offline";
import { isTrustedDevice } from "./firebase";

export function OfflineStatus() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(navigator.onLine);
  const refresh = () => { void getPending().then(setPending).catch(() => setPending([])); };
  useEffect(() => {
    refresh();
    if (navigator.onLine) void syncPending().then(refresh);
    const update = () => { setConnected(navigator.onLine); refresh(); };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("contactgraph:outbox", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("contactgraph:outbox", update); };
  }, []);
  const conflicts = pending.filter((item) => item.status === "conflict");
  const resolve = async (item: Pending, choice: "mine" | "server") => {
    try { await resolveConflict(item.key, choice); refresh(); window.dispatchEvent(new Event("contactgraph:sync")); window.dispatchEvent(new Event(`contactgraph:collection:${item.collection}`)); toast.success(choice === "server" ? "Shared version kept" : "Your edit queued for sync"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Conflict could not be resolved"); }
  };
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label="Open sync status">{!connected ? "Offline" : conflicts.length ? `${conflicts.length} conflicts` : pending.length ? `${pending.length} pending` : "Synced"}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Sync status</DialogTitle><DialogDescription>{isTrustedDevice() ? "Edits on this device sync when you are online. Review conflicts before choosing which version to keep." : "Enable trusted-device offline access in Settings to cache private data and make offline edits."}</DialogDescription></DialogHeader>
      {!pending.length ? <p>All local edits are synced.</p> : pending.map((item) => <div key={item.key} className="rounded-lg border p-3"><strong>{item.collection} · {item.item?.name || item.item?.title || item.id}</strong><p>{item.status === "conflict" ? "This record changed in the shared database." : "Waiting to sync"}</p>{item.status === "conflict" && <><details className="my-2"><summary>Compare both versions</summary><div className="grid gap-2 sm:grid-cols-2"><div><strong>On this device</strong><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.item ?? { deleted: true }, null, 2)}</pre></div><div><strong>Shared version</strong><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.remote ?? { deleted: true }, null, 2)}</pre></div></div></details><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void resolve(item, "mine")}>Keep my edit</Button><Button size="sm" variant="outline" onClick={() => void resolve(item, "server")}>Use shared version</Button></div></>}</div>)}
      {pending.some((item) => item.status === "pending") && connected && <Button onClick={() => void syncPending().then(refresh)}>Sync now</Button>}
    </DialogContent></Dialog>
  </>;
}
