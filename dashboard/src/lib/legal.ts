import type { Metadata } from "next";

export const LEGAL = {
  productName: "MyMultiFlow",
  website: "https://mymultiflow.com",
  supportEmail: "support@mymultiflow.com",
  lastUpdated: "June 10, 2026",
  lastUpdatedIso: "2026-06-10",
} as const;

export const LEGAL_ROUTES = ["/privacy", "/terms", "/data-deletion"] as const;

export type LegalRoute = (typeof LEGAL_ROUTES)[number];

export function isLegalRoute(pathname: string): pathname is LegalRoute {
  return (LEGAL_ROUTES as readonly string[]).includes(pathname);
}

export function isPublicRoute(pathname: string): boolean {
  return pathname === "/login" || isLegalRoute(pathname);
}

export function createLegalMetadata(
  title: string,
  description: string,
  path: LegalRoute,
): Metadata {
  const url = `${LEGAL.website}${path}`;

  return {
    title: `${title} | ${LEGAL.productName}`,
    description,
    metadataBase: new URL(LEGAL.website),
    alternates: {
      canonical: path,
    },
    openGraph: {
      title: `${title} | ${LEGAL.productName}`,
      description,
      url,
      siteName: LEGAL.productName,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title: `${title} | ${LEGAL.productName}`,
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
