import { Lightbulb, AlertTriangle, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function Recommendations() {
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
        
        <div className="flex items-start gap-4 rounded-md border p-4">
          <TrendingUp className="mt-0.5 h-5 w-5 text-green-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">Increase Tech Frequency</p>
            <p className="text-sm text-muted-foreground">Accounts in the Tech niche are seeing a 15% bump in reach. Recommend generating 2 additional posts per day.</p>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-md border p-4 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none text-red-700 dark:text-red-400">Rest Account: sneaker_bot_99</p>
            <p className="text-sm text-red-600/80 dark:text-red-400/80">Health score dropped to 45. The Distribution Engine has automatically engaged failover protocols.</p>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
