"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, PlugZap, Save, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "./auth-context";
import { SyncSettings } from "./sync-settings";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SettingsStatus = {
  configured: boolean;
  source: "settings" | "environment" | null;
  key_hint: string;
  model: string;
};

const emptyStatus: SettingsStatus = { configured: false, source: null, key_hint: "", model: "gpt-6-astra" };

export function SettingsModule({ embedded = false }: { embedded?: boolean }) {
  const { offline } = useAuth();
  const [status, setStatus] = useState<SettingsStatus>(emptyStatus);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(emptyStatus.model);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    if (offline) return;
    fetch("/api/settings")
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as SettingsStatus & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Settings could not be loaded");
        return body;
      })
      .then((body) => { setStatus(body); setModel(body.model); setLoading(false); })
      .catch((error) => { setLoading(false); toast.error(error instanceof Error ? error.message : "Settings could not be loaded"); });
  }, [offline]);

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/openai", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: apiKey.trim() }) });
      const body = await response.json().catch(() => ({})) as SettingsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The API key could not be saved");
      setStatus(body);
      setModel(body.model);
      setApiKey("");
      toast.success("OpenAI API key verified and saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The API key could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    if (!model.trim() || model === status.model) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/openai-model", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model.trim() }) });
      const body = await response.json().catch(() => ({})) as SettingsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The model could not be saved");
      setStatus(body); setModel(body.model); toast.success(`Generation model changed to ${body.model}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The model could not be saved");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/openai", { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as SettingsStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The saved key could not be removed");
      setStatus(body);
      setRemoveOpen(false);
      toast.success(body.configured ? "Saved key removed; environment key remains active" : "OpenAI API key removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The saved key could not be removed");
    } finally {
      setSaving(false);
    }
  };

  return <div className={embedded ? "settings-content" : "settings-module"}>
    {!embedded && <div className="module-heading"><div><p className="eyebrow">Administration</p><h1 className="module-title">Settings</h1><p className="module-subtitle">Manage integrations and reusable application configuration.</p></div></div>}

    <div className="settings-grid">
      {!offline && <section className="settings-card settings-primary-card">
        <header><div className="settings-icon"><KeyRound /></div><div><h2>OpenAI</h2><p>Used for holiday posts and future AI-assisted features.</p></div><span className={`integration-status ${status.configured ? "connected" : ""}`}>{status.configured ? <><CheckCircle2 />Connected</> : "Not configured"}</span></header>
        <div className="settings-card-body">
          {loading ? <div className="settings-loading" /> : <>
            <div className="settings-current">
              <div><span>API credential</span><strong>{status.configured ? status.key_hint : "No key saved"}</strong></div>
              <div><span>Active model</span><strong>{status.model}</strong></div>
              <div><span>Credential source</span><strong>{status.source === "settings" ? "Private settings volume" : status.source === "environment" ? "Server environment" : "Not configured"}</strong></div>
            </div>
            <label className="settings-key-field"><span>{status.configured ? "Replace API key" : "OpenAI API key"}</span><div><Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && apiKey.trim()) { event.preventDefault(); void save(); } }} placeholder="sk-…" aria-label="OpenAI API key" /><Button onClick={() => void save()} disabled={saving || !apiKey.trim()}><Save />{saving ? "Verifying…" : status.configured ? "Replace key" : "Verify and save"}</Button></div></label>
            <label className="settings-model-field"><span>Generation model</span><div><NativeSelect value={model} onChange={(event) => setModel(event.target.value)} aria-label="OpenAI generation model">{!["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"].includes(model) && <NativeSelectOption value={model}>{model}</NativeSelectOption>}<NativeSelectOption value="gpt-6-astra">GPT-6 Astra · highest capability</NativeSelectOption><NativeSelectOption value="gpt-6.1-sol">GPT-6.1 Sol · balanced</NativeSelectOption><NativeSelectOption value="gpt-6-luna">GPT-6 Luna · efficient</NativeSelectOption></NativeSelect><Button onClick={() => void saveModel()} disabled={saving || !status.configured || !model.trim() || model === status.model}><Save />Save model</Button></div><small>The model is verified against your OpenAI account before it is saved.</small></label>
            <div className="settings-security-note"><LockKeyhole /><p><strong>Stored server-side.</strong> The key is verified with OpenAI before saving and is kept in a permission-restricted Docker volume. It is never returned to the browser or written to DuckDB and the synced ContactGraph folder.</p></div>
            {status.source === "settings" && <Button variant="outline" className="settings-remove" onClick={() => setRemoveOpen(true)} disabled={saving}><Trash2 />Remove saved key</Button>}
          </>}
        </div>
      </section>}

      <SyncSettings />
      {!offline && <section className="settings-card settings-future-card">
        <header><div className="settings-icon muted"><PlugZap /></div><div><h2>Future integrations</h2><p>Additional services can be managed from this panel.</p></div></header>
        <div className="settings-card-body"><div className="future-setting"><Settings2 /><div><strong>Ready to expand</strong><span>Email providers, contact synchronization, generation defaults, and other credentials can use the same settings area.</span></div></div></div>
      </section>}
    </div>

    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Remove the saved OpenAI key?</AlertDialogTitle><AlertDialogDescription>AI generation will stop working until another key is saved. This does not delete generated posts.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep key</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving} onClick={(event) => { event.preventDefault(); void remove(); }}>{saving ? "Removing…" : "Remove key"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

export function AccountSettingsModule() {
  const [passkeysAvailable, setPasskeysAvailable] = useState(false);
  const [passkeys, setPasskeys] = useState<{ id: string; label: string; created_at: string; last_used_at: string | null }[]>([]);
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const loadPasskeys = useCallback(async () => {
    const response = await fetch("/api/auth/passkey/credentials", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh passkeys.");
    setPasskeys((await response.json() as { passkeys: typeof passkeys }).passkeys);
  }, []);
  useEffect(() => {
    fetch("/api/auth/config").then(response => response.json() as Promise<{ passkeys?: boolean }>).then(config => {
      setPasskeysAvailable(Boolean(config.passkeys));
      if (config.passkeys) void loadPasskeys().catch(error => toast.error(error.message));
    }).catch(() => undefined);
  }, [loadPasskeys]);
  const addPasskey = async () => {
    if (!passkeyLabel.trim()) return toast.error("Name this passkey first.");
    setPasskeyBusy(true);
    try {
      const optionsResponse = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const options = await optionsResponse.json() as { error?: string };
      if (!optionsResponse.ok) throw new Error(options.error || "Could not start passkey registration.");
      const credential = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      const response = await fetch("/api/auth/passkey/register/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential, label: passkeyLabel.trim() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not add passkey.");
      setPasskeyLabel(""); toast.success("Passkey added. You can now use it on this domain.");
      try { await loadPasskeys(); } catch { toast.warning("Passkey added, but the list could not refresh."); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add passkey."); }
    finally { setPasskeyBusy(false); }
  };
  const removePasskey = async (id: string) => {
    if (!window.confirm("Remove this passkey?")) return;
    setPasskeyBusy(true);
    try {
      const response = await fetch("/api/auth/passkey/credentials", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not remove passkey.");
      toast.success("Passkey removed");
      try { await loadPasskeys(); } catch { toast.warning("Passkey removed, but the list could not refresh."); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove passkey."); }
    finally { setPasskeyBusy(false); }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) return toast.error("New passwords do not match.");
    setSaving(true);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Password could not be changed.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast.success("Password changed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Password could not be changed."); }
    finally { setSaving(false); }
  };
  return <div className="settings-grid"><section className="settings-card settings-primary-card">
    <header><div className="settings-icon"><LockKeyhole /></div><div><h2>Change password</h2><p>Update your own ContactGraph login.</p></div></header>
    <div className="settings-card-body"><form className="account-password-form" onSubmit={event => void changePassword(event)}>
      <label>Current password<Input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
      <label>New password<Input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
      <label>Confirm new password<Input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>
      <Button type="submit" disabled={saving || !currentPassword || newPassword.length < 12 || !confirmPassword}>{saving ? "Saving…" : "Change password"}</Button>
    </form></div>
  </section>{passkeysAvailable && <section className="settings-card settings-primary-card"><header><div className="settings-icon"><KeyRound /></div><div><h2>Passkeys</h2><p>Use your device or password manager to sign in. Add at least two passkeys before retiring password access.</p></div></header><div className="settings-card-body"><div className="accounts-list">{passkeys.map(key => <div key={key.id}><strong>{key.label}</strong><span>Added {new Date(key.created_at).toLocaleDateString()}{key.last_used_at ? ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}` : ""}</span>{passkeys.length > 1 && <Button type="button" variant="outline" disabled={passkeyBusy} onClick={() => void removePasskey(key.id)}>Remove</Button>}</div>)}</div><label>Passkey name<Input maxLength={80} placeholder="My laptop or phone" value={passkeyLabel} onChange={event => setPasskeyLabel(event.target.value)} /></label><Button type="button" disabled={passkeyBusy || !passkeyLabel.trim()} onClick={() => void addPasskey()}>{passkeyBusy ? "Working…" : "Add passkey"}</Button><p>You may be asked to sign out and sign in again before adding or removing a passkey.</p></div></section>}</div>;
}
