"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useMemo } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  Clapperboard,
  LayoutDashboard,
  LogOut,
  Smartphone,
  Split,
  Users,
} from "lucide-react";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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

function navItemTitle(item: NavItem, comingSoonHint: string) {
  if (item.comingSoon) {
    return `${item.name} — ${comingSoonHint}`;
  }
  return item.name;
}

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { text } = useLocale();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const logoSrc = useMemo(() => {
    const isDarkUi = resolvedTheme === "dark";
    const size = collapsed ? "sm" : "lg";
    if (isDarkUi) {
      return `/branding/logo-light-${size}.png`;
    }
    return `/branding/logo-dark-${size}.png`;
  }, [resolvedTheme, collapsed]);

  const userName = session?.user?.name || text.sidebar.profileFallbackName;
  const initials =
    userName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "IP";

  const comingSoonHint = text.sidebar.comingSoonHint;

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

  return (
    <Sidebar collapsible="icon" variant="sidebar" side="left">
      <SidebarHeader className="border-b border-sidebar-border px-2 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="h-auto min-h-12 py-2">
              <Link href="/" className="gap-3">
                <div
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-md border",
                    resolvedTheme === "dark"
                      ? "border-sidebar-border/60 bg-transparent"
                      : "border-sidebar-border/60 bg-sidebar-accent/40",
                    collapsed ? "size-9" : "size-10 max-w-[10rem]",
                  )}
                >
                  <Image
                    key={logoSrc}
                    src={logoSrc}
                    alt="Influence Platform"
                    fill
                    className="object-contain object-center p-0.5"
                    sizes={collapsed ? "36px" : "160px"}
                    unoptimized
                    priority
                  />
                </div>
                <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
                  Influence Platform
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-0">
        {navGroups.map((group, gi) => (
          <SidebarGroup key={group.label} className={cn(gi > 0 && "border-t border-sidebar-border pt-2")}>
            <SidebarGroupLabel className="px-4">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  const isDisabled = Boolean(item.comingSoon);
                  const tip = navItemTitle(item, comingSoonHint);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive && !isDisabled}
                        tooltip={tip}
                        className="h-auto min-h-10 gap-2 px-3 py-2"
                        aria-disabled={isDisabled}
                      >
                        <Link
                          href={isDisabled ? "#" : item.href}
                          title={tip}
                          onClick={isDisabled ? (e) => e.preventDefault() : undefined}
                          className={cn(isDisabled && "cursor-not-allowed opacity-60")}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <div className="grid min-w-0 flex-1 gap-0.5 text-left group-data-[collapsible=icon]:hidden">
                            <span className="truncate font-medium leading-none">{item.name}</span>
                            <span className="truncate text-xs text-sidebar-foreground/65 leading-tight">
                              {item.comingSoon ? text.sidebar.comingSoonHint : group.label}
                            </span>
                          </div>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator className="mx-0" />

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="h-auto min-h-12 gap-2 py-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                    {initials}
                  </div>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">{text.sidebar.profileRole}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 rounded-lg" side="top" align="start" sideOffset={8}>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{userName}</p>
                    <p className="text-xs leading-none text-muted-foreground">{text.sidebar.profileRole}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{text.sidebar.themeSection}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}>
                  <DropdownMenuRadioItem value="light">{text.sidebar.themeLight}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">{text.sidebar.themeDark}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">{text.sidebar.themeSystem}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  <LogOut className="size-4" />
                  {text.nav.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
