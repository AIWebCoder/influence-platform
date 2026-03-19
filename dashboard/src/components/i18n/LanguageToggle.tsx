"use client";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

export function LanguageToggle() {
  const { locale, setLocale, text } = useLocale();

  return (
    <div
      className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      aria-label={text.language.switchLabel}
      title={text.language.switchLabel}
    >
      {(["fr", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all",
            locale === value
              ? "bg-[var(--color-primary)] text-white"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          )}
        >
          {text.language[value]}
        </button>
      ))}
    </div>
  );
}
