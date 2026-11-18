"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarDays, Mail, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type TimelineSource = "meeting" | "followup" | "message" | "occasion";
type TimelineEntry = { id: string; source: TimelineSource; occurred_at: string; title: string; summary: string; status: string };
type TimelineResponse = { items?: TimelineEntry[]; next_cursor?: string | null; error?: string };
const sourceDetails = {
  meeting: { label: "Meetings", icon: CalendarDays },
  followup: { label: "Follow-ups", icon: CalendarCheck2 },
  message: { label: "Messages", icon: Mail },
  occasion: { label: "Occasions", icon: Sparkles },
} as const;

export function ContactTimeline({ contactId, active }: { contactId: string; active: boolean }) {
  const [items, setItems] = useState<TimelineEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | TimelineSource>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async (nextCursor?: string | null) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/timeline?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as TimelineResponse;
      if (!response.ok) throw new Error(body.error || "Timeline could not be loaded.");
      setItems((current) => nextCursor ? [...current, ...(body.items ?? [])] : body.items ?? []);
      setCursor(body.next_cursor ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Timeline could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (active) void load(null); }, [active, contactId]);
  const visible = useMemo(() => items.filter((item) => filter === "all" || item.source === filter), [filter, items]);
  return <section className="relationship-timeline" aria-labelledby="relationship-timeline-title">
    <div className="timeline-heading"><div><p className="eyebrow">Relationship history</p><h3 id="relationship-timeline-title">Timeline</h3></div><Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(null)}><RefreshCw />Refresh</Button></div>
    <div className="timeline-filters" role="group" aria-label="Filter timeline"><button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>{(Object.entries(sourceDetails) as [TimelineSource, (typeof sourceDetails)[TimelineSource]][]).map(([source, details]) => items.some((item) => item.source === source) && <button type="button" key={source} className={filter === source ? "active" : ""} aria-pressed={filter === source} onClick={() => setFilter(source)}>{details.label}</button>)}</div>
    {error ? <div className="timeline-state" role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load(null)}>Try again</Button></div> : loading && !items.length ? <div className="timeline-state" role="status">Loading relationship history…</div> : visible.length ? <ol className="timeline-list">{visible.map((item) => { const details = sourceDetails[item.source]; const Icon = details.icon; return <li key={item.id}><span className={`timeline-icon ${item.source}`}><Icon /></span><article><div><strong>{item.title}</strong><time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</time></div><p>{item.summary}</p><small>{details.label} · {item.status.replaceAll("_", " ")}</small></article></li>; })}</ol> : <div className="timeline-state">No activity is recorded in this view yet.</div>}
    {cursor && filter === "all" && <Button className="mt-3 w-full" variant="outline" disabled={loading} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load older activity"}</Button>}
  </section>;
}
