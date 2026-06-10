import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";
import { LEGAL } from "@/lib/legal";
import { cn } from "@/lib/utils";

import { LegalLastUpdated } from "./LegalLastUpdated";

const FOOTER_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/data-deletion", label: "Data Deletion" },
] as const;

interface LegalPageLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function LegalPageLayout({
  title,
  description,
  children,
  className,
}: LegalPageLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-muted/30 via-background to-background">
      <header className="sticky top-0 z-10 border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href={LEGAL.website}
            className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Image
              src="/branding/logo-light-sm.png"
              alt={`${LEGAL.productName} logo`}
              width={32}
              height={32}
              className="h-8 w-8 dark:hidden"
              priority
            />
            <Image
              src="/branding/logo-dark-sm.png"
              alt=""
              width={32}
              height={32}
              className="hidden h-8 w-8 dark:block"
              priority
              aria-hidden="true"
            />
            <span className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
              {LEGAL.productName}
            </span>
          </Link>

          <nav aria-label="Legal pages" className="hidden items-center gap-1 sm:flex">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <article
          className={cn(
            "mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8",
            className,
          )}
        >
          <header className="space-y-4 border-b border-border pb-8">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Legal
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {description}
            </p>
            <LegalLastUpdated />
          </header>

          <div className="mt-10 space-y-10 sm:space-y-12">{children}</div>
        </article>
      </main>

      <footer className="border-t border-border bg-muted/20">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{LEGAL.productName}</p>
              <p className="text-sm text-muted-foreground">
                Social media management platform
              </p>
            </div>

            <nav aria-label="Footer legal links" className="flex flex-wrap gap-x-5 gap-y-2">
              {FOOTER_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <Separator className="my-6" />

          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              &copy; {new Date().getFullYear()} {LEGAL.productName}. All rights reserved.
            </p>
            <p>
              Questions?{" "}
              <a
                href={`mailto:${LEGAL.supportEmail}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {LEGAL.supportEmail}
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
