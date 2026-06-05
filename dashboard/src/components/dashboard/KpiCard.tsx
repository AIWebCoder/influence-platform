"use client";

import type { ElementType } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiTrendBadge } from "@/components/dashboard/KpiTrendBadge";

export function KpiCard({
  title,
  value,
  sub,
  severity,
  icon: Icon,
}: {
  title: string;
  value: string;
  sub: string;
  severity: "low" | "medium" | "high";
  icon: ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label text-muted-foreground">{title}</p>
            <p className="mt-1.5 text-[1.625rem] font-semibold tabular-nums tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <KpiTrendBadge severity={severity} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
