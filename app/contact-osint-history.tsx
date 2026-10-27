"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Report = {
  id: string;
  contact_id: string;
  title?: string;
  summary?: string;
  evidence?: string;
  source_title?: string;
  url?: string;
  source_url?: string;
  published?: string;
  found_at?: string;
  kind?: string;
  provider?: string;
  source?: string;
  status?: string;
  payload?: Report;
};
type Snapshot = { items?: Report[]; findings?: Report[]; candidates?: Report[] };
type DisplayReport = Report & { category: string; date: string; link: string | null };

function safeSourceUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function reportDate(report: Report) {
  for (const value of [report.published, report.found_at]) {
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return "";
}

export function ContactOsintHistory({ contactId, open }: { contactId: string; open: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/osint/contacts/${encodeURIComponent(contactId)}/reports`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not load OSINT reports.");
        return response.json() as Promise<Snapshot>;
      })
      .then(body => { if (!controller.signal.aborted) { setSnapshot(body); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load OSINT reports."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contactId, open, version]);

  const reports = useMemo(() => {
    const include = (report: Report) => report.contact_id === contactId && report.status !== "dismissed";
    const collected: DisplayReport[] = [
      ...(snapshot?.items || []).filter(include).map(report => ({ ...report, category: "Update", date: reportDate(report), link: safeSourceUrl(report.url) })),
      ...(snapshot?.findings || []).filter(include).map(report => ({ ...report, category: report.provider || "Public finding", date: reportDate(report), link: safeSourceUrl(report.url) })),
      ...(snapshot?.candidates || []).filter(include).map(report => ({ ...report, title: report.payload?.title || report.title, source_title: report.payload?.source_title || report.source_title, evidence: report.payload?.evidence || report.evidence, category: report.kind === "photo" ? report.status === "confirmed" ? "Contact photo" : "Potential photo" : "Position", date: reportDate(report), link: safeSourceUrl(report.source_url) })),
    ];
    return collected.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [contactId, snapshot]);

  return <section className="editor-section">
    <div className="contact-history-heading"><h3>OSINT reports</h3><span>Saved public findings for this contact</span></div>
    <div className="mt-3 flex items-center justify-between gap-2"><small className="text-[#71858f]">{loading ? "Loading reports…" : `${reports.length} saved report${reports.length === 1 ? "" : "s"}`}</small><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(""); setVersion(value => value + 1); }}><RefreshCw />Refresh</Button></div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!loading && !error && reports.length === 0 && <p className="mt-3 text-sm text-[#71858f]">No OSINT reports have been saved for this contact.</p>}
    {reports.length > 0 && <div className="mt-3 space-y-3">{reports.map(report => <article key={`${report.category}:${report.id}`} className="rounded-lg border bg-white p-3 text-sm">
      <div className="mb-1 flex flex-wrap gap-2 text-xs text-[#71858f]"><span>{report.category}</span><span>·</span><span>{report.status === "review" ? "For review" : "Confirmed"}</span>{report.date && <><span>·</span><time dateTime={report.date}>{new Date(report.date).toLocaleDateString()}</time></>}</div>
      <strong className="block text-[#244957]">{report.title || report.source_title || (report.kind === "photo" ? "Potential photo" : "Untitled finding")}</strong>
      {(report.summary || report.evidence) && <p className="mt-1 whitespace-pre-wrap text-[#647985]">{report.summary || report.evidence}</p>}
      {report.link && <a className="mt-2 inline-flex items-center gap-1 text-[#12646a] underline" href={report.link} target="_blank" rel="noopener noreferrer">Open source <ExternalLink className="size-3.5" /></a>}
    </article>)}</div>}
  </section>;
}
