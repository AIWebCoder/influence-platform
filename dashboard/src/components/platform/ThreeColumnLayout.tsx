import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ColSpan = 3 | 4 | 5 | 6;

const COL_SPAN_CLASS: Record<ColSpan, string> = {
  3: "xl:col-span-3",
  4: "xl:col-span-4",
  5: "xl:col-span-5",
  6: "xl:col-span-6",
};

export function ThreeColumnLayout({
  left,
  center,
  right,
  spans = { left: 3, center: 6, right: 3 },
  className,
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  spans?: { left: ColSpan; center: ColSpan; right: ColSpan };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full min-h-[min(72vh,780px)] grid-cols-1 gap-4 xl:grid-cols-12",
        className,
      )}
      data-layout="three-column"
    >
      <div className={cn("flex min-h-0 flex-col", COL_SPAN_CLASS[spans.left])}>{left}</div>
      <div className={cn("flex min-h-0 flex-col", COL_SPAN_CLASS[spans.center])}>{center}</div>
      <div className={cn("flex min-h-0 flex-col", COL_SPAN_CLASS[spans.right])}>{right}</div>
    </div>
  );
}
