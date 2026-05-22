"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ShieldCheck,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Loader2,
  Inbox,
  ArrowRight,
  Shield,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface AccountSummary {
  id: string;
  username: string;
  status: string;
  health_score: number;
}

interface SafetyAlert {
  id: string;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface ActionStat {
  current: number;
  limit: number;
  remaining: number;
  percentage: number;
}

interface HealthDetails {
  account: {
    id: string;
    username: string;
    status: string;
    health_score: number;
    safe_mode: boolean;
    metadata: any;
    created_at: string;
  };
  safety: {
    limits: {
      healthScore: number;
      multiplier: number;
      actions: Record<string, ActionStat>;
    };
    activeCooldowns: any[];
    canPost: boolean;
    canLike: boolean;
    canFollow: boolean;
  };
  alerts: SafetyAlert[];
}

const STATUS_ICONS: Record<string, React.ElementType> = {
  active: CheckCircle2,
  warming: Clock,
  cooldown: ShieldAlert,
  shadowbanned: AlertTriangle,
  banned: XCircle,
  flagged: ShieldAlert,
};

function getRisk(
  score: number,
  levels: { range: [number, number]; label: string; color: string; bg: string; desc: string }[],
) {
  return levels.find((r) => score >= r.range[0] && score <= r.range[1]) || levels[3];
}

export default function AccountHealthPage() {
  const { text, t } = useLocale();
  const ah = text.accountHealth;

  const riskLevels = useMemo(
    () => [
      {
        range: [90, 100] as [number, number],
        label: ah.minimal,
        color: "text-emerald-500",
        bg: "bg-emerald-500",
        desc: ah.minimalDesc,
      },
      {
        range: [70, 89] as [number, number],
        label: ah.low,
        color: "text-blue-500",
        bg: "bg-blue-500",
        desc: ah.lowDesc,
      },
      {
        range: [40, 69] as [number, number],
        label: ah.moderate,
        color: "text-amber-500",
        bg: "bg-amber-500",
        desc: ah.moderateDesc,
      },
      {
        range: [0, 39] as [number, number],
        label: ah.critical,
        color: "text-red-500",
        bg: "bg-red-500",
        desc: ah.criticalDesc,
      },
    ],
    [ah],
  );
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<HealthDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.distribution.getAccounts();
      setAccounts(data || []);
      // Auto-select first if none selected
      if (data && data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    } finally {
      setLoading(false);
    }
  }, []); // Remove selectedId to prevent loop

  const fetchDetails = useCallback(async (id: string) => {
    setDetailsLoading(true);
    try {
      const data = await api.distribution.getAccountSafety(id);
      setDetails(data);
    } catch (err) {
      console.error("Failed to fetch safety details:", err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (selectedId) {
      fetchDetails(selectedId);
    }
  }, [selectedId, fetchDetails]);

  const filteredAccounts = accounts.filter(a => 
    a.username.toLowerCase().includes(search.toLowerCase())
  );

  const risk = details ? getRisk(details.account.health_score, riskLevels) : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="p-10 pb-6 shrink-0">
        <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
          <ShieldCheck className="w-10 h-10 text-emerald-500" />
          {ah.title}
        </h2>
        <p className="page-subtitle">{ah.subtitle}</p>
      </div>

      <div className="flex flex-1 overflow-hidden p-8 pt-2 gap-6">
        {/* Account List Sidebar */}
        <div className="w-80 flex flex-col gap-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder={ah.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-4 text-sm font-bold rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 placeholder:text-zinc-400 transition-all"
            />
          </div>

          <div className="flex-1 overflow-y-auto rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="text-center p-8 text-zinc-400 text-sm font-medium">
                {ah.noAccounts}
              </div>
            ) : (
              <div className="divide-y border-zinc-100 dark:border-zinc-900">
                {filteredAccounts.map((account) => {
                  const Icon = STATUS_ICONS[account.status] || Shield;
                  return (
                    <button
                      key={account.id}
                      onClick={() => setSelectedId(account.id)}
                      className={cn(
                        "w-full text-left p-6 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-all flex items-center gap-4",
                        selectedId === account.id && "bg-zinc-50 dark:bg-zinc-900 border-r-4 border-emerald-500"
                      )}
                    >
                      <div className={cn(
                        "p-3 rounded-xl transition-colors",
                        selectedId === account.id ? "bg-emerald-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">@{account.username}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ProgressBar value={account.health_score} className="flex-1" />
                          <span className="text-[10px] font-mono font-medium text-muted-foreground">
                            {account.health_score}%
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Health Details Panel */}
        <div className="flex-1 overflow-y-auto pr-2">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-premium bg-zinc-50/50 dark:bg-zinc-900/20">
              <Shield className="w-20 h-20 opacity-10" />
              <p className="text-xl font-bold font-display uppercase tracking-widest text-zinc-300 dark:text-zinc-700">
                {ah.selectAccount}
              </p>
            </div>
          ) : detailsLoading || !details ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
          ) : (
            <div className="space-y-8 pb-10">
              {/* Header Card */}
              <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 p-10 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden relative">
                <div className={cn("absolute top-0 right-0 w-64 h-64 -mr-32 -mt-32 rounded-full opacity-5 blur-3xl", risk?.bg)} />
                <div className="flex flex-col md:flex-row items-center gap-10 relative">
                  {/* Gauge */}
                  <div className="relative w-48 h-48 flex items-center justify-center transform hover:scale-105 transition-transform duration-500">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="96"
                        cy="96"
                        r="84"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="16"
                        className="text-zinc-100 dark:text-zinc-800"
                      />
                      <circle
                        cx="96"
                        cy="96"
                        r="84"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="16"
                        strokeDasharray={527}
                        strokeDashoffset={527 - (527 * details.account.health_score) / 100}
                        strokeLinecap="round"
                        className={cn("transition-all duration-1000", risk?.color)}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-5xl font-black font-display text-zinc-900 dark:text-zinc-50">{details.account.health_score}</span>
                      <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mt-1">
                        {ah.score}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 space-y-6">
                    <div className="flex items-center gap-4">
                      <h3 className="text-3xl font-black font-display text-zinc-900 dark:text-zinc-50">@{details.account.username}</h3>
                      <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border",
                        risk?.color,
                        risk?.bg.replace("bg-", "bg-opacity-10 border-")
                      )}>
                        {risk?.label} {ah.riskSuffix}
                      </div>
                    </div>
                    <p className="text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed max-w-lg">{risk?.desc}</p>
                    <div className="grid grid-cols-3 gap-6">
                      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                        <p className="text-[10px] uppercase font-black text-zinc-400 dark:text-zinc-500 mb-1 tracking-widest">
                          {ah.statusLabel}
                        </p>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 capitalize">{details.account.status}</p>
                      </div>
                      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                        <p className="text-[10px] uppercase font-black text-zinc-400 dark:text-zinc-500 mb-1 tracking-widest">
                          {ah.safeMode}
                        </p>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                          {details.account.safe_mode ? ah.safeModeActive : ah.safeModeDisabled}
                        </p>
                      </div>
                      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                        <p className="text-[10px] uppercase font-black text-zinc-400 dark:text-zinc-500 mb-1 tracking-widest">
                          {ah.multiplier}
                        </p>
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{details.safety.limits.multiplier.toFixed(2)}x</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Action Limits */}
                <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-8">
                    <h4 className="font-black font-display text-lg flex items-center gap-3 text-zinc-900 dark:text-zinc-50">
                      <Activity className="w-6 h-6 text-indigo-500" />
                      {ah.actionLimits}
                    </h4>
                    <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                      {ah.updatedToday}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {Object.entries(details.safety.limits.actions).map(([action, stat]) => (
                      <div key={action} className="p-5 rounded-premium border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{action}s</span>
                          <span className="text-sm font-black text-zinc-900 dark:text-zinc-50">{stat.current} <span className="text-zinc-300">/</span> {stat.limit}</span>
                        </div>
                        <ProgressBar value={stat.percentage} className="h-2.5" />
                        <div className="flex justify-between items-center text-[10px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest">
                          <span>{t("accountHealth.remainingLeft", { count: stat.remaining })}</span>
                          <span>{t("accountHealth.usedPercent", { percent: stat.percentage })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Alerts */}
                <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm flex flex-col">
                  <div className="flex items-center justify-between mb-8">
                    <h4 className="font-black font-display text-lg flex items-center gap-3 text-zinc-900 dark:text-zinc-50">
                      <AlertTriangle className="w-6 h-6 text-amber-500" />
                      {ah.safetyLogs}
                    </h4>
                    <button className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-600 transition-colors">
                      {ah.viewAll}
                    </button>
                  </div>
                  <div className="flex-1 space-y-4">
                    {details.alerts.length === 0 ? (
                      <EmptyState 
                        icon={Inbox}
                        title={ah.noRecentAlerts}
                      />
                    ) : (
                      details.alerts.map((alert) => (
                        <div key={alert.id} className="group p-5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all flex gap-4">
                          <div className={cn(
                            "w-1.5 h-auto rounded-full shrink-0",
                            alert.type === 'ban' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : alert.type === 'shadowban' ? "bg-amber-500" : "bg-blue-500"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">{alert.type}</span>
                              <span className="text-[10px] font-bold text-zinc-400">{new Date(alert.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 leading-relaxed">{alert.message}</p>
                          </div>
                          <button className="opacity-0 group-hover:opacity-100 p-2 rounded-xl bg-white dark:bg-zinc-800 shadow-sm transition-all border border-zinc-100 dark:border-zinc-700">
                            <ArrowRight className="w-4 h-4 text-zinc-900 dark:text-white" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
