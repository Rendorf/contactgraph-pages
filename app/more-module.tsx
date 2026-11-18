"use client";

import { MODULE_REGISTRY, type WorkspaceModule } from "./module-registry";
import { useAuth } from "./auth-context";

const MORE_IDS: WorkspaceModule[] = ["meetings", "followups", "duplicates", "canva", "osint", "account", "settings", "accounts"];

export function MoreModule({ osintAvailable, onSelect }: { osintAvailable: boolean; onSelect: (module: WorkspaceModule) => void }) {
  const { can, offline } = useAuth();
  const modules = MODULE_REGISTRY.filter((module) => MORE_IDS.includes(module.id) && (!module.permission || can(module.permission)) && !(offline && ["canva", "osint", "accounts"].includes(module.id)) && (module.id !== "osint" || osintAvailable));
  return <section className="more-module">
    <header><p className="eyebrow">Workspace</p><h1 className="module-title">More</h1><p className="module-subtitle">Journals, data tools, integrations, and personal appearance settings.</p></header>
    <div className="more-grid">{modules.map((module) => { const Icon = module.icon; return <button type="button" key={module.id} onClick={() => onSelect(module.id)}><span><Icon /></span><strong>{module.label}</strong><small>{module.description}</small></button>; })}</div>
  </section>;
}
