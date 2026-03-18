"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  ChevronRight,
  Loader2,
  Calendar,
  Filter,
  Download,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

interface PostMetric {
  id: string;
  instagram_post_id: string;
  published_at: string;
  account_username: string;
  caption: string;
  likes: number;
  comments: number;
  engagement_rate: string;
}

interface AccountSummary {
  id: string;
  username: string;
  followers_count: number;
}

export default function AnalyticsPage() {
  const [posts, setPosts] = useState<PostMetric[]>([]);
  const [topPosts, setTopPosts] = useState<PostMetric[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"posts" | "accounts">("posts");

  const fetchData = useCallback(async () => {
    try {
      const [postData, topData, accData] = await Promise.all([
        api.distribution.getPostAnalytics(),
        api.distribution.getTopPerforming(),
        api.distribution.getAccounts()
      ]);
      setPosts(postData);
      setTopPosts(topData);
      setAccounts(accData);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            <BarChart3 className="w-10 h-10 text-indigo-500" />
            Performance
          </h2>
          <p className="page-subtitle">
            Track engagement trends, content ROI, and audience growth across all channels.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PrimaryButton variant="ghost" className="flex items-center gap-3">
            <Filter className="w-4 h-4" />
            Filter Range
          </PrimaryButton>
          <PrimaryButton className="flex items-center gap-3">
            <Download className="w-4 h-4" />
            Export CSV
          </PrimaryButton>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Total Engagement</p>
          <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">12.4K</p>
          <div className="flex items-center gap-1.5 mt-3 text-emerald-600 text-[10px] font-black uppercase tracking-widest">
            <TrendingUp className="w-3.5 h-3.5" /> +8.2% velocity
          </div>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Growth Velocity</p>
          <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">+842</p>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 font-black uppercase tracking-widest">Nodes / Net Growth</p>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Avg Engagement Rate</p>
          <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">4.2%</p>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 font-black uppercase tracking-widest">System benchmark: 2.1%</p>
        </div>

        <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Success Probability</p>
          <p className="text-3xl font-black mt-2 font-display text-zinc-900 dark:text-zinc-50">94%</p>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-3 font-black uppercase tracking-widest">Confidence: High</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("posts")}
          className={cn(
            "px-6 py-2 rounded-lg text-sm font-semibold transition-all",
            activeTab === "posts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          Post Performance
        </button>
        <button
          onClick={() => setActiveTab("accounts")}
          className={cn(
            "px-6 py-2 rounded-lg text-sm font-semibold transition-all",
            activeTab === "accounts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          Account Growth
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Feed */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
            <div className="p-5 border-b bg-muted/10 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-500" />
                Latest Content ROI
              </h3>
              <span className="text-[10px] uppercase font-bold text-muted-foreground">Recent 50 Publications</span>
            </div>
            <div className="divide-y">
              {loading ? (
                <div className="p-20 flex flex-col items-center justify-center text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="text-sm">Aggregating timeseries data...</p>
                </div>
              ) : posts.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">No publications found.</div>
              ) : (
                posts.map((post) => (
                  <div key={post.id} className="p-4 hover:bg-muted/10 transition-colors flex items-center gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-indigo-600">@{post.account_username}</span>
                        <span className="text-[10px] text-muted-foreground">• {new Date(post.published_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm line-clamp-1 text-foreground/80">{post.caption}</p>
                    </div>
                    
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1 text-rose-500 font-bold text-sm">
                          <Heart className="w-3.5 h-3.5" />
                          {post.likes}
                        </div>
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Likes</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1 text-blue-500 font-bold text-sm">
                          <MessageCircle className="w-3.5 h-3.5" />
                          {post.comments}
                        </div>
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Comments</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                          parseFloat(post.engagement_rate) > 5 ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-muted text-muted-foreground"
                        )}>
                          {post.engagement_rate}% ER
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-1">Engagement</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar / Top Content */}
        <div className="space-y-6">
          <div className="rounded-2xl border bg-card shadow-sm overflow-hidden p-6 bg-gradient-to-br from-indigo-50/50 to-transparent">
            <h4 className="font-bold flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              Top Global Content
            </h4>
            <div className="space-y-4">
              {topPosts.map((post, i) => (
                <div key={post.id} className="flex gap-3 group cursor-pointer">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate group-hover:text-indigo-600 transition-colors">@{post.account_username}</p>
                    <div className="flex items-center gap-3 mt-1">
                       <span className="text-[10px] flex items-center gap-1 font-mono">
                         <Heart className="w-2.5 h-2.5" /> {post.likes}
                       </span>
                       <span className="text-[10px] text-emerald-600 font-bold">{post.engagement_rate}% ER</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
              View Content Cloud
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
             <h4 className="font-bold flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-blue-500" />
              Optimal Posting Times
            </h4>
            <div className="grid grid-cols-2 gap-3">
               {[
                 { time: "10:30 AM", score: 92 },
                 { time: "06:15 PM", score: 88 },
                 { time: "09:00 PM", score: 84 },
                 { time: "03:45 AM", score: 76 },
               ].map((t) => (
                 <div key={t.time} className="p-3 rounded-xl border bg-muted/10">
                   <p className="text-xs font-bold">{t.time}</p>
                   <div className="flex items-center justify-between mt-1">
                      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mr-2">
                        <div className="h-full bg-indigo-500" style={{ width: `${t.score}%` }} />
                      </div>
                      <span className="text-[9px] font-bold text-indigo-600">{t.score}</span>
                   </div>
                 </div>
               ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-4 text-center">
              Based on historical interaction heatmaps.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
