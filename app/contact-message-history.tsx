"use client";

import { useEffect, useState } from "react";
import { Check, Copy, History, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-context";

type ContactMessage = {
  sequence: number;
  holiday_id: string;
  holiday_title: string;
  contact_id: string;
  contact_name: string;
  language: string;
  content: string;
  model: string;
  status: "generated" | "sent";
  sent_at: string | null;
  created_at: string;
};

export function ContactMessageHistory({ contactId, contactName, refreshKey = 0 }: {
  contactId: string;
  contactName: string;
  refreshKey?: number;
}) {
  const { can } = useAuth();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setLiveVersion((value) => value + 1);
    window.addEventListener("contactgraph:collection:holiday_messages", refresh);
    return () => window.removeEventListener("contactgraph:collection:holiday_messages", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setLoading(true); });
    fetch(`/api/holiday-messages?contact_id=${encodeURIComponent(contactId)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { messages?: ContactMessage[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Message history could not be loaded");
        if (active) setMessages(body.messages ?? []);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Message history could not be loaded"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contactId, refreshKey, liveVersion]);

  const copy = async (message: ContactMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopied(message.sequence);
    setTimeout(() => setCopied(null), 1500);
  };
  const toggleSent = async (message: ContactMessage) => {
    const status = message.status === "sent" ? "generated" : "sent";
    setWorkingId(message.sequence);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => ({})) as { status?: "generated" | "sent"; sent_at?: string | null; error?: string };
      if (!response.ok || !body.status) throw new Error(body.error ?? "Message status could not be changed");
      setMessages((current) => current.map((item) => item.sequence === message.sequence ? { ...item, status: body.status!, sent_at: body.sent_at ?? null } : item));
      toast.success(body.status === "sent" ? "Message marked as sent" : "Message returned to generated drafts");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Message status could not be changed"); }
    finally { setWorkingId(null); }
  };

  if (loading) return <div className="contact-history-loading">Loading message history…</div>;
  if (!messages.length) return <div className="contact-history-empty"><History /><span>No generated or sent messages for {contactName} yet.</span></div>;
  return <div className="contact-history-list">{messages.map((message, index) => <article key={message.sequence}>
    <header><div><strong>{message.holiday_title || message.holiday_id}</strong><small>{message.language} · {message.created_at.replace("T", " ")} · {message.model}</small></div><div><span className={`message-status ${message.status}`}>{message.status === "sent" ? "Sent" : index === 0 ? "Latest generated" : "Generated"}</span><Button size="sm" variant="ghost" onClick={() => void copy(message)}>{copied === message.sequence ? <Check /> : <Copy />}{copied === message.sequence ? "Copied" : "Copy"}</Button>{can("drafts.manage") && <Button size="sm" variant="ghost" onClick={() => void toggleSent(message)} disabled={workingId === message.sequence}>{message.status === "sent" ? <Undo2 /> : <Send />}{message.status === "sent" ? "Mark unsent" : "Mark sent"}</Button>}</div></header>
    <p>{message.content}</p>
    {message.sent_at && <footer>Marked sent {message.sent_at.replace("T", " ")}</footer>}
  </article>)}</div>;
}
