"use client";

import { useCallback, useEffect, useState } from "react";
import { ListOrdered, Loader2, RefreshCw, Send } from "lucide-react";
import toast from "react-hot-toast";
import Link from "next/link";

import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type QueueItem = {
  intent_id: string;
  generation_job_id: string;
  status: string;
  content_type?: string | null;
  caption?: string | null;
  public_url?: string | null;
  target_count: number;
  created_at?: string | null;
};

export default function ReadyQueuePage() {
  const { text, t } = useLocale();
  const q = text.readyQueue;
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.content.getReadyQueue({ status: "ready,draft", limit: 100 });
      setItems(data);
    } catch {
      setError(q.loadError);
    } finally {
      setLoading(false);
    }
  }, [q.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDispatch = async (item: QueueItem) => {
    if (item.status !== "ready") {
      toast(q.draftIntentToast);
      return;
    }
    setDispatchingId(item.intent_id);
    setError(null);
    try {
      const out = await api.generationJobs.dispatchPublishIntent(item.intent_id);
      toast.success(t("readyQueue.dispatched", { count: out.dispatched_targets }));
      await load();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : e instanceof Error
            ? e.message
            : q.dispatchFailed;
      setError(msg || q.dispatchFailed);
      toast.error(msg || q.dispatchFailed);
    } finally {
      setDispatchingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{q.title}</h1>
          <p className="text-sm text-muted-foreground">{q.subtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListOrdered className="size-5" />
            {q.itemsTitle} ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{q.status}</TableHead>
                  <TableHead>{q.type}</TableHead>
                  <TableHead>{q.caption}</TableHead>
                  <TableHead>{q.targets}</TableHead>
                  <TableHead>{q.job}</TableHead>
                  <TableHead className="text-right">{q.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {q.empty}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.intent_id}>
                      <TableCell>
                        <Badge variant="outline">{item.status}</Badge>
                      </TableCell>
                      <TableCell>{item.content_type || "-"}</TableCell>
                      <TableCell className="max-w-xs truncate">{item.caption || "-"}</TableCell>
                      <TableCell>{item.target_count}</TableCell>
                      <TableCell>
                        <Link
                          href={`/generation-studio?job=${item.generation_job_id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          {item.generation_job_id.slice(0, 8)}...
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={dispatchingId === item.intent_id}
                          onClick={() => void handleDispatch(item)}
                        >
                          {dispatchingId === item.intent_id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <>
                              <Send className="mr-1 size-3" />
                              {q.dispatch}
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
