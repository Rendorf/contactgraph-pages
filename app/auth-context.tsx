"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type User = { id: string; username: string; display_name: string; role_id: string; permissions: string[]; must_change_password: boolean; auth_source?: "access" | "password" | "passkey" };
type AuthState = { user: User | null; offline: boolean; can: (permission: string) => boolean; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState>({ user: null, offline: false, can: () => false, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (window.location.pathname === "/login") { setLoading(false); return; }
    const response = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) { window.location.assign("/login"); return; }
    const body = await response.json() as { user: User; offline?: boolean };
    setUser(body.user);
    setOffline(Boolean(body.offline));
    setLoading(false);
  }, []);
  useEffect(() => { const initial = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => void refresh(), 60_000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [refresh]);
  const can = (permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
  const changePassword = async () => {
    setError("");
    const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return setError(body.error || "Password could not be changed.");
    setCurrentPassword(""); setNewPassword(""); await refresh();
  };
  if (loading) return <div className="auth-screen">Loading your workspace…</div>;
  if (user?.must_change_password) return <div className="auth-screen"><div className="auth-card"><h1>Change your temporary password</h1><p>Choose a password of at least 12 characters before entering ContactGraph.</p><label>Temporary password<Input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>New password<Input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" /></label>{error && <p role="alert" className="auth-error">{error}</p>}<Button onClick={() => void changePassword()} disabled={!currentPassword || newPassword.length < 12}>Change password</Button></div></div>;
  return <AuthContext.Provider value={{ user, offline, can, refresh }}>{children}</AuthContext.Provider>;
}
