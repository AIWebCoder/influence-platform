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
        "inline-flex items-center rounded-full bg-muted p-1",
        collapsed && "w-full flex-col gap-0.5",
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
            "rounded-full font-semibold uppercase tracking-wide transition-colors",
            collapsed
              ? "w-full px-0 py-1 text-[9px] leading-none"
              : "px-2.5 py-1 text-[10px]",
            locale === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text.language[value]}
        </button>
      ))}
    </div>
  );
}
