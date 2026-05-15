"use client";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { GenerationJobProgressDock } from "@/components/generation/GenerationJobProgressDock";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { AlertBell } from "@/components/layout/AlertBell";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <SidebarProvider
          className="min-h-0 min-w-0 flex-1"
          style={
            {
              "--sidebar-width": "18.25rem",
              "--sidebar-width-mobile": "20rem",
              "--sidebar-width-icon": "3.75rem",
            } as React.CSSProperties
          }
        >
          <AppSidebar />
          <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
              <SidebarTrigger className="-ml-1" />
              <div className="ml-auto flex items-center gap-2">
                <LanguageToggle />
                <AlertBell />
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </div>
      <GenerationJobProgressDock />
    </>
  );
}
