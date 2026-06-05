import { Inter, Montserrat } from "next/font/google"
import "./globals.css"
import type { Metadata } from "next"
import { Providers } from "@/components/Providers"
import { cn } from "@/lib/utils"
import { LayoutClient } from "@/components/layout/LayoutClient"
import Script from "next/script"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
})

export const metadata: Metadata = {
  title: "Helm",
  description: "Helm — social fleet operations dashboard",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="fr"
      className={cn(inter.variable, montserrat.variable)}
      suppressHydrationWarning
    >
      <body className="flex h-screen overflow-hidden font-sans antialiased text-foreground bg-background">
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
  const storageKey = "theme";
  const classNameDark = "dark";
  const root = document.documentElement;

  const getStoredTheme = () => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  };

  const prefersDark = () => {
    try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
  };

  const stored = getStoredTheme();
  const theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const effectiveDark = theme === "dark" || (theme === "system" && prefersDark());

  if (effectiveDark) root.classList.add(classNameDark);
  else root.classList.remove(classNameDark);
})();`}
        </Script>
        <Providers>
          <LayoutClient>{children}</LayoutClient>
        </Providers>
      </body>
    </html>
  )
}
