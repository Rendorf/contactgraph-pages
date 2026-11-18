"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type MeetingRecording = {
  id: string;
  meeting_id: string;
  duration_ms: number;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_name: string;
  transcript: string;
  transcript_status: "pending" | "processing" | "ready" | "failed";
  transcript_language?: string;
  transcript_model?: string;
  created_at?: string;
  updated_at?: string;
  revision?: number;
  storage_backend?: "device";
  pending_sync?: boolean;
};

type CaptureState = "idle" | "recording" | "paused" | "uploading";
const maximumDuration = 14_400_000;
const supportedType = () => ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
const clock = (milliseconds: number) => `${Math.floor(milliseconds / 3_600_000).toString().padStart(2, "0")}:${Math.floor(milliseconds % 3_600_000 / 60_000).toString().padStart(2, "0")}:${Math.floor(milliseconds % 60_000 / 1000).toString().padStart(2, "0")}`;

export function MeetingRecorder({ meetingId, ensureMeeting, recordings, onChange }: {
  meetingId: string | null;
  ensureMeeting: () => Promise<string>;
  recordings: MeetingRecording[];
  onChange: (recording: MeetingRecording | null, deletedId?: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<CaptureState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [workingId, setWorkingId] = useState("");
  const [pending, setPending] = useState<{ blob: Blob; duration: number; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const next = elapsedRef.current + 500;
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= maximumDuration) recorder.current?.stop();
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state !== "idle") event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => { const url = pending?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [pending?.url]);

  const upload = async (blob: Blob, duration: number) => {
    setState("uploading");
    try {
      const id = meetingId || await ensureMeeting();
      const response = await fetch(`/api/meetings/${encodeURIComponent(id)}/recordings`, {
        method: "POST",
        headers: { "content-type": blob.type.split(";", 1)[0], "x-recording-duration-ms": String(Math.max(1, Math.min(duration, maximumDuration))) },
        body: blob,
      });
      const body = await response.json().catch(() => ({})) as { recording?: MeetingRecording; error?: string; warning?: string };
      if (!response.ok || !body.recording) throw new Error(body.error || "Recording could not be saved");
      onChange(body.recording);
      if (pending?.url) URL.revokeObjectURL(pending.url);
      setPending(null);
      if (body.warning) toast.warning(body.warning);
      else {
        toast.success("Meeting recording saved");
        void transcribe(body.recording.id, false);
      }
    } catch (error) {
      setPending((current) => current ?? { blob, duration, url: URL.createObjectURL(blob) });
      toast.error(`${error instanceof Error ? error.message : "Recording could not be saved"}. Retry or download the unsaved audio below.`);
    }
    finally { setState("idle"); setElapsed(0); }
  };

  const start = async () => {
    if (!consent) return toast.error("Confirm that everyone has agreed to the recording.");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast.error("This browser cannot record microphone audio.");
    const mimeType = supportedType();
    if (!mimeType) return toast.error("This browser does not provide a supported audio format.");
    try {
      const activeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      stream.current = activeStream;
      chunks.current = [];
      const activeRecorder = new MediaRecorder(activeStream, { mimeType, audioBitsPerSecond: 48_000 });
      recorder.current = activeRecorder;
      activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      activeRecorder.onerror = () => toast.error("Microphone recording stopped unexpectedly.");
      activeRecorder.onstop = () => {
        const duration = elapsedRef.current;
        const blob = new Blob(chunks.current, { type: mimeType.split(";", 1)[0] });
        activeStream.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
        if (blob.size) void upload(blob, duration);
        else { setState("idle"); toast.error("The microphone produced an empty recording."); }
      };
      elapsedRef.current = 0;
      activeRecorder.start(1000);
      setElapsed(0);
      setState("recording");
    } catch { toast.error("Microphone access was denied or is unavailable."); }
  };
  const pause = () => { recorder.current?.pause(); setState("paused"); };
  const resume = () => { recorder.current?.resume(); setState("recording"); };
  const stop = () => { if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); };

  const transcribe = async (id: string, notify = true) => {
    setWorkingId(id);
    try {
      const response = await fetch(`/api/meeting-recordings/${encodeURIComponent(id)}/transcribe`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { recording?: MeetingRecording; error?: string };
      if (!response.ok || !body.recording) throw new Error(body.error || "Transcription is not available yet");
      onChange(body.recording);
      if (notify) toast.success("Transcript is ready");
    } catch (error) { if (notify) toast.error(error instanceof Error ? error.message : "Transcription is not available yet"); }
    finally { setWorkingId(""); }
  };
  const syncRecording = async (id: string) => {
    setWorkingId(id);
    try {
      const response = await fetch(`/api/meeting-recordings/${encodeURIComponent(id)}/upload`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { recording?: MeetingRecording; error?: string };
      if (!response.ok || !body.recording) throw new Error(body.error || "Cloud audio storage is still unavailable");
      onChange(body.recording);
      toast.success("Recording synchronized");
      void transcribe(body.recording.id, false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Recording is still waiting to sync"); }
    finally { setWorkingId(""); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this audio recording and its transcript?")) return;
    setWorkingId(id);
    try {
      const response = await fetch(`/api/meeting-recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Recording could not be deleted");
      onChange(null, id);
      toast.success("Recording deleted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Recording could not be deleted"); }
    finally { setWorkingId(""); }
  };
  const saveTranscript = async (item: MeetingRecording, transcript: string) => {
    if (transcript === item.transcript) return;
    setWorkingId(item.id);
    try {
      const response = await fetch(`/api/meeting-recordings/${encodeURIComponent(item.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, revision: item.revision }) });
      const body = await response.json().catch(() => ({})) as { recording?: MeetingRecording; error?: string };
      if (!response.ok || !body.recording) throw new Error(body.error || "Transcript could not be saved");
      onChange(body.recording);
      toast.success("Transcript saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Transcript could not be saved"); }
    finally { setWorkingId(""); }
  };

  return <div className="meeting-recorder">
    <div className="meeting-recorder-controls">
      <label className="meeting-consent"><input type="checkbox" checked={consent} disabled={state !== "idle"} onChange={(event) => setConsent(event.target.checked)} /><span>Everyone has agreed to this recording</span></label>
      <div className={`meeting-recording-status ${state}`}><span>{state === "idle" ? "Microphone ready" : state === "uploading" ? "Saving recording…" : state === "paused" ? "Recording paused" : "Recording"}</span>{state !== "idle" && state !== "uploading" ? <strong>{clock(elapsed)}</strong> : null}</div>
      <div className="meeting-recorder-buttons">
        {state === "idle" ? <Button type="button" variant="outline" disabled={!consent || Boolean(pending)} onClick={() => void start()}><Mic />Record meeting</Button> : null}
        {state === "recording" ? <Button type="button" variant="outline" onClick={pause}><Pause />Pause</Button> : null}
        {state === "paused" ? <Button type="button" variant="outline" onClick={resume}><Play />Resume</Button> : null}
        {state === "recording" || state === "paused" ? <Button type="button" onClick={stop}><Square />Stop &amp; save</Button> : null}
      </div>
    </div>
    {pending ? <div className="meeting-unsaved-recording" role="alert"><span>This recording is not saved yet.</span><div><Button type="button" size="sm" onClick={() => void upload(pending.blob, pending.duration)}>Retry save</Button><a className="button-link" href={pending.url} download={`contactgraph-meeting-recording.${pending.blob.type === "audio/mp4" ? "m4a" : pending.blob.type === "audio/ogg" ? "ogg" : "webm"}`}>Download backup</a></div></div> : null}
    {recordings.length ? <div className="meeting-recordings-list">{recordings.map((item) => <article key={item.id}>
      <div><strong>{clock(item.duration_ms)}</strong><span>{(item.size_bytes / 1_000_000).toFixed(1)} MB · {item.storage_backend === "device" ? "Saved on this trusted device · sync pending" : item.transcript_status === "ready" ? "Transcript ready" : item.transcript_status === "processing" ? "Transcribing…" : item.transcript_status === "failed" ? "Transcription failed" : "Transcription pending"}</span></div>
      <audio controls preload="none" src={`/api/meeting-recordings/${encodeURIComponent(item.id)}/audio`} />
      {item.transcript ? <label><span>Transcript · edit and leave the field to save</span><textarea key={`${item.id}:${item.updated_at || item.revision || ""}`} defaultValue={item.transcript} rows={5} disabled={workingId === item.id} onBlur={(event) => void saveTranscript(item, event.currentTarget.value)} /></label> : null}
      <div className="meeting-recording-actions">{item.storage_backend === "device" ? <Button type="button" size="sm" variant="outline" disabled={workingId === item.id} onClick={() => void syncRecording(item.id)}><RefreshCw className={workingId === item.id ? "animate-spin" : ""} />Retry cloud sync</Button> : item.transcript_status !== "ready" ? <Button type="button" size="sm" variant="outline" disabled={workingId === item.id} onClick={() => void transcribe(item.id)}><RefreshCw className={workingId === item.id ? "animate-spin" : ""} />Retry transcript</Button> : null}<Button type="button" size="icon" variant="ghost" disabled={workingId === item.id} onClick={() => void remove(item.id)} aria-label="Delete recording"><Trash2 /></Button></div>
    </article>)}</div> : null}
  </div>;
}
