import { Lightbulb, AlertTriangle, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Recommendation = {
  type: "insight" | "warning";
  title: string;
  description: string;
};

export function Recommendations({ items }: { items: Recommendation[] }) {
  return (
    <Card className="col-span-full xl:col-span-3 h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          AI Recommendations
        </CardTitle>
        <CardDescription>System-generated insights</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendations available yet.</p>
        ) : items.map((item, idx) => (
          <div
            key={`${item.type}-${idx}`}
            className={
              item.type === "warning"
                ? "flex items-start gap-4 rounded-md border p-4 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20"
                : "flex items-start gap-4 rounded-md border p-4"
            }
          >
            {item.type === "warning" ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" />
            ) : (
              <TrendingUp className="mt-0.5 h-5 w-5 text-green-500" />
            )}
            <div className="space-y-1">
              <p className={item.type === "warning" ? "text-sm font-medium leading-none text-red-700 dark:text-red-400" : "text-sm font-medium leading-none"}>
                {item.title}
              </p>
              <p className={item.type === "warning" ? "text-sm text-red-600/80 dark:text-red-400/80" : "text-sm text-muted-foreground"}>
                {item.description}
              </p>
            </div>
          </div>
        ))}

      </CardContent>
    </Card>
  );
}
