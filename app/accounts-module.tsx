"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Role = { id: string; name: string; permissions: string[] };
type User = { id: string; username: string; display_name: string; email: string | null; role_id: string; active: boolean; must_change_password: boolean; passkey_count: number };
type PermissionModule = { id: string; label: string; permissions: Array<{ key: string; label: string }> };
type Accounts = { users: User[]; roles: Role[]; available_permissions: string[]; permission_modules: PermissionModule[] };
const blankUser = { username: "", display_name: "", email: "", role_id: "assistant", active: true, password: "" };

export function AccountsModule({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<Accounts | null>(null);
  const [userDraft, setUserDraft] = useState<User & { password: string } | (typeof blankUser)>(blankUser);
  const [roleDraft, setRoleDraft] = useState<Role>({ id: "", name: "", permissions: ["contacts.view"] });
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState("legacy");
  const load = async () => {
    const response = await fetch("/api/auth/admin");
    if (!response.ok) throw new Error("Accounts could not be loaded.");
    setData(await response.json() as Accounts);
  };
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/config").then(response => response.json() as Promise<{ mode?: string }>).then(config => { if (!cancelled) setAuthMode(config.mode || "legacy"); }).catch(() => undefined);
    fetch("/api/auth/admin")
      .then(async response => {
        if (!response.ok) throw new Error("Accounts could not be loaded.");
        return response.json() as Promise<Accounts>;
      })
      .then(accounts => { if (!cancelled) setData(accounts); })
      .catch(error => { if (!cancelled) toast.error(error.message); });
    return () => { cancelled = true; };
  }, []);
  const save = async (kind: "users" | "roles", payload: unknown) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${kind}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save changes.");
      await load(); toast.success(kind === "users" ? "User saved" : "Role saved");
      if (kind === "users") setUserDraft(blankUser);
      else setRoleDraft({ id: "", name: "", permissions: ["contacts.view"] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setBusy(false); }
  };
  const userField = (field: keyof typeof blankUser, value: string | boolean) => setUserDraft(current => ({ ...current, [field]: value }));
  const togglePermission = (permission: string, enabled: boolean) => setRoleDraft(current => {
    const next = new Set(current.permissions);
    if (enabled) {
      next.add(permission);
      if (permission === "duplicates.manage") next.add("duplicates.view");
    } else {
      next.delete(permission);
      if (permission === "duplicates.view") next.delete("duplicates.manage");
    }
    return { ...current, permissions: [...next] };
  });
  return <div className={embedded ? "accounts-module" : "settings-module accounts-module"}>{!embedded && <div className="module-heading"><div><p className="eyebrow">Administration</p><h1 className="module-title">Users &amp; roles</h1><p className="module-subtitle">Active accounts and their roles control access to ContactGraph.</p></div></div>}
    <div className="accounts-grid"><section className="settings-card"><h2>Users</h2><div className="accounts-list">{data?.users.map(user => <button key={user.id} type="button" disabled={user.role_id === "owner"} onClick={() => setUserDraft({ ...user, password: "" })}><strong>{user.display_name}</strong><span>{user.email || "No email"} · {data.roles.find(role => role.id === user.role_id)?.name || user.role_id} · {user.active ? "Active" : "Disabled"} · {user.passkey_count} passkeys</span></button>)}</div>
      <form className="accounts-form" onSubmit={event => { event.preventDefault(); void save("users", userDraft); }}><h3>{"id" in userDraft ? "Edit user" : "Create user"}</h3><label>Username<Input value={userDraft.username} onChange={event => userField("username", event.target.value)} required /></label><label>Google email<Input type="email" autoComplete="email" value={userDraft.email || ""} onChange={event => userField("email", event.target.value)} required /></label><label>Display name<Input value={userDraft.display_name} onChange={event => userField("display_name", event.target.value)} required /></label><label>Role<select value={userDraft.role_id} onChange={event => userField("role_id", event.target.value)}>{data?.roles.filter(role => role.id !== "owner").map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>{authMode !== "google" && <label>{"id" in userDraft ? "Reset legacy password (optional)" : "Legacy password (optional)"}<Input type="password" minLength={12} value={userDraft.password} onChange={event => userField("password", event.target.value)} /></label>}{"id" in userDraft && <label className="accounts-check"><input type="checkbox" checked={userDraft.active} onChange={event => userField("active", event.target.checked)} /> Account active</label>}<div className="accounts-actions"><Button type="submit" disabled={busy}>Save user</Button><Button type="button" variant="outline" onClick={() => setUserDraft(blankUser)}>New user</Button></div></form>
    </section><section className="settings-card"><h2>Roles</h2><div className="accounts-list">{data?.roles.map(role => <button key={role.id} type="button" disabled={role.id === "owner"} onClick={() => setRoleDraft({ ...role, permissions: [...role.permissions] })}><strong>{role.name}</strong><span>{role.id === "owner" ? "Full access" : `${role.permissions.length} permissions`}</span></button>)}</div>
      <form className="accounts-form" onSubmit={event => { event.preventDefault(); void save("roles", { ...roleDraft, id: roleDraft.id || undefined }); }}><h3>{roleDraft.id ? "Edit role" : "Create role"}</h3><label>Role name<Input value={roleDraft.name} onChange={event => setRoleDraft(current => ({ ...current, name: event.target.value }))} required /></label><div className="accounts-permissions">{data?.permission_modules.map(module => <fieldset key={module.id} className="accounts-permission-group"><legend>{module.label}</legend>{module.permissions.map(permission => <label key={permission.key} className="accounts-check"><input type="checkbox" checked={roleDraft.permissions.includes(permission.key)} disabled={permission.key === "contacts.view"} onChange={event => togglePermission(permission.key, event.target.checked)} />{permission.label}</label>)}</fieldset>)}</div><div className="accounts-actions"><Button type="submit" disabled={busy}>Save role</Button><Button type="button" variant="outline" onClick={() => setRoleDraft({ id: "", name: "", permissions: ["contacts.view"] })}>New role</Button></div></form>
    </section></div></div>;
}
