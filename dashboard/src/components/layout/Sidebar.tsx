"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Calendar, Activity, BookOpen, ShieldCheck, Globe, BarChart3, LogOut, Split, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { AlertBell } from "./AlertBell";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Accounts", href: "/accounts", icon: Users },
  { name: "Account Health", href: "/account-health", icon: ShieldCheck },
  { name: "Content Planner", href: "/content", icon: Calendar },
  { name: "Publications", href: "/publications", icon: BookOpen },
  { name: "Proxies", href: "/proxies", icon: Globe },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Optimization Lab", href: "/analytics/lab", icon: Sparkles },
  { name: "A/B Testing", href: "/ab-tests", icon: Split },
  { name: "Campaigns", href: "/campaigns", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-72 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-sans">
      <div className="flex h-20 items-center justify-between border-b border-zinc-100 dark:border-zinc-900 px-6">
        <h1 className="text-xl font-black font-display tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-zinc-500">
          Influence.
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AlertBell />
        </div>
      </div>
      <div className="flex-1 overflow-auto py-8">
        <nav className="space-y-1.5 px-4 text-[13px]">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center rounded-xl px-4 py-3 font-semibold transition-all duration-300",
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-l-[3px] border-white pl-[13px]"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
                )}
              >
                <item.icon className={cn("mr-3 h-4 w-4 shrink-0 transition-transform", isActive && "scale-110")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="border-t border-zinc-100 dark:border-zinc-900 p-6">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center rounded-xl px-4 py-3 text-[13px] font-bold text-red-500 transition-all duration-300 hover:bg-red-50 dark:hover:bg-red-950/20"
        >
          <LogOut className="mr-3 h-4 w-4 shrink-0" />
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
