"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  Globe,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Sparkles,
  Split,
  Users,
  ChevronRight,
  Smartphone,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertBell } from "./AlertBell";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { useLocale } from "@/components/i18n/LocaleProvider";

type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { text } = useLocale();

  const navGroups: NavGroup[] = [
    {
      label: text.nav.groupOverview,
      items: [
        { name: text.nav.dashboard, href: "/", icon: LayoutDashboard },
        { name: text.nav.analytics, href: "/analytics", icon: BarChart3 },
      ],
    },
    {
      label: text.nav.groupOperations,
      items: [
        { name: text.nav.accounts, href: "/accounts", icon: Users },
        { name: text.nav.accountHealth, href: "/account-health", icon: ShieldCheck },
        { name: text.nav.contentPlanner, href: "/content", icon: Calendar },
        { name: text.nav.generationStudio, href: "/generation-studio", icon: Clapperboard },
        { name: text.nav.publications, href: "/publications", icon: BookOpen },
        { name: text.nav.proxies, href: "/proxies", icon: Globe },
        { name: text.nav.campaigns, href: "/campaigns", icon: Activity },
        { name: "Emulators", href: "/emulators", icon: Smartphone },
      ],
    },
    {
      label: text.nav.groupIntelligence,
      items: [
        { name: text.nav.optimizationLab, href: "/analytics/lab", icon: Sparkles },
        { name: text.nav.abTesting, href: "/ab-tests", icon: Split },
      ],
    },
  ];

  const userName = session?.user?.name || text.sidebar.profileFallbackName;
  const initials =
    userName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "IP";

  const activeItem = navGroups.flatMap((group) => group.items).find((item) => pathname === item.href);
  const totalDestinations = navGroups.reduce((count, group) => count + group.items.length, 0);

  return (
    <aside className="relative flex h-full w-[22rem] flex-col overflow-hidden border-r border-zinc-200/70 bg-[#f6efe2] text-zinc-900 dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.42),_transparent_60%)] dark:bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.2),_transparent_55%)]" />
        <div className="absolute -left-20 top-44 h-56 w-56 rounded-full bg-emerald-200/35 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute bottom-20 right-[-4.5rem] h-52 w-52 rounded-full bg-amber-200/45 blur-3xl dark:bg-amber-400/10" />
      </div>

      <div className="relative px-5 pb-4 pt-5">
        <div className="overflow-hidden rounded-[2rem] border border-zinc-950/10 bg-white/72 p-5 shadow-[0_18px_45px_-28px_rgba(24,24,27,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center rounded-full border border-zinc-950/10 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                Influence Platform
              </div>
              <h1 className="mt-3 font-display text-[1.7rem] font-semibold tracking-[-0.04em] text-zinc-950 dark:text-white">
                Influence
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {activeItem?.name || text.nav.dashboard}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle className="border-zinc-950/10 bg-white/80 text-zinc-800 shadow-none hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10" />
              <AlertBell />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-zinc-950/10 bg-zinc-950 px-3 py-3 text-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-white">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">Modules</p>
              <p className="mt-1 text-lg font-semibold">{navGroups.length}</p>
            </div>
            <div className="rounded-2xl border border-zinc-950/10 bg-white/78 px-3 py-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">Routes</p>
              <p className="mt-1 text-lg font-semibold text-zinc-950 dark:text-white">{totalDestinations}</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 dark:border-emerald-400/20 dark:bg-emerald-400/10">
              <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Mode</p>
              <p className="mt-1 text-lg font-semibold text-emerald-900 dark:text-emerald-100">FR</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 pb-5">
        <nav className="space-y-4">
          {navGroups.map((group) => (
            <section
              key={group.label}
              className="rounded-[1.75rem] border border-zinc-950/10 bg-white/70 p-3 shadow-[0_14px_35px_-28px_rgba(24,24,27,0.4)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none"
            >
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-500">
                  {group.label}
                </p>
                <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-white/10 dark:text-zinc-200">
                  {group.items.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-[1.35rem] px-3 py-3 transition-all duration-200",
                        isActive
                          ? "bg-zinc-950 text-white shadow-[0_20px_40px_-26px_rgba(24,24,27,0.9)] dark:bg-white dark:text-zinc-950"
                          : "text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/8 dark:hover:text-white"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                          isActive
                            ? "border-white/15 bg-white/10 text-white dark:border-zinc-200/60 dark:bg-zinc-100 dark:text-zinc-950"
                            : "border-zinc-950/10 bg-white/75 text-zinc-700 group-hover:border-zinc-950/15 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] stroke-[1.9]" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p
                          className={cn(
                            "truncate text-xs",
                            isActive ? "text-white/65 dark:text-zinc-600" : "text-zinc-400 dark:text-zinc-500"
                          )}
                        >
                          {group.label}
                        </p>
                      </div>

                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 transition-all duration-200",
                          isActive
                            ? "translate-x-0 text-white/70 dark:text-zinc-700"
                            : "-translate-x-1 text-zinc-300 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 dark:text-zinc-600"
                        )}
                      />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </div>

      <div className="relative px-4 pb-5">
        <div className="rounded-[1.9rem] border border-zinc-950/10 bg-white/78 p-3 shadow-[0_18px_40px_-30px_rgba(24,24,27,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
          <div className="flex items-center gap-3 rounded-[1.4rem] bg-zinc-950 px-3 py-3 text-white dark:bg-white/10 dark:text-white">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 text-sm font-semibold dark:bg-white/10">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="text-xs text-white/65 dark:text-zinc-400">{text.sidebar.profileRole}</p>
            </div>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-3 flex w-full items-center gap-3 rounded-[1.3rem] border border-zinc-950/10 bg-white/75 px-3 py-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-950 hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white dark:hover:text-zinc-950"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-950/10 bg-zinc-950 text-white dark:border-white/10 dark:bg-white/10 dark:text-zinc-100">
              <LogOut className="h-[18px] w-[18px] stroke-[1.8]" />
            </span>
            <span>{text.nav.logout}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
