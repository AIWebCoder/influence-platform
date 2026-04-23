import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TopPost = {
  id: string;
  caption: string;
  engagement: string;
  niche?: string;
};

export function TopContent({ posts }: { posts: TopPost[] }) {
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
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No published content yet.</p>
          ) : posts.map(post => (
            <div className="flex items-center" key={post.id}>
              <div className="ml-4 space-y-1 flex-1">
                <p className="text-sm font-medium leading-none truncate w-[200px]">
                  {post.caption}
                </p>
                <div className="flex items-center text-xs text-muted-foreground pt-1 gap-2">
                  {post.niche ? (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {post.niche}
                    </Badge>
                  ) : null}
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
