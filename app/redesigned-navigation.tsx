"use client";

import { PRIMARY_MODULES, type WorkspaceModule } from "./module-registry";
import { useAuth } from "./auth-context";

export function RedesignedNavigation({ active, attention, onSelect, mobile = false }: {
  active: WorkspaceModule;
  attention: number;
  onSelect: (module: WorkspaceModule) => void;
  mobile?: boolean;
}) {
  const { can } = useAuth();
  const selected = PRIMARY_MODULES.some((item) => item.id === active) ? active : "more";
  return <nav className={mobile ? "v2-bottom-navigation" : "v2-navigation"} aria-label="Primary navigation">
    {PRIMARY_MODULES.filter((item) => !item.permission || can(item.permission)).map((item) => {
      const Icon = item.icon;
      const count = item.id === "today" ? attention : 0;
      return <button key={item.id} type="button" className={selected === item.id ? "active" : ""} aria-current={selected === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
        <span className="v2-nav-icon"><Icon />{count > 0 && <small aria-label={`${count} items need attention`}>{count > 99 ? "99+" : count}</small>}</span>
        <span>{item.label}</span>
      </button>;
    })}
  </nav>;
}
