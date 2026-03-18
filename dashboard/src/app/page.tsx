"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { PerformanceChart } from "@/components/analytics/PerformanceChart";
import { TopContent } from "@/components/analytics/TopContent";
import { Recommendations } from "@/components/analytics/Recommendations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, LayoutList, Activity } from "lucide-react";

export default function AnalyticsDashboard() {
  const [accountCount, setAccountCount] = useState(0);
  const [queueSize, setQueueSize] = useState("0");
  const [avgHealth, setAvgHealth] = useState(0);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [accRes, queueRes] = await Promise.all([
          axios.get("http://localhost:3001/accounts"),
          axios.get("http://localhost:8000/content/queue/size").catch(() => ({ data: { size: '0' } }))
        ]);
        
        const accounts = accRes.data;
        const qSize = queueRes.data.size;
        
        setAccountCount(accounts.length);
        setQueueSize(qSize);
        
        let totalHealth = 0;
        accounts.forEach((acc: any) => {
          totalHealth += (acc.health_score || 0);
        });
        setAvgHealth(accounts.length > 0 ? Math.round(totalHealth / accounts.length) : 0);

        const newChartData = [
          { day: "01" },
          { day: "05" },
          { day: "10" },
          { day: "15" },
          { day: "20" },
          { day: "25" },
          { day: "30" },
        ].map((point, index) => {
          const row: any = { day: point.day };
          accounts.forEach((acc: any, i: number) => {
             row[`acc_${acc.username}`] = Math.floor(Math.random() * 500) + 100 * index + (acc.health_score || 50);
          });
          return row;
        });

        if (accounts.length > 0) {
          setChartData(newChartData);
        }

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
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            System Intelligence
          </h2>
          <p className="page-subtitle">
            Real-time telemetry and predictive distribution metrics across your account nodes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Active Nodes</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{accountCount}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">Distribution clusters</p>
            </div>
            <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10">
              <Users className="w-6 h-6 text-indigo-500" />
            </div>
          </div>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Generation Queue</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{queueSize}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">Pending content packets</p>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10">
              <LayoutList className="w-6 h-6 text-emerald-500" />
            </div>
          </div>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Fleet Health</p>
              <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">{avgHealth}%</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">Average across accounts</p>
            </div>
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10">
              <Activity className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <PerformanceChart data={chartData} />
        <TopContent />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
         <Recommendations />
      </div>

    </div>
  );
}
