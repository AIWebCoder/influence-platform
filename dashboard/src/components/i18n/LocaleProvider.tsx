"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  interpolate,
  LOCALE_STORAGE_KEY,
  Locale,
  translations,
  TranslationTree,
} from "@/lib/i18n";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string, values?: Record<string, string | number>) => string;
  text: TranslationTree;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getValueByPath(source: Record<string, any>, path: string): string {
  const value = path.split(".").reduce<any>((acc, key) => acc?.[key], source);
  return typeof value === "string" ? value : path;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === "fr" || stored === "en") {
        setLocaleState(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {}
  }, [locale]);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
  };

  const t = (path: string, values?: Record<string, string | number>) => {
    return interpolate(getValueByPath(translations[locale] as Record<string, any>, path), values);
  };

  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        t,
        text: translations[locale],
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
