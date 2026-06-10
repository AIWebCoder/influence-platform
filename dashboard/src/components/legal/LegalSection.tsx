import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}

export function LegalSection({ id, title, children, className }: LegalSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-24 space-y-4", className)}
    >
      <h2
        id={`${id}-heading`}
        className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {title}
      </h2>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-[15px] sm:leading-7">
        {children}
      </div>
    </section>
  );
}

interface LegalParagraphProps {
  children: ReactNode;
  className?: string;
}

export function LegalParagraph({ children, className }: LegalParagraphProps) {
  return <p className={cn(className)}>{children}</p>;
}

interface LegalListProps {
  items: ReactNode[];
  ordered?: boolean;
  className?: string;
}

export function LegalList({ items, ordered = false, className }: LegalListProps) {
  const Tag = ordered ? "ol" : "ul";

  return (
    <Tag
      className={cn(
        "ml-1 space-y-2 pl-5",
        ordered ? "list-decimal" : "list-disc",
        className,
      )}
    >
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </Tag>
  );
}
