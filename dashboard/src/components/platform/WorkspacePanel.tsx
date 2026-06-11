import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function WorkspacePanel({
  title,
  description,
  headerActions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = title != null || headerActions != null;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden shadow-sm", className)}>
      {hasHeader ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title != null ? <h2 className="truncate text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {headerActions}
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
      {footer ? <div className="shrink-0 border-t p-4">{footer}</div> : null}
    </Card>
  );
}

/** Card shell for panels that manage their own header/footer internally. */
export function WorkspaceColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden shadow-sm", className)}>
      {children}
    </Card>
  );
}
