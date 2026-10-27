import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-context";
import { isTrustedDevice, secureSignOut, setTrustedDevice } from "./firebase";
import { toast } from "sonner";

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
    <div className="settings-grid"><TrustedDeviceCard /><section className="settings-card"><div className="settings-card-body"><h2>Online services</h2><p>AI message generation and live OSINT collection require a private server. They are unavailable in this GitHub Pages release; saved history remains private.</p></div></section></div>
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
