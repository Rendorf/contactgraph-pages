"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ExternalLink, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultOsintQuery, suggestMaigretHandles } from "@/scripts/osint-search.mjs";

type Contact = { id: string; name: string; organization?: string; role?: string; department?: string; locations?: string[]; photo_file?: string; socials?: Array<{ label?: string; value?: string }> };
type Candidate = { id: string; contact_id?: string; kind: "photo" | "position"; source_url: string; source_title: string; image_url?: string; thumbnail_url?: string; title?: string; organization?: string; period?: string; evidence: string; candidate_key: string; status?: "review" | "confirmed" | "dismissed"; payload?: Candidate };
type Item = { id: string; contact_id: string; url: string; title: string; summary: string; source: string; published: string; found_at: string; status: "review" | "saved" | "dismissed" };
type SearchItem = { url: string; title: string; summary: string; source: string; published: string; confirmed: boolean; found_at?: string };
type ProviderId = "searxng" | "gdelt" | "wikidata" | "openalex" | "maigret";
type Finding = { id?: string; contact_id?: string; provider: ProviderId; kind: string; key: string; url: string; title: string; summary: string; published: string; status?: "review" | "saved" | "dismissed"; found_at?: string; metadata?: Record<string, unknown>; payload?: Finding };
type ProviderResult = { findings?: Finding[]; items?: SearchItem[]; candidates?: Candidate[]; errors?: string[]; notices?: string[]; needs_handle?: boolean };
const providerOptions: Array<{ id: ProviderId; label: string; description: string }> = [
  { id: "searxng", label: "Web search", description: "SearXNG: web, news, photos, positions, and confirmed feeds" },
  { id: "gdelt", label: "Global news", description: "GDELT, with a labelled SearXNG news fallback when unavailable" },
  { id: "wikidata", label: "Public facts", description: "Wikidata: structured entity matches" },
  { id: "openalex", label: "Academic profiles", description: "OpenAlex: possible research authors" },
  { id: "maigret", label: "Public accounts", description: "Maigret: approved usernames across public sites" },
];
type SortOrder = "newest" | "oldest";
type SaveNotice = { state: "saving" | "saved" | "error"; message: string };
type Snapshot = {
  settings: { enabled: boolean; daily_time: string; last_run_date: string | null; last_run_at: string | null };
  monitors: Array<{ contact_id: string; query: string; enabled: boolean; providers: ProviderId[]; handles: string[] }>;
  feeds: Array<{ id: string; contact_id: string; url: string }>;
  items: Item[];
  candidates: Candidate[];
  findings: Finding[];
  runs: Array<{ id: string; contact_id: string; started_at: string; status: string; found: number; error: string }>;
  active: boolean;
};

async function api<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: payload === undefined ? undefined : { "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const defaultQuery = (contact?: Contact) => contact ? defaultOsintQuery(contact) : "";

function itemDate(item: { published?: string; found_at?: string }) {
  const published = item.published?.trim();
  const publishedTime = published ? Date.parse(published) : NaN;
  if (Number.isFinite(publishedTime)) return { time: publishedTime, label: "Published" };
  const foundTime = item.found_at ? Date.parse(item.found_at) : NaN;
  if (Number.isFinite(foundTime)) return { time: foundTime, label: "Found" };
  return null;
}

function orderByDate<T extends { published?: string; found_at?: string; url: string }>(items: T[], order: SortOrder): T[] {
  return [...items].sort((a, b) => {
    const aTime = itemDate(a)?.time;
    const bTime = itemDate(b)?.time;
    if (aTime === undefined) return bTime === undefined ? a.url.localeCompare(b.url) : 1;
    if (bTime === undefined) return -1;
    return (order === "newest" ? bTime - aTime : aTime - bTime) || a.url.localeCompare(b.url);
  });
}

function ItemDate({ published, foundAt, label }: { published?: string; foundAt?: string; label?: string }) {
  const date = itemDate({ published, found_at: foundAt });
  const parsed = date ? new Date(date.time) : null;
  const display = parsed
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", day: "numeric", month: "short", year: "numeric" }).format(parsed)
    : "Date unavailable";
  return <div className="osint-item-date"><CalendarDays aria-hidden="true" /><span>{label || date?.label || "Date"}</span><time dateTime={parsed?.toISOString()}>{display}</time></div>;
}

function CandidatePhoto({ candidate }: { candidate: Candidate }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="osint-candidate-photo osint-photo-unavailable">Preview unavailable. Open the source to inspect this image.</div>;
  return <img className="osint-candidate-photo" src={`/api/osint/photos/${encodeURIComponent(candidate.id)}/preview`} alt="Potential match; verify on source page" loading="lazy" onError={() => setFailed(true)} />;
}

function ProviderFindingBlock({ option, selectedForSearch, result, stored, contactId, busy, viewRequest, onSave, onUpdate, onDismiss }: {
  option: { id: ProviderId; label: string; description: string };
  selectedForSearch: boolean;
  result?: ProviderResult;
  stored: Finding[];
  contactId: string;
  busy: boolean;
  viewRequest: { version: number; view: "current" | "review" };
  onSave: (finding: Finding) => void;
  onUpdate: (finding: Finding, status: "saved" | "dismissed") => void;
  onDismiss: (finding: Finding) => void;
}) {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"current" | "review" | "saved">(viewRequest.view);
  const current = result?.findings || [];
  const review = stored.filter(item => item.status === "review");
  const saved = stored.filter(item => item.status === "saved");
  const visible = view === "current" ? current : view === "review" ? review : saved;
  return <section className="osint-panel">
    <button type="button" className="osint-section-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><h2>{option.label}</h2><span className="osint-provider-count">{view === "current" ? current.length : view === "review" ? review.length : saved.length}</span><ChevronDown className={open ? "" : "collapsed"} /></button>
    {open && <div><p className="osint-hint">{option.description}. Matches are unverified until you review their source.</p>
      <div className="osint-tabs"><button className={view === "current" ? "active" : ""} onClick={() => setView("current")}>Current search ({current.length})</button><button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Review ({review.length})</button><button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>Saved ({saved.length})</button></div>
      {result?.errors?.length ? <div className="osint-errors">{result.errors.join("; ")}</div> : null}
      {result?.notices?.length ? <div className="osint-notice">{result.notices.join("; ")}</div> : null}
      {view === "current" && result?.needs_handle && <p className="osint-empty">Approve at least one username above, then search again.</p>}
      {view === "current" && !result && <p className="osint-empty">{busy && selectedForSearch ? "Searching…" : selectedForSearch ? "Run a search to see findings." : "Not selected for this search."}</p>}
      {visible.length > 0 && <div className="osint-items">{visible.map(finding => {
        const value = finding.payload || finding;
        return <article key={finding.id || finding.key}><div className="osint-item-meta"><span>{finding.kind}</span>{finding.contact_id && <span>{finding.status}</span>}{Boolean(value.metadata?.source_name) && <span>Via {String(value.metadata?.source_name)}</span>}</div>{(finding.published || finding.found_at) && <ItemDate published={finding.published} foundAt={finding.found_at} label={finding.provider === "gdelt" && value.metadata?.upstream !== "searxng-news" ? "Seen by GDELT" : undefined} />}<a href={finding.url} target="_blank" rel="noopener noreferrer">{finding.title}<ExternalLink className="size-3.5" /></a><p>{finding.summary || "No description available"}</p>{Boolean(value.metadata?.handle) && <p>Username: @{String(value.metadata?.handle)}</p>}<div className="osint-item-actions">{view === "current" && contactId && <Button size="sm" variant="outline" onClick={() => onSave(finding)}><Check />Save for review</Button>}{view === "review" && <Button size="sm" variant="outline" onClick={() => onUpdate(finding, "saved")}><Check />Confirm match</Button>}{view !== "saved" && <Button size="sm" variant="ghost" onClick={() => view === "current" ? onDismiss(finding) : onUpdate(finding, "dismissed")}><X />Dismiss</Button>}</div></article>;
      })}</div>}
      {!visible.length && view !== "current" && <p className="osint-empty">No {view} findings.</p>}
      {view === "current" && result && !visible.length && !result.needs_handle && <p className="osint-empty">No matches found.</p>}
    </div>}
  </section>;
}

export function OsintModule({ contacts, onContactUpdated }: { contacts: Contact[]; onContactUpdated: (contact: Contact) => void }) {
  const { can } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [contactId, setContactId] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<ProviderId[]>(providerOptions.map(item => item.id));
  const [handles, setHandles] = useState<string[]>([]);
  const [handleInput, setHandleInput] = useState("");
  const [maigretDepth, setMaigretDepth] = useState<50 | 500>(50);
  const [providerResults, setProviderResults] = useState<Partial<Record<ProviderId, ProviderResult>>>({});
  const [providerViewRequest, setProviderViewRequest] = useState<{ version: number; view: "current" | "review" }>({ version: 0, view: "current" });
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [feedUrl, setFeedUrl] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [candidateResults, setCandidateResults] = useState<Candidate[]>([]);
  const [candidateTab, setCandidateTab] = useState<"search" | "review" | "confirmed">("search");
  const [updatesOpen, setUpdatesOpen] = useState(true);
  const [photosOpen, setPhotosOpen] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const saveInFlight = useRef(false);
  const [tab, setTab] = useState<"search" | "review" | "saved">("search");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const selected = contacts.find(contact => contact.id === contactId);
  const monitor = snapshot?.monitors.find(item => item.contact_id === contactId);
  const feeds = snapshot?.feeds.filter(item => item.contact_id === contactId) ?? [];
  const filteredContacts = useMemo(() => contacts.filter(contact => `${contact.name} ${contact.organization ?? ""}`.toLocaleLowerCase().includes(contactFilter.toLocaleLowerCase())).slice(0, 30), [contacts, contactFilter]);
  const sortedResults = useMemo(() => orderByDate(results, sortOrder), [results, sortOrder]);
  const visibleItems = useMemo(() => orderByDate((snapshot?.items ?? []).filter(item => item.status === tab && (!contactId || item.contact_id === contactId)), sortOrder), [snapshot, tab, contactId, sortOrder]);
  const visibleCandidates = candidateTab === "search" ? candidateResults : (snapshot?.candidates ?? []).filter(item => item.status === candidateTab && (!contactId || item.contact_id === contactId)).map(item => ({ ...item.payload!, id: item.id, contact_id: item.contact_id, status: item.status }));
  const nameById = useMemo(() => new Map(contacts.map(contact => [contact.id, contact.name])), [contacts]);
  const suggestedHandles = useMemo(() => suggestMaigretHandles(selected || { name: query }), [selected, query]);

  const reload = useCallback(async () => {
    const next = await api<Snapshot>("/api/osint");
    setSnapshot(next);
    setScheduleTime(next.settings.daily_time);
    setScheduleEnabled(next.settings.enabled);
  }, []);
  const refreshAfterSave = async () => {
    try { await reload(); }
    catch {
      setSaveNotice(current => current?.state === "saved" ? { state: "saved", message: `${current.message} The list could not refresh; use Refresh to check it.` } : current);
      toast.warning("Saved, but the list could not refresh. Use Refresh to check it.");
    }
  };
  const saveWithFeedback = async (savingMessage: string, successMessage: string, action: () => Promise<void>) => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaveBusy(true);
    setSaveNotice({ state: "saving", message: savingMessage });
    try {
      await action();
      setSaveNotice({ state: "saved", message: successMessage });
      toast.success(successMessage);
      await refreshAfterSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the change";
      setSaveNotice({ state: "error", message });
      toast.error(message);
    } finally {
      saveInFlight.current = false;
      setSaveBusy(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => void reload().catch(error => toast.error(error.message)), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => void reload().catch(() => undefined), 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const chooseContact = (contact: Contact) => {
    const savedMonitor = snapshot?.monitors.find(item => item.contact_id === contact.id);
    setContactId(contact.id);
    setContactFilter(contact.name);
    setQuery(savedMonitor?.query || defaultQuery(contact));
    setProviders(savedMonitor?.providers || providerOptions.map(item => item.id));
    setHandles(savedMonitor?.handles || []);
    setResults([]);
    setCandidateResults([]);
    setProviderResults({});
    setSearchQueries([]);
    setErrors([]);
  };
  const perform = async (persist: boolean) => {
    if (!query.trim()) return toast.error("Enter a search query");
    if (persist && !selected) return toast.error("Choose a contact to store results");
    setBusy(true); setErrors([]);
    if (persist) setSaveNotice({ state: "saving", message: "Running search and storing results…" });
    try {
      const result = await api<{ items: SearchItem[]; candidates: Candidate[]; providers: Partial<Record<ProviderId, ProviderResult>>; errors: string[]; added: number; candidate_added: number; finding_added: number; search_queries: string[] }>(persist ? "/api/osint/run" : "/api/osint/search", "POST", { ...(selected ? { contact_id: selected.id } : {}), query: query.trim(), providers, handles, maigret_depth: maigretDepth });
      setResults(persist ? [] : result.items.map(item => ({ ...item, found_at: new Date().toISOString() })));
      setCandidateResults(persist ? [] : result.candidates);
      setProviderResults(result.providers);
      setProviderViewRequest(current => ({ version: current.version + 1, view: persist ? "review" : "current" }));
      setSearchQueries(result.search_queries);
      setErrors(result.errors);
      if (persist) {
        const message = `${result.added} updates and ${result.candidate_added + result.finding_added} candidates stored for review`;
        setSaveNotice({ state: "saved", message });
        toast.success(message);
        setTab("review"); setCandidateTab("review");
        await refreshAfterSave();
      }
      else { setTab("search"); setCandidateTab("search"); toast.success("Search complete"); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed";
      if (persist) setSaveNotice({ state: "error", message });
      toast.error(message);
    }
    finally { setBusy(false); }
  };
  const saveSchedule = async () => {
    await saveWithFeedback("Saving collector schedule…", "Collector schedule saved", async () => { await api("/api/osint/settings", "PUT", { enabled: scheduleEnabled, daily_time: scheduleTime }); });
  };
  const toggleMonitor = async () => {
    if (!selected) return;
    await saveWithFeedback("Updating daily monitoring…", monitor?.enabled ? "Daily monitoring paused" : "Daily monitoring enabled", async () => { await api("/api/osint/monitor", "PUT", { contact_id: selected.id, query: query.trim() || defaultQuery(selected), enabled: !monitor?.enabled, providers, handles }); });
  };
  const saveMonitorQuery = async () => {
    if (!selected) return;
    await saveWithFeedback("Saving daily search choices…", "Daily search choices saved", async () => { await api("/api/osint/monitor", "PUT", { contact_id: selected.id, query: query.trim() || defaultQuery(selected), enabled: monitor?.enabled || false, providers, handles }); });
  };
  const addFeed = async () => {
    if (!selected || !feedUrl.trim()) return;
    await saveWithFeedback("Adding feed…", "Feed added", async () => { await api("/api/osint/feeds", "POST", { contact_id: selected.id, url: feedUrl.trim() }); setFeedUrl(""); });
  };
  const saveResult = async (item: SearchItem) => {
    if (!selected) return toast.error("Choose a contact to save updates");
    await saveWithFeedback("Saving update…", "Update saved for review", async () => { await api("/api/osint/items", "POST", { contact_id: contactId, item }); setResults(current => current.filter(value => value.url !== item.url)); });
  };
  const updateItem = async (item: Item, status: "saved" | "dismissed") => {
    await saveWithFeedback("Updating match…", status === "saved" ? "Person confirmed" : "Update dismissed", async () => { await api(`/api/osint/items/${encodeURIComponent(item.id)}`, "PUT", { status }); });
  };
  const saveCandidate = async (candidate: Candidate) => {
    if (!selected) return toast.error("Choose a contact to save candidates");
    await saveWithFeedback("Saving candidate…", "Candidate saved for review", async () => { await api("/api/osint/candidates", "POST", { id: candidate.id, contact_id: contactId }); setCandidateResults(current => current.filter(item => item.id !== candidate.id)); });
  };
  const saveFinding = async (finding: Finding) => {
    if (!selected || !finding.id) return toast.error("Choose a contact to save findings");
    await saveWithFeedback("Saving finding…", "Finding saved for review", async () => {
      await api("/api/osint/findings", "POST", { contact_id: selected.id, id: finding.id });
      setProviderResults(current => ({ ...current, [finding.provider]: { ...current[finding.provider], findings: current[finding.provider]?.findings?.filter(item => item.id !== finding.id) } }));
    });
  };
  const updateFinding = async (finding: Finding, status: "saved" | "dismissed") => {
    if (!finding.id) return;
    const findingId = finding.id;
    await saveWithFeedback("Updating finding…", status === "saved" ? "Finding confirmed" : "Finding dismissed", async () => { await api(`/api/osint/findings/${encodeURIComponent(findingId)}`, "PUT", { status }); });
  };
  const dismissCandidate = async (candidate: Candidate) => {
    if (candidateTab === "search") { setCandidateResults(current => current.filter(item => item.id !== candidate.id)); return; }
    await saveWithFeedback("Dismissing candidate…", "Candidate dismissed", async () => { await api(`/api/osint/candidates/${encodeURIComponent(candidate.id)}`, "PUT", { status: "dismissed" }); });
  };
  const confirmCandidate = async (candidate: Candidate, updateCurrent = false) => {
    const contact = contacts.find(item => item.id === candidate.contact_id);
    if (!contact) return toast.error("Contact not found");
    const replaceExisting = candidate.kind === "photo" && Boolean(contact.photo_file);
    if (replaceExisting && !window.confirm(`${contact.name} already has a photo. Replace it with this unverified web image?`)) return;
    if (updateCurrent && !window.confirm(`Replace current ${contact.role || "(no role)"} at ${contact.organization || "(no organization)"} with ${candidate.title || "(no role)"} at ${candidate.organization || "(no organization)"}?`)) return;
    if (!window.confirm(`Confirm that this ${candidate.kind} belongs to ${contact.name} and save it to the contact?`)) return;
    await saveWithFeedback("Saving confirmed match…", candidate.kind === "photo" ? "Contact photo saved" : "Position saved to history", async () => {
      const result = await api<{ contact: Contact }>(`/api/osint/candidates/${encodeURIComponent(candidate.id)}/confirm`, "POST", { update_current: updateCurrent, replace_existing: replaceExisting });
      onContactUpdated(result.contact);
    });
  };

  if (!can("osint.manage")) return <main className="osint-module"><div className="module-heading"><div><p className="eyebrow">Public information</p><h1 className="module-title">OSINT updates</h1><p className="module-subtitle">Saved and pending updates for contacts.</p></div></div><div className="osint-items">{snapshot?.items.length ? snapshot.items.map(item => <article key={item.id}><div className="osint-item-meta"><span>{nameById.get(item.contact_id) || "Contact unavailable"}</span><span>{item.status}</span></div><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a><p>{item.summary}</p></article>) : <p className="osint-empty">No updates recorded.</p>}</div></main>;
  return <main className="osint-module">
    <div className="module-heading"><div><p className="eyebrow">Local intelligence</p><h1 className="module-title">OSINT updates</h1><p className="module-subtitle">Search public sources for a contact or any name or topic.</p></div><div className="osint-status"><span className={snapshot?.active ? "busy" : ""} />{snapshot?.active ? "Collector running" : "Collector idle"}</div></div>
    {saveNotice && <div className={`osint-save-notice ${saveNotice.state}`} role={saveNotice.state === "error" ? "alert" : "status"} aria-live={saveNotice.state === "error" ? "assertive" : "polite"} aria-atomic="true">
      {saveNotice.state === "saving" ? <RefreshCw className="animate-spin" aria-hidden="true" /> : saveNotice.state === "saved" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      <div><strong>{saveNotice.state === "saving" ? "Saving" : saveNotice.state === "saved" ? "Saved" : "Save failed"}</strong><span>{saveNotice.message}</span></div>
      {saveNotice.state !== "saving" && <button type="button" onClick={() => setSaveNotice(null)} aria-label="Dismiss save status"><X aria-hidden="true" /></button>}
    </div>}
    <div className="osint-layout">
      <section className="osint-panel">
        <h2>Search public sources</h2><p className="osint-hint">A contact is optional for Search now. Choose one to use saved details, store findings, or enable daily monitoring.</p>
        <div className="osint-search-field"><Search className="size-4" /><Input value={contactFilter} onChange={event => { setContactFilter(event.target.value); if (contactId && event.target.value !== selected?.name) { setContactId(""); setQuery(""); setProviders(providerOptions.map(item => item.id)); setHandles([]); setResults([]); setCandidateResults([]); setProviderResults({}); setSearchQueries([]); setErrors([]); } }} placeholder="Optional: find a saved contact" aria-label="Find a contact for OSINT" /></div>
        {!contactId && contactFilter && <div className="osint-contact-results">{filteredContacts.map(contact => <button key={contact.id} onClick={() => chooseContact(contact)}><strong>{contact.name}</strong><span>{contact.organization || "No organization"}</span></button>)}</div>}
        {selected && <div className="osint-selected"><strong>{selected.name}</strong><span>{selected.organization || "No organization"}</span><button onClick={() => { setContactId(""); setContactFilter(""); setQuery(""); setProviders(providerOptions.map(item => item.id)); setHandles([]); setResults([]); setCandidateResults([]); setProviderResults({}); setSearchQueries([]); setErrors([]); }} aria-label="Clear selected contact"><X className="size-4" /></button></div>}
        <label className="osint-label">Search query<Input value={query} onChange={event => setQuery(event.target.value)} maxLength={300} placeholder="Enter a name, organization, or search terms" /></label>
        <fieldset className="osint-source-picker"><legend>Sources to search</legend>{providerOptions.map(option => <label key={option.id} title={option.description}><input type="checkbox" checked={providers.includes(option.id)} onChange={event => setProviders(current => event.target.checked ? [...current, option.id] : current.length > 1 ? current.filter(value => value !== option.id) : current)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
        {providers.includes("maigret") && <div className="osint-handles"><strong>Approved usernames for Maigret</strong><p className="osint-hint">A matching username may belong to someone else. Approve a suggestion or add a known handle before searching.</p><div className="osint-handle-chips">{suggestedHandles.map(handle => <button type="button" key={handle} className={handles.includes(handle) ? "active" : ""} onClick={() => setHandles(current => current.includes(handle) ? current.filter(value => value !== handle) : current.length < 3 ? [...current, handle] : current)}>{handles.includes(handle) ? "✓ " : "+ "}{handle}</button>)}</div><div className="osint-feed-entry"><Input value={handleInput} onChange={event => setHandleInput(event.target.value)} placeholder="Add known username" aria-label="Known username" /><Button size="sm" variant="outline" disabled={!/^[\p{L}\p{N}._-]{2,40}$/u.test(handleInput.trim()) || handles.length >= 3} onClick={() => { const value = handleInput.trim(); if (!handles.includes(value)) setHandles(current => [...current, value]); setHandleInput(""); }}>Add</Button></div>{handles.length > 0 && <div className="osint-handle-chips">{handles.map(handle => <button type="button" key={handle} onClick={() => setHandles(current => current.filter(value => value !== handle))}>{handle} ×</button>)}</div>}<label className="osint-depth-label">Manual scan depth <select value={maigretDepth} onChange={event => setMaigretDepth(Number(event.target.value) as 50 | 500)}><option value={50}>Top 50 sites</option><option value={500}>Deep: top 500 sites</option></select></label></div>}
        {selected && <p className="osint-hint">Automatic searches use the contact’s name, organization, role or department, and location when available. You can edit the query; private notes and contact details are not sent to search engines.</p>}
        {!selected && <p className="osint-hint">Free-text searches use exactly what you type. Results are temporary and are not linked to a contact or added to the run history. Choose a contact before saving or monitoring.</p>}
        {searchQueries.length > 0 && <p className="osint-hint">Queries used: {searchQueries.join(" · ")}</p>}
        <div className="osint-actions"><Button disabled={!query.trim() || busy || saveBusy} onClick={() => void perform(false)}><Search />{busy ? "Searching…" : "Search now"}</Button><Button variant="outline" disabled={!selected || !query.trim() || busy || saveBusy} onClick={() => void perform(true)} title={!selected ? "Choose a contact to store results" : undefined}><Play />Run and store</Button></div>
        {selected && <div className="osint-monitor"><div><strong>Daily monitoring</strong><span>{monitor?.enabled ? "On for this contact" : "Off for this contact"} · {snapshot?.monitors.filter(item => item.enabled).length ?? 0}/25 selected<br />Selected sources and approved handles are saved per contact. Maigret runs daily only with approved handles, always at top 50 sites.</span></div><div className="osint-actions"><Button size="sm" variant="outline" disabled={saveBusy || busy} onClick={() => void saveMonitorQuery()}>Save daily choices</Button><Button size="sm" variant="outline" disabled={saveBusy || busy} onClick={() => void toggleMonitor()}>{monitor?.enabled ? "Pause" : "Monitor"}</Button></div></div>}
        {selected && <div className="osint-feeds"><h3>Confirmed feeds</h3><p className="osint-hint">Add a public HTTPS RSS/Atom URL or a documented RSSHub route in the form <code>rsshub:/route</code>. Feed items attach directly to this contact.</p><div className="osint-feed-entry"><Input value={feedUrl} onChange={event => setFeedUrl(event.target.value)} placeholder="https://… or rsshub:/…" aria-label="Feed URL" /><Button size="icon" variant="outline" disabled={saveBusy || busy || !feedUrl.trim()} onClick={() => void addFeed()} aria-label="Add feed"><Plus /></Button></div>{feeds.map(feed => <div className="osint-feed" key={feed.id}><span title={feed.url}>{feed.url}</span><button disabled={saveBusy || busy} aria-label="Remove feed" onClick={() => void saveWithFeedback("Removing feed…", "Feed removed", async () => { await api(`/api/osint/feeds/${encodeURIComponent(feed.id)}`, "DELETE"); })}><Trash2 className="size-4" /></button></div>)}</div>}
      </section>
      <div className="osint-main">
        <section className="osint-panel osint-schedule"><div><h2>Daily collector</h2><p className="osint-hint">Runs only while the Hermes app is running. Times use Asia/Baku.</p></div><div className="osint-schedule-controls"><label><input type="checkbox" checked={scheduleEnabled} onChange={event => setScheduleEnabled(event.target.checked)} /> Enabled</label><Input type="time" value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} aria-label="Daily run time" /><Button size="sm" disabled={saveBusy || busy} onClick={() => void saveSchedule()}>Save schedule</Button></div><small>Last run: {snapshot?.settings.last_run_at ? new Date(snapshot.settings.last_run_at).toLocaleString() : "Never"}</small></section>
        <section className="osint-panel"><div className="osint-results-heading"><button type="button" className="osint-section-toggle" aria-expanded={updatesOpen} aria-controls="osint-updates-content" onClick={() => setUpdatesOpen(open => !open)}><h2>Web search · SearXNG</h2><ChevronDown className={updatesOpen ? "" : "collapsed"} /></button><div className="osint-results-controls"><label htmlFor="osint-sort-order">Order by date</label><select id="osint-sort-order" value={sortOrder} onChange={event => setSortOrder(event.target.value as SortOrder)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><Button size="icon" variant="ghost" onClick={() => void reload().catch(error => toast.error(error.message))} aria-label="Refresh OSINT updates"><RefreshCw /></Button></div></div>{updatesOpen && <div id="osint-updates-content"><div className="osint-tabs"><button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Current search ({results.length})</button><button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>Review ({snapshot?.items.filter(item => item.status === "review").length ?? 0})</button><button className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>Saved ({snapshot?.items.filter(item => item.status === "saved").length ?? 0})</button></div>
          {errors.length > 0 && <div className="osint-errors">Some sources failed: {errors.join("; ")}</div>}
          {tab === "search" ? (results.length ? <div className="osint-items">{sortedResults.map(item => <article key={item.url}><div className="osint-item-meta"><span>{item.source}</span>{item.confirmed && <span>Confirmed feed</span>}</div><ItemDate published={item.published} foundAt={item.found_at} /><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<ExternalLink className="size-3.5" /></a><p>{item.summary}</p><div className="osint-item-actions">{selected && <Button size="sm" variant="outline" onClick={() => void saveResult(item)}><Check />Save</Button>}<Button size="sm" variant="ghost" onClick={() => setResults(current => current.filter(value => value.url !== item.url))}><X />Dismiss</Button></div></article>)}</div> : <p className="osint-empty">Enter a query and run a search to see possible updates here.</p>) : (visibleItems.length ? <div className="osint-items">{visibleItems.map(item => <article key={item.id}><div className="osint-item-meta"><span>{nameById.get(item.contact_id) || "Contact unavailable"}</span><span>{item.source}</span></div><ItemDate published={item.published} foundAt={item.found_at} /><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<ExternalLink className="size-3.5" /></a><p>{item.summary}</p><div className="osint-item-actions">{tab === "review" && <Button size="sm" variant="outline" onClick={() => void updateItem(item, "saved")}><Check />Confirm person</Button>}<Button size="sm" variant="ghost" onClick={() => void updateItem(item, "dismissed")}><X />Dismiss</Button></div></article>)}</div> : <p className="osint-empty">No {tab} updates{contactId ? " for this contact" : ""} yet.</p>)}
        </div>}</section>
        <section className="osint-panel"><button type="button" className="osint-section-toggle" aria-expanded={photosOpen} aria-controls="osint-photos-content" onClick={() => setPhotosOpen(open => !open)}><h2>SearXNG · potential photos &amp; positions</h2><ChevronDown className={photosOpen ? "" : "collapsed"} /></button>{photosOpen && <div id="osint-photos-content"><p className="osint-hint">Public matches are unverified. Inspect the source and confirm identity before saving to a contact.</p>
          <div className="osint-tabs"><button className={candidateTab === "search" ? "active" : ""} onClick={() => setCandidateTab("search")}>Current search ({candidateResults.length})</button><button className={candidateTab === "review" ? "active" : ""} onClick={() => setCandidateTab("review")}>Review ({snapshot?.candidates.filter(item => item.status === "review").length ?? 0})</button><button className={candidateTab === "confirmed" ? "active" : ""} onClick={() => setCandidateTab("confirmed")}>Confirmed ({snapshot?.candidates.filter(item => item.status === "confirmed").length ?? 0})</button></div>
          {visibleCandidates.length ? <div className="osint-candidate-grid">{visibleCandidates.map(candidate => <article className="osint-candidate" key={candidate.id}><div className="osint-item-meta"><span>{candidate.kind === "photo" ? "Potential photo" : "Potential position"}</span><span>{nameById.get(candidate.contact_id || contactId) || "Unlinked search"}</span></div>{candidate.kind === "photo" ? <CandidatePhoto candidate={candidate} /> : <div className="osint-position"><strong>{candidate.title}</strong><span>{candidate.organization || "Organization not stated"}</span><small>{candidate.period || "Period unknown"}</small></div>}<p>{candidate.evidence || "No context available"}</p><a href={candidate.source_url} target="_blank" rel="noopener noreferrer">View source <ExternalLink className="size-3.5" /></a><div className="osint-item-actions">{candidateTab === "search" && selected && <Button size="sm" variant="outline" onClick={() => void saveCandidate(candidate)}><Check />Save for review</Button>}{candidateTab === "review" && <>{candidate.kind === "photo" ? <Button size="sm" variant="outline" onClick={() => void confirmCandidate(candidate)}><Check />Use as contact photo</Button> : <><Button size="sm" variant="outline" onClick={() => void confirmCandidate(candidate)}><Check />Add to history</Button><Button size="sm" variant="outline" onClick={() => void confirmCandidate(candidate, true)}>Set as current</Button></>}</>}{candidateTab !== "confirmed" && <Button size="sm" variant="ghost" onClick={() => void dismissCandidate(candidate)}><X />Dismiss</Button>}</div></article>)}</div> : <p className="osint-empty">No {candidateTab === "search" ? "candidates in this search" : `${candidateTab} candidates`}{contactId ? " for this contact" : ""}.</p>}
        </div>}</section>
        {providerOptions.filter(option => option.id !== "searxng").map(option => <ProviderFindingBlock key={`${option.id}:${providerViewRequest.version}`} option={option} selectedForSearch={providers.includes(option.id)} result={providerResults[option.id]} stored={(snapshot?.findings || []).filter(finding => finding.provider === option.id && (!contactId || finding.contact_id === contactId))} contactId={contactId} busy={busy} viewRequest={providerViewRequest} onSave={finding => void saveFinding(finding)} onUpdate={(finding, status) => void updateFinding(finding, status)} onDismiss={finding => setProviderResults(current => ({ ...current, [option.id]: { ...current[option.id], findings: current[option.id]?.findings?.filter(item => item.id !== finding.id) } }))} />)}
        <section className="osint-panel"><h2>Recent runs</h2><div className="osint-runs">{snapshot?.runs.length ? snapshot.runs.slice(0, 8).map(run => <div key={run.id}><span>{nameById.get(run.contact_id) || "Contact unavailable"} · {run.status} · {run.found} found</span><small>{new Date(run.started_at).toLocaleString()}</small>{run.error && <em title={run.error}>Source error</em>}</div>) : <p className="osint-empty">No searches run yet.</p>}</div></section>
      </div>
    </div>
  </main>;
}
