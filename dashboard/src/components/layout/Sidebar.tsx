"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Activity,
  BarChart3,
  BookOpen,
  LayoutDashboard,
  LogOut,
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
  comingSoon?: boolean;
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
        { name: text.nav.analytics, href: "/analytics", icon: BarChart3, comingSoon: true },
      ],
    },
    {
      label: text.nav.groupOperations,
      items: [
        { name: text.nav.accounts, href: "/accounts", icon: Users },
        { name: text.nav.generationStudio, href: "/generation-studio", icon: Clapperboard },
        { name: text.nav.publications, href: "/publications", icon: BookOpen },
        { name: text.nav.campaigns, href: "/campaigns", icon: Activity, comingSoon: true },
        { name: "Emulators", href: "/emulators", icon: Smartphone },
      ],
    },
    {
      label: text.nav.groupIntelligence,
      items: [{ name: text.nav.abTesting, href: "/ab-tests", icon: Split, comingSoon: true }],
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

  return (
    <aside className="flex h-full w-[22rem] flex-col overflow-hidden border-r border-border bg-background text-foreground">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/70 px-2.5 py-1">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground">
                IP
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Influence Platform
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle className="border-border bg-background text-foreground shadow-none hover:bg-muted" />
            <AlertBell />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav className="space-y-5">
          {navGroups.map((group, index) => (
            <section key={group.label} className={cn(index > 0 && "border-t border-border/50 pt-4")}>
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {group.label}
                </p>
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  const isDisabled = Boolean(item.comingSoon);
                  return (
                    <Link
                      key={item.href}
                      href={isDisabled ? "#" : item.href}
                      aria-disabled={isDisabled}
                      onClick={isDisabled ? (event) => event.preventDefault() : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
                        isDisabled
                          ? "cursor-not-allowed opacity-70 text-muted-foreground"
                          : isActive
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                          isActive
                            ? "bg-background text-foreground"
                            : "text-muted-foreground group-hover:bg-background group-hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm", isActive ? "font-semibold text-foreground" : "font-medium")}>
                          {item.name}
                        </p>
                        <p className={cn("truncate text-xs", isActive ? "text-foreground/70" : "text-muted-foreground")}>
                          {item.comingSoon ? "Coming soon" : group.label}
                        </p>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-all duration-200",
                          isActive
                            ? "translate-x-0 text-muted-foreground"
                            : "-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
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
      <div className="border-t border-border p-3">
        <div className="rounded-md bg-muted/50 p-2">
          <div className="flex items-center gap-3 rounded-md px-2 py-2 text-foreground">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-background text-sm font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="text-xs text-muted-foreground">{text.sidebar.profileRole}</p>
            </div>
          </div>
          <div className="mt-2 border-t border-border/50 pt-2">
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md">
                <LogOut className="h-4 w-4" />
              </span>
              <span>{text.nav.logout}</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
