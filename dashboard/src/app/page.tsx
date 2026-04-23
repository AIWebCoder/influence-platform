"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PerformanceChart } from "@/components/analytics/PerformanceChart";
import { TopContent } from "@/components/analytics/TopContent";
import { Recommendations } from "@/components/analytics/Recommendations";
import { Users, LayoutList, Activity } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";

export default function AnalyticsDashboard() {
  const { text } = useLocale();
  const [accountCount, setAccountCount] = useState(0);
  const [queueSize, setQueueSize] = useState("0");
  const [avgHealth, setAvgHealth] = useState(0);
  const [chartData, setChartData] = useState<any[]>([]);
  const [topPosts, setTopPosts] = useState<Array<{ id: string; caption: string; engagement: string; niche?: string }>>([]);
  const [recommendations, setRecommendations] = useState<Array<{ type: "insight" | "warning"; title: string; description: string }>>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [accounts, queueRes, posts] = await Promise.all([
          api.distribution.getAccounts(),
          api.content.getQueueSize(),
          api.distribution.getPostAnalytics(),
        ]);
        const qSize = String(queueRes?.size ?? 0);

        setAccountCount(accounts.length);
        setQueueSize(qSize);

        let totalHealth = 0;
        accounts.forEach((acc: any) => {
          totalHealth += acc.health_score || 0;
        });
        setAvgHealth(accounts.length > 0 ? Math.round(totalHealth / accounts.length) : 0);

        const grouped = new Map<string, Record<string, string | number>>();
        for (const post of posts as Array<{ published_at: string; account_username: string; likes?: number; comments?: number }>) {
          const dt = post.published_at ? new Date(post.published_at) : null;
          if (!dt || Number.isNaN(dt.getTime())) continue;
          const day = dt.toISOString().slice(5, 10);
          const key = `acc_${post.account_username}`;
          const score = Number(post.likes || 0) + Number(post.comments || 0);
          if (!grouped.has(day)) grouped.set(day, { day });
          const row = grouped.get(day)!;
          row[key] = Number(row[key] || 0) + score;
        }
        const rows = Array.from(grouped.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, row]) => row);
        setChartData(rows);

        const best = [...(posts as Array<{ id: string; caption?: string; likes?: number; comments?: number; engagement_rate?: string; account_username?: string }>)]
          .sort((a, b) => Number(b.engagement_rate || 0) - Number(a.engagement_rate || 0))
          .slice(0, 4)
          .map((p) => ({
            id: p.id,
            caption: p.caption || "(no caption)",
            engagement: `${Number(p.likes || 0) + Number(p.comments || 0)}`,
            niche: p.account_username ? `@${p.account_username}` : undefined,
          }));
        setTopPosts(best);

        const recs: Array<{ type: "insight" | "warning"; title: string; description: string }> = [];
        const lowHealth = accounts
          .filter((a: any) => Number(a.health_score || 0) < 50)
          .slice(0, 2);
        for (const a of lowHealth) {
          recs.push({
            type: "warning",
            title: `Rest account: ${a.username}`,
            description: `Health score is ${a.health_score}. Pause posting and investigate account safety signals.`,
          });
        }
        recs.push({
          type: "insight",
          title: "Optimize queue throughput",
          description: `Current queue size is ${qSize}. Keep queue under control to reduce publish latency.`,
        });
        setRecommendations(recs);
      } catch (err) {
        console.error("Error loading analytics data", err);
      }
    }
    loadData();
  }, []);

  return (
    <div className="flex-1 space-y-8 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">{text.home.title}</h2>
          <p className="page-subtitle">{text.home.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{text.home.activeNodes}</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{accountCount}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">{text.home.activeNodesSubtitle}</p>
            </div>
            <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10">
              <Users className="w-6 h-6 text-indigo-500" />
            </div>
          </div>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{text.home.generationQueue}</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{queueSize}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">{text.home.generationQueueSubtitle}</p>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10">
              <LayoutList className="w-6 h-6 text-emerald-500" />
            </div>
          </div>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{text.home.fleetHealth}</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{avgHealth}%</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">{text.home.fleetHealthSubtitle}</p>
            </div>
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10">
              <Activity className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <PerformanceChart data={chartData} />
        <TopContent posts={topPosts} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Recommendations items={recommendations} />
      </div>
    </div>
  );
}
