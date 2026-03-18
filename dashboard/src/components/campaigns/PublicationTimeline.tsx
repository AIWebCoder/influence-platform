"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Activity } from "lucide-react";

interface Publication {
  id: string;
  content_id: string;
  platform: string;
  post_url: string | null;
  published_at: string;
  account_username: string;
}

export function PublicationTimeline() {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.distribution.getPublications();
        setPublications(data);
      } catch (err) {
        console.error("Failed to load publications", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="p-4 text-center">Loading timeline...</div>;

  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Recent Publications</CardTitle>
        <CardDescription>
          Live distribution feed across the network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {publications.length === 0 ? (
             <div className="text-sm text-muted-foreground text-center py-4">No content has been published yet.</div>
          ) : publications.map(pub => (
            <div className="flex items-center" key={pub.id}>
              <div className="ml-4 space-y-1 flex-1">
                <p className="text-sm font-medium leading-none">
                  {pub.account_username} <span className="text-muted-foreground font-normal">published a post on</span> {pub.platform}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(pub.published_at), { addSuffix: true })}
                </p>
              </div>
              <div className="ml-auto font-medium">
                {pub.post_url ? (
                  <a href={pub.post_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs">
                    View Post ↗
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Link Pending</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
