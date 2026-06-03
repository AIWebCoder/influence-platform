import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

export type PlatformAlert = {
  id: string;
  account_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  action_url: string;
  action_label: string;
};

export function alertIcon(type: string): LucideIcon {
  switch (type) {
    case "ban":
      return ShieldAlert;
    case "warning":
    case "action_block":
      return AlertTriangle;
    default:
      return Info;
  }
}

/** Map action_url to i18n key suffix (alerts.actions.*). */
export function actionLabelKey(actionUrl: string): string | null {
  const path = actionUrl.split("?")[0];
  const map: Record<string, string> = {
    "/proxies": "proxies",
    "/queue": "queue",
    "/publications": "publications",
    "/calendar": "calendar",
    "/accounts": "accounts",
    "/account-health": "accountHealth",
    "/generation-studio": "generationStudio",
    "/alerts": "alerts",
  };
  return map[path] ?? null;
}

export function previewMessage(message: string, maxLen = 120): string {
  const trimmed = message.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}...`;
}
