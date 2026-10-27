"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Copy, GitMerge, Mail, Phone, Search, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type DuplicateContact = {
  id: string;
  name: string;
  organization?: string;
  emails?: Array<{ address?: string }>;
  phones?: Array<{ number?: string }>;
  [key: string]: unknown;
};
type DuplicatePair = { key: string; first: DuplicateContact; second: DuplicateContact; reasons: Set<string> };
type SyncConflict = { kind: string; id: string; fields: string[]; base: Record<string, unknown> | null; local: Record<string, unknown> | null; remote: Record<string, unknown> | null; related?: Record<string, Record<string, unknown>> | null; created_at: string };

const cleanName = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const cleanEmail = (value: string) => value.trim().toLocaleLowerCase();
const cleanPhone = (value: string) => value.replace(/\D/g, "");

function findDuplicatePairs(contacts: DuplicateContact[]) {
  const buckets = new Map<string, Set<string>>();
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const add = (key: string, contactId: string) => {
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(contactId);
  };
  for (const contact of contacts) {
    const name = cleanName(contact.name || "");
    if (name.length >= 4) add(`name:${name}`, contact.id);
    for (const item of contact.emails ?? []) {
      const email = cleanEmail(item.address ?? "");
      if (email.includes("@")) add(`email:${email}`, contact.id);
    }
    for (const item of contact.phones ?? []) {
      const phone = cleanPhone(item.number ?? "");
      if (phone.length >= 8) add(`phone:${phone}`, contact.id);
    }
  }
  const pairs = new Map<string, DuplicatePair>();
  for (const [matchKey, ids] of buckets) {
    const members = [...ids].sort((a, b) => a.localeCompare(b));
    if (members.length < 2) continue;
    const reason = matchKey.startsWith("name:") ? "Same normalized name" : matchKey.startsWith("email:") ? "Same email address" : "Same phone number";
    // A star-shaped set keeps large shared identifiers from creating a quadratic number of pair cards.
    for (const otherId of members.slice(1)) {
      const first = byId.get(members[0]);
      const second = byId.get(otherId);
      if (!first || !second) continue;
      const key = [first.id, second.id].sort().join("|");
      const pair = pairs.get(key) ?? { key, first, second, reasons: new Set<string>() };
      pair.reasons.add(reason);
      pairs.set(key, pair);
    }
  }
  return [...pairs.values()].sort((a, b) => b.reasons.size - a.reasons.size || a.first.name.localeCompare(b.first.name) || a.second.name.localeCompare(b.second.name));
}

export function DuplicatesModule({ contacts, onOpenContact, onMerge, onDelete }: {
  contacts: DuplicateContact[];
  onOpenContact: (contactId: string) => void;
  onMerge: (first: DuplicateContact, second: DuplicateContact) => void;
  onDelete: (first: DuplicateContact, second: DuplicateContact, targets: DuplicateContact[]) => Promise<void>;
}) {
  const { can, offline, user } = useAuth();
  const [query, setQuery] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<DuplicateContact[]>([]);
  const [deletePair, setDeletePair] = useState<[DuplicateContact, DuplicateContact] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [resolving, setResolving] = useState("");
  const loadConflicts = useCallback(async () => {
    if (!offline || user?.role_id !== "owner") return;
    const response = await fetch("/api/sync/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load sync errors.");
    const body = await response.json() as { conflicts: SyncConflict[] };
    setSyncConflicts(body.conflicts);
  }, [offline, user?.role_id]);
  useEffect(() => {
    if (!offline || user?.role_id !== "owner") return;
    let active = true;
    fetch("/api/sync/status", { cache: "no-store" }).then(response => response.json() as Promise<{ conflicts?: SyncConflict[] }>).then(body => {
      if (active) setSyncConflicts(body.conflicts || []);
    }).catch(() => toast.error("Could not load sync errors."));
    return () => { active = false; };
  }, [offline, user?.role_id]);
  const resolveSync = async (conflict: SyncConflict, choice: "local" | "remote") => {
    setResolving(`${conflict.kind}:${conflict.id}`);
    try {
      const response = await fetch("/api/sync/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: conflict.kind, id: conflict.id, choice }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not resolve this sync error.");
      await loadConflicts();
      window.dispatchEvent(new Event("contactgraph:sync"));
      toast.success(choice === "local" ? "Mac version will be retried on the next sync." : "Hermes version kept on this Mac.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not resolve this sync error."); }
    finally { setResolving(""); }
  };
  const pairs = useMemo(() => findDuplicatePairs(contacts), [contacts]);
  const shownPairs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return pairs.filter(({ first, second, reasons }) => !needle || `${first.name} ${first.organization ?? ""} ${second.name} ${second.organization ?? ""} ${[...reasons].join(" ")}`.toLocaleLowerCase().includes(needle));
  }, [pairs, query]);
  const confirmDelete = async () => {
    if (!deleteTargets.length || !deletePair) return;
    setDeleting(true);
    try {
      await onDelete(deletePair[0], deletePair[1], deleteTargets);
      setDeleteTargets([]);
      setDeletePair(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Contacts could not be deleted"); }
    finally { setDeleting(false); }
  };

  return <div className="duplicates-module">
    <div className="module-heading"><div><p className="eyebrow">Data quality</p><h1 className="module-title">Duplication and sync errors</h1><p className="module-subtitle">Review possible duplicate contacts and changes that need your decision after offline sync.</p></div><div className="duplicate-count"><Copy />{pairs.length.toLocaleString()} possible pairs</div></div>
    {offline && <section className="sync-conflicts"><h2>Sync errors to review <span>{syncConflicts.length}</span></h2>{syncConflicts.length ? syncConflicts.map(conflict => {
      const record = conflict.local || conflict.remote || conflict.base;
      const title = String(record?.name || record?.title || record?.contact_id || conflict.id);
      const busy = resolving === `${conflict.kind}:${conflict.id}`;
      return <article key={`${conflict.kind}:${conflict.id}`}><div className="sync-conflict-heading"><AlertTriangle /><div><strong>{title}</strong><small>{conflict.kind} · {conflict.fields.join(", ")} changed on both sides</small></div></div><p>{conflict.related ? "Hermes has related meetings or follow-ups. Keeping this Mac's deletion will also remove those records on the next sync." : "Hermes and this Mac changed this record while they were apart."} Choose which version to keep, then sync again if you kept the Mac version.</p><details><summary>Compare versions</summary><div className="sync-conflict-versions">{(["base", "local", "remote"] as const).map(side => <div key={side}><strong>{side === "base" ? "Before" : side === "local" ? "This Mac" : "Hermes"}</strong><pre>{conflict[side] ? JSON.stringify(conflict[side], null, 2) : "Deleted / not present"}</pre></div>)}{conflict.related && <div><strong>Related records on Hermes</strong><pre>{JSON.stringify(conflict.related, null, 2)}</pre></div>}</div></details><div className="sync-conflict-actions"><Button variant="outline" disabled={busy} onClick={() => void resolveSync(conflict, "remote")}>Keep Hermes</Button><Button disabled={busy} onClick={() => void resolveSync(conflict, "local")}>Keep this Mac and retry sync</Button></div></article>;
    }) : <p className="sync-no-conflicts">No sync errors. Changes to different contact fields are merged automatically.</p>}</section>}
    <h2 className="duplicate-section-title">Possible duplicate contacts</h2>
    <div className="duplicate-search"><Search /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a contact in the duplicate list" aria-label="Search possible duplicates" /></div>
    {shownPairs.length ? <div className="duplicate-pair-list">{shownPairs.map(({ key, first, second, reasons }) => <article key={key}>
      <div className="duplicate-pair-people">{[first, second].map((contact, index) => <div key={contact.id} className="duplicate-person"><span className={`duplicate-avatar duplicate-avatar-${index}`}>{contact.name.trim().slice(0, 1).toLocaleUpperCase()}</span><div><strong>{contact.name}</strong><small>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</small><span><Mail />{contact.emails?.map((item) => item.address).filter(Boolean).join(", ") || "Email not recorded"}</span><span><Phone />{contact.phones?.map((item) => item.number).filter(Boolean).join(", ") || "Phone not recorded"}</span><button type="button" className="duplicate-open-contact" onClick={() => onOpenContact(contact.id)} aria-label={`Open details for ${contact.name}`}>Open details<ChevronRight /></button></div></div>)}</div>
      <div className="duplicate-pair-footer"><div className="duplicate-reasons">{[...reasons].map((reason) => <span key={reason}>{reason}</span>)}</div><div>{!offline && can("duplicates.manage") && <Button size="sm" onClick={() => onMerge(first, second)}><GitMerge />Review merge</Button>}{can("duplicates.manage") && <><Button size="sm" variant="outline" onClick={() => { setDeletePair([first, second]); setDeleteTargets([first]); }}><Trash2 />Delete {first.name.split(/\s+/)[0]}</Button><Button size="sm" variant="outline" onClick={() => { setDeletePair([first, second]); setDeleteTargets([second]); }}><Trash2 />Delete {second.name.split(/\s+/)[0]}</Button><Button size="sm" variant="destructive" onClick={() => { setDeletePair([first, second]); setDeleteTargets([first, second]); }}><Trash2 />Delete both</Button></>}</div></div>
    </article>)}</div> : <div className="duplicate-empty"><UsersRound /><strong>{query ? "No matching duplicate pairs" : "No possible duplicates found"}</strong><span>{query ? "Try a different search." : "Contacts are compared using matching names, email addresses, and phone numbers."}</span></div>}
    <AlertDialog open={deleteTargets.length > 0} onOpenChange={(open) => { if (!open && !deleting) setDeleteTargets([]); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTargets.length === 2 ? `Delete both ${deleteTargets[0].name} and ${deleteTargets[1].name}?` : `Delete ${deleteTargets[0]?.name}?`}</AlertDialogTitle><AlertDialogDescription>{deleteTargets.length === 2 ? "Both contacts and their related meetings and follow-ups will be removed from the active database and generated exports in one action. Their previous contact records stay in the change history." : "This removes the contact and its related meetings and follow-ups from the active database and generated exports. The previous contact record stays in the change history."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>{deleting ? "Deleting…" : deleteTargets.length === 2 ? "Delete both contacts" : "Delete contact"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
