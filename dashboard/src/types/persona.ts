export type PersonaStatus = "active" | "inactive" | "warming" | "suspended" | "banned";

export interface PersonaAccountSummary {
  id: string;
  username: string;
  platform: string;
  status: string;
  health_score?: number;
  ig_token_configured?: boolean;
}

export interface PersonaRow {
  id: string;
  name: string;
  proxy_id: string | null;
  timezone: string;
  locale: string;
  status: PersonaStatus;
  risk_score: number;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_is_active?: boolean | null;
  emulator_serial?: string | null;
  account_count?: number;
  accounts?: PersonaAccountSummary[];
}

export interface PersonaDeviceBinding {
  persona_id: string;
  emulator_serial: string;
  adb_port?: number | null;
  appium_port?: number | null;
  status: string;
}
