import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const topPosts = [
  { id: 1, caption: "5 tricks for Next.js 14 🚀", engagement: "12.4k", niche: "Tech" },
  { id: 2, early: true, caption: "Morning routine setup ☕", engagement: "8.1k", niche: "Lifestyle" },
  { id: 3, caption: "How to fix shadowbans...", engagement: "6.2k", niche: "Growth" },
  { id: 4, caption: "AI tools you need in 2026", engagement: "5.5k", niche: "Tech" },
];

export function TopContent() {
  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Top Performing Content</CardTitle>
        <CardDescription>
          Highest engagement rates by niche.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {topPosts.map(post => (
            <div className="flex items-center" key={post.id}>
              <div className="ml-4 space-y-1 flex-1">
                <p className="text-sm font-medium leading-none truncate w-[200px]">
                  {post.caption}
                </p>
                <div className="flex items-center text-xs text-muted-foreground pt-1 gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {post.niche}
                  </Badge>
                </div>
              </div>
              <div className="ml-auto font-bold text-sm text-green-600 dark:text-green-400">
                {post.engagement}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
