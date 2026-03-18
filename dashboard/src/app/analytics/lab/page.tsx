'use client';

import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Target, 
  Clock, 
  TrendingUp, 
  MessageSquare, 
  Hash, 
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Search,
  Sparkles,
  BarChart3
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';

export default function OptimizationLabPage() {
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [scoreData, setScoreData] = useState<any>(null);
  const [scoring, setScoring] = useState(false);
  
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [bestTimes, setBestTimes] = useState<any[]>([]);
  const [freqSuggestion, setFreqSuggestion] = useState<any>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await api.distribution.getAccounts();
      setAccounts(data);
      if (data.length > 0) {
        setSelectedAccount(data[0].id);
        loadStrategy(data[0].id);
      }
    } catch (error) {
      toast.error('Failed to load accounts');
    }
  };

  const loadStrategy = async (accountId: string) => {
    setLoadingStrategy(true);
    try {
      const [times, freq] = await Promise.all([
        api.distribution.getOptimalPostingTimes({ accountId }),
        api.distribution.getSuggestedFrequency(accountId)
      ]);
      setBestTimes(times);
      setFreqSuggestion(freq);
    } catch (error) {
      toast.error('Failed to load strategy optimization');
    } finally {
      setLoadingStrategy(false);
    }
  };

  const handleScore = async () => {
    if (!caption.trim()) return;
    setScoring(true);
    try {
      const hashtagList = hashtags.split(',').map(h => h.trim().replace('#', '')).filter(h => h);
      const data = await api.content.scoreCaption(caption, hashtagList);
      setScoreData(data);
      toast.success('Caption scored successfully!');
    } catch (error) {
      toast.error('Failed to score caption');
    } finally {
      setScoring(false);
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'B': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'C': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      default: return 'text-red-400 bg-red-500/10 border-red-500/20';
    }
  };

  return (
    <div className="flex-1 space-y-10 p-8 pt-6 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <span className="text-xs font-bold text-purple-500 uppercase tracking-widest">AI Intelligence</span>
          </div>
          <h1 className="page-title bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-zinc-500 font-display">
            Optimization Lab
          </h1>
          <p className="page-subtitle">Refine your strategy with data-driven AI insights.</p>
        </div>

        <div className="flex items-center gap-4 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <Target className="w-5 h-5 text-zinc-400 ml-2" />
          <select 
            value={selectedAccount}
            onChange={(e) => { setSelectedAccount(e.target.value); loadStrategy(e.target.value); }}
            className="bg-transparent border-none text-zinc-900 dark:text-zinc-100 focus:ring-0 text-sm pr-8 font-bold appearance-none cursor-pointer"
          >
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.username}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Left Column: Caption Sandbox */}
        <div className="xl:col-span-8 space-y-6">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-premium overflow-hidden shadow-sm">
            <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-950/20">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-500/10 rounded-2xl">
                  <MessageSquare className="w-5 h-5 text-indigo-500" />
                </div>
                <h2 className="font-black text-zinc-900 dark:text-zinc-50 font-display text-lg">Caption Sandbox</h2>
              </div>
              <button 
                onClick={handleScore}
                disabled={scoring || !caption}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-purple-900/10"
              >
                {scoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Analyze Engagement
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Paste your caption here to analyze its engagement potential..."
                className="w-full h-48 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-premium p-6 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all custom-scrollbar placeholder:text-zinc-400 font-medium"
              />
              <div className="relative">
                <Hash className="absolute left-6 top-5 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="Enter hashtags separated by commas (optional)"
                  className="w-full pl-14 pr-6 py-4 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-semibold"
                />
              </div>
            </div>

            {scoreData && (
              <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-950/50 rounded-premium border border-zinc-100 dark:border-zinc-800">
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-black uppercase tracking-widest mb-4">Quality Grade</span>
                    <div className={`text-6xl font-black px-8 py-4 rounded-premium border-2 ${getGradeColor(scoreData.grade)} font-display`}>
                      {scoreData.grade}
                    </div>
                    <span className="mt-6 text-2xl font-black text-zinc-900 dark:text-zinc-50">{scoreData.total_score}%</span>
                  </div>

                  <div className="md:col-span-2 space-y-4">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase flex items-center gap-2 font-mono">
                       Optimization Tips
                    </h3>
                    <div className="grid grid-cols-1 gap-3">
                      {scoreData.suggestions.map((s: string, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-card rounded-xl border border-border shadow-sm">
                          {s.includes('Great') ? (
                            <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                          )}
                          <span className="text-sm text-foreground/80 font-medium">{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {Object.entries(scoreData.breakdown).map(([key, val]: [any, any]) => (
                    <div key={key} className="p-3 bg-muted/20 rounded-xl border border-border text-center">
                      <span className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">
                        {key.replace('_score', '')}
                      </span>
                      <span className={`text-sm font-black ${val > 70 ? 'text-emerald-500' : 'text-foreground/70'}`}>{val}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Strategy & Growth */}
        <div className="xl:col-span-4 space-y-6">
          {/* Optimal Posting Times */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-premium p-8 shadow-sm relative overflow-hidden">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-blue-500/10 rounded-2xl">
                <Clock className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-black text-zinc-900 dark:text-zinc-50 leading-tight font-display text-lg">Optimal Times</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Peak engagement windows</p>
              </div>
            </div>

            <div className="space-y-3">
              {loadingStrategy ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800/50 animate-pulse rounded-2xl" />
                ))
              ) : bestTimes.length > 0 ? (
                bestTimes.map((t, i) => (
                  <div key={i} className="flex items-center justify-between p-5 bg-zinc-50 dark:bg-zinc-950/20 rounded-2xl border border-zinc-100 dark:border-zinc-800 hover:border-indigo-500/30 transition-all group cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="text-2xl font-black text-zinc-100 dark:text-zinc-800 group-hover:text-indigo-500/30 transition-colors italic font-display">0{i+1}</div>
                      <div>
                        <div className="text-xl font-black text-zinc-900 dark:text-zinc-50 font-display">{t.hour}:00</div>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-black tracking-widest">
                          <TrendingUp className="w-3 h-3" />
                          {t.score}% ER
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-muted-foreground/50 text-sm">
                  Not enough data for this account yet.
                </div>
              )}
            </div>
          </div>

          {/* Frequency Suggestion */}
          <div className="bg-gradient-to-br from-indigo-500/[0.03] to-purple-500/[0.03] border border-zinc-200 dark:border-zinc-800 rounded-[2.5rem] p-8 backdrop-blur-sm relative overflow-hidden shadow-sm">
            <div className="absolute top-0 right-0 -m-8 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
            
            <div className="flex items-center gap-4 mb-8 relative">
              <div className="w-12 h-12 flex items-center justify-center bg-purple-500/10 rounded-2xl">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-50 leading-tight">Growth Velocity</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Posting frequency advice</p>
              </div>
            </div>

            {loadingStrategy ? (
              <div className="h-32 bg-zinc-100 dark:bg-zinc-800/50 animate-pulse rounded-2xl" />
            ) : freqSuggestion ? (
              <div className="space-y-6 relative">
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-3xl font-black text-foreground flex items-baseline gap-1">
                      {freqSuggestion.suggested_frequency}
                      <span className="text-sm font-bold text-muted-foreground">posts / day</span>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                    freqSuggestion.action === 'increase' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                    freqSuggestion.action === 'decrease' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                    'text-blue-400 bg-blue-500/10 border-blue-500/20'
                  }`}>
                    {freqSuggestion.action}
                  </div>
                </div>

                <div className="p-3 bg-muted/10 rounded-xl text-xs text-muted-foreground border border-border leading-relaxed">
                  {freqSuggestion.reason}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] text-muted-foreground/30 font-black uppercase block mb-1 tracking-tighter">Recent ER</span>
                    <span className="text-lg font-bold text-foreground/80">{freqSuggestion.metrics.recent_er}%</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/30 font-black uppercase block mb-1 tracking-tighter">Growth Delta</span>
                    <span className={`text-lg font-bold ${parseFloat(freqSuggestion.metrics.delta) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {freqSuggestion.metrics.delta}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-neutral-500 text-sm">
                Analyze more posts to unlock growth advice.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
