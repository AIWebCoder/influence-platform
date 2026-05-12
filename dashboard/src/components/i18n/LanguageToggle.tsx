"use client";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

type LanguageToggleProps = {
  /** Narrow sidebar: stack locale buttons vertically */
  collapsed?: boolean;
};

export function LanguageToggle({ collapsed = false }: LanguageToggleProps) {
  const { locale, setLocale, text } = useLocale();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900",
        collapsed && "w-full flex-col gap-0.5 p-0.5",
      )}
      aria-label={text.language.switchLabel}
      title={text.language.switchLabel}
    >
      {(["fr", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          className={cn(
            "rounded-lg font-black uppercase tracking-widest transition-all",
            collapsed
              ? "w-full px-0 py-1 text-[9px] leading-none"
              : "px-2.5 py-1.5 text-[10px]",
            locale === value
              ? "bg-[var(--color-primary)] text-white"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          {text.language[value]}
        </button>
      ))}
    </div>
  );
}
