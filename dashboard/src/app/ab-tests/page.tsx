'use client';

import React, { useState, useEffect } from 'react';
import { 
  Split, 
  Trophy, 
  BarChart2, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  TrendingUp,
  FlaskConical,
  RefreshCw,
  Search
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { PrimaryButton } from '@/components/ui/PrimaryButton';

export default function ABTestingPage() {
  const [tests, setTests] = useState<any[]>([]);
  const [selectedTest, setSelectedTest] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadTests();
  }, []);

  const loadTests = async () => {
    try {
      setLoading(true);
      const data = await api.distribution.getABTests();
      setTests(data);
    } catch (error) {
      console.error('Failed to load AB tests:', error);
      toast.error('Failed to fetch A/B tests');
    } finally {
      setLoading(false);
    }
  };

  const loadPerformance = async (id: string) => {
    try {
      setPerformance(null);
      const data = await api.distribution.getABTestPerformance(id);
      setPerformance(data);
    } catch (error) {
      toast.error('Failed to load performance metrics');
    }
  };

  const handleEvaluate = async (id: string) => {
    setEvaluating(true);
    try {
      const result = await api.distribution.evaluateABTest(id);
      if (result.winner !== 'pending') {
        toast.success(`Winner declared: Variant ${result.winner}!`);
        loadTests();
        loadPerformance(id);
      } else {
        toast.success('Analyzing experiment data...');
      }
    } catch (error) {
      toast.error('Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  };

  const filteredTests = tests.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.niche.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 space-y-8 p-8 pt-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="page-title bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500 font-display">
            A/B Content Lab
          </h1>
          <p className="page-subtitle">Optimize engagement by pitting AI styles against each other.</p>
        </div>
        <button 
          onClick={loadTests}
          className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700"
        >
          <RefreshCw className={`w-5 h-5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Test List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search experiments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-colors"
            />
          </div>

          <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredTests.map((test) => (
              <div
                key={test.id}
                onClick={() => { setSelectedTest(test); loadPerformance(test.id); }}
                className={`p-4 rounded-xl border cursor-pointer transition-all duration-300 ${
                  selectedTest?.id === test.id 
                    ? 'bg-purple-500/10 border-purple-500 shadow-lg shadow-purple-500/10' 
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    test.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'
                  }`}>
                    {test.status}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    {new Date(test.started_at).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-50 truncate">{test.name}</h3>
                <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
                  <FlaskConical className="w-3 h-3" />
                  <span className="font-medium">{test.niche}</span>
                  {test.winner && (
                    <div className="ml-auto flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Trophy className="w-3 h-3" />
                      <span className="font-bold">Winner: {test.winner}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {filteredTests.length === 0 && !loading && (
              <div className="text-center py-12 text-muted-foreground/30">
                <FlaskConical className="w-12 h-12 mx-auto mb-4 opacity-10" />
                <p>No experiments found</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Details & Split View */}
        <div className="lg:col-span-8 space-y-6">
          {!selectedTest ? (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-premium p-12 text-center bg-zinc-50/50 dark:bg-zinc-900/20">
              <div className="p-6 bg-zinc-100 dark:bg-zinc-800 rounded-premium mb-6">
                <Split className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
              </div>
              <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-50 font-display">Select an Experiment</h2>
              <p className="text-muted-foreground max-w-xs mt-2 font-medium">Explore performance data and declare winners for your content variants.</p>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              {/* Header Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mb-1 font-black uppercase tracking-widest">Status</span>
                  <div className="flex items-center gap-2">
                    {selectedTest.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-purple-500" />
                    )}
                    <span className="font-bold text-zinc-900 dark:text-zinc-100 capitalize">{selectedTest.status}</span>
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mb-1 font-black uppercase tracking-widest">Winning ER</span>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-500" />
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{selectedTest.winning_er || '--'}%</span>
                  </div>
                </div>
                {/* Add more metrics as needed */}
              </div>

              {/* Variant Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:block">
                  <div className="bg-zinc-950 px-3 py-1 rounded-full border border-zinc-800 text-[10px] font-bold text-zinc-500">VS</div>
                </div>

                {['A', 'B'].map((v) => {
                  const varMetrics = performance?.variants?.find((m: any) => m.variant === v);
                  const isWinner = selectedTest.winner === v;
                  
                  return (
                    <div 
                      key={v}
                      className={`p-6 rounded-premium border relative overflow-hidden transition-all duration-500 shadow-sm ${
                        isWinner 
                          ? 'bg-emerald-500/5 border-emerald-500/50 shadow-xl shadow-emerald-500/5' 
                          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      {isWinner && (
                        <div className="absolute top-0 right-0 p-4">
                          <Trophy className="w-6 h-6 text-emerald-500 drop-shadow-lg" />
                        </div>
                      )}
                      
                      <div className="flex items-baseline gap-2 mb-6">
                        <span className="text-3xl font-black text-zinc-100 dark:text-zinc-800 italic font-display">#{v}</span>
                        <h4 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 font-display">
                          {v === 'A' ? 'Educational' : 'Promotional'}
                        </h4>
                      </div>

                      <div className="space-y-6">
                        <div className="space-y-2">
                          <div className="flex justify-between items-end">
                            <span className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">Engagement Rate</span>
                            <span className={`text-2xl font-black ${isWinner ? 'text-emerald-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                              {varMetrics?.avg_er ? `${varMetrics.avg_er}%` : '0%'}
                            </span>
                          </div>
                          <div className="h-2 bg-zinc-100 dark:bg-zinc-950/50 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-1000 ${isWinner ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                              style={{ width: `${varMetrics?.avg_er || 0}%` }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-black block mb-1">Likes</span>
                            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{varMetrics?.total_likes || 0}</span>
                          </div>
                          <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-black block mb-1">Sample Size</span>
                            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{varMetrics?.sample_size || 0}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Bar */}
              {selectedTest.status === 'running' && (
                <div className="p-10 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-premium border border-indigo-500/10 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-700">
                  <div className="p-4 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl shadow-indigo-500/5 mb-4">
                    <FlaskConical className="w-8 h-8 text-indigo-500" />
                  </div>
                  <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-50 font-display">Is this experiment ready?</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 mb-8 max-w-sm mx-auto font-medium">Analyze the performance telemetry and declare a winner to optimize your autonomous engine.</p>
                  <PrimaryButton
                    onClick={() => handleEvaluate(selectedTest.id)}
                    disabled={evaluating}
                    className="flex items-center gap-3"
                  >
                    {evaluating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <BarChart2 className="w-5 h-5" />}
                    Lock in Winner
                  </PrimaryButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
