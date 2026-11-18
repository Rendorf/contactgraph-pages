import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ContactRound,
  Copy,
  LayoutDashboard,
  Network,
  Palette,
  Radar,
  Settings2,
  Sparkles,
} from "lucide-react";

export type WorkspaceModule =
  | "today"
  | "contacts"
  | "calendar"
  | "graph"
  | "more"
  | "duplicates"
  | "meetings"
  | "followups"
  | "canva"
  | "osint"
  | "settings"
  | "accounts"
  | "account"
  | "holidays"
  | "notifications";

export type ModuleDefinition = {
  id: WorkspaceModule;
  label: string;
  description: string;
  icon: LucideIcon;
  permission?: string;
  primary?: boolean;
};

export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  { id: "today", label: "Today", description: "What needs your attention now", icon: Sparkles, primary: true },
  { id: "contacts", label: "People", description: "Your relationship directory", icon: ContactRound, primary: true },
  { id: "calendar", label: "Calendar", description: "Occasions, meetings and follow-ups", icon: CalendarDays, primary: true },
  { id: "graph", label: "Network", description: "Explore how people are connected", icon: Network, permission: "graph.view", primary: true },
  { id: "more", label: "More", description: "Tools and workspace settings", icon: Settings2, primary: true },
  { id: "meetings", label: "Meeting journal", description: "Notes, recordings and insights", icon: CalendarDays, permission: "meetings.view" },
  { id: "followups", label: "Follow-ups", description: "Reconnect and track next steps", icon: LayoutDashboard, permission: "followups.view" },
  { id: "duplicates", label: "Data quality", description: "Review duplicates and sync issues", icon: Copy, permission: "duplicates.view" },
  { id: "canva", label: "Canvases", description: "Visual relationship workspaces", icon: Palette, permission: "canvases.view" },
  { id: "osint", label: "OSINT updates", description: "Review public-source discoveries", icon: Radar, permission: "osint.view" },
  { id: "account", label: "Appearance & account", description: "Theme, profile and device preferences", icon: Settings2 },
  { id: "settings", label: "Integrations", description: "Manage workspace integrations", icon: Settings2, permission: "settings.manage" },
  { id: "accounts", label: "Users & roles", description: "Manage access to this workspace", icon: Settings2, permission: "users.manage" },
] as const;

export const PRIMARY_MODULES = MODULE_REGISTRY.filter((module) => module.primary);

export function moduleDefinition(id: WorkspaceModule) {
  return MODULE_REGISTRY.find((module) => module.id === id);
}
