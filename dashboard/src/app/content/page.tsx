"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { 
  Sparkles, 
  Send, 
  RefreshCw, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  Hash, 
  Calendar, 
  Clock,
  Pencil,
  Eye
} from "lucide-react";
import clsx from "clsx";
import { cn } from "@/lib/utils";
import { InstagramPreview } from "@/components/content/InstagramPreview";
import { ContentEditor } from "@/components/content/ContentEditor";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { EmptyState } from "@/components/ui/EmptyState";

type Niche = "fitness" | "food" | "travel" | "business" | "lifestyle";
type ContentType = "post" | "story" | "reel" | "carousel";

interface ContentPacket {
  id: string;
  caption: string;
  hashtags?: string[];
  visual_url?: string | null;
  niche: string;
  type: string;
  status: string;
  scheduled_at: string;
  target_accounts: string[];
}

export default function ContentPlannerPage() {
  const niches: Niche[] = ["fitness", "food", "travel", "business", "lifestyle"];
  const types: ContentType[] = ["post", "story", "reel", "carousel"];

  const [niche, setNiche] = useState<Niche>("fitness");
  const [type, setType] = useState<ContentType>("post");
  const [accounts, setAccounts] = useState<string>("bot_1, bot_2");
  const [scheduledAt, setScheduledAt] = useState<string>("");

  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [queueSize, setQueueSize] = useState<number | string>("?");
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [feed, setFeed] = useState<ContentPacket[]>([]);

  // Selection state for preview / editor
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"preview" | "edit">("preview");

  const selectedItem = feed.find((item) => item.id === selectedId) || null;

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStatus = async () => {
    setRefreshing(true);
    try {
      const health = await api.content.getHealth();
      setIsOnline(health.status && health.status !== "offline");
      
      const queue = await api.content.getQueueSize();
      setQueueSize(queue.size !== undefined ? queue.size : "?");
    } catch {
      setIsOnline(false);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleGenerate = async () => {
    if (!isOnline) {
      showToast("L'API Content Factory est hors ligne.", "error");
      return;
    }

    const tAccounts = accounts.split(",").map(a => a.trim()).filter(a => a);
    if (tAccounts.length === 0) {
      showToast("Veuillez saisir au moins un compte cible.", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await api.content.generateContent({
        niche,
        type,
        target_accounts: tAccounts,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined
      });
      
      setFeed(prev => [res, ...prev]);
      setSelectedId(res.id);
      setPanelMode("preview");
      showToast("Contenu généré et mis en file d'attente !", "success");
      fetchStatus();
    } catch (err: any) {
      console.error(err);
      showToast("Erreur lors de la génération.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleBulk = async () => {
    if (!isOnline) {
      showToast("L'API Content Factory est hors ligne.", "error");
      return;
    }

    const tAccounts = accounts.split(",").map(a => a.trim()).filter(a => a);
    if (tAccounts.length === 0) {
      showToast("Veuillez saisir au moins un compte cible.", "error");
      return;
    }

    setBulkLoading(true);
    try {
      const bulkNiches = ["fitness", "food", "lifestyle"];
      for (const n of bulkNiches) {
        const res = await api.content.generateContent({
          niche: n,
          type,
          target_accounts: tAccounts,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined
        });
        setFeed(prev => [res, ...prev]);
      }
      showToast("Bulk Generation de 3 contenus réussie !", "success");
      fetchStatus();
    } catch (err: any) {
      console.error(err);
      showToast("Erreur lors du traitement Bulk.", "error");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSaveEdits = async (id: string, caption: string, hashtags: string[]) => {
    try {
      const updated = await api.content.patchContentPacket(id, { caption, hashtags });
      setFeed(prev => prev.map(item => item.id === id ? { ...item, caption: updated.caption, hashtags: updated.hashtags } : item));
      setPanelMode("preview");
      showToast("Contenu mis à jour !", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Erreur lors de la sauvegarde.", "error");
    }
  };

  return (
    <div className="flex-1 w-full p-8 min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={clsx(
          "fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all duration-300 animate-in slide-in-from-top-4",
          toast.type === "success" ? "bg-green-100 text-green-800 border border-green-200" : "bg-red-100 text-red-800 border border-red-200"
        )}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            Content Planner
          </h2>
          <p className="page-subtitle">
            Autonomous generation, high-fidelity distribution, and real-time queue orchestration.
          </p>
        </div>
        <div className="flex items-center gap-6 bg-white dark:bg-zinc-900 px-6 py-3 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              {isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={cn("relative inline-flex rounded-full h-3 w-3", isOnline ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500")} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-50">{isOnline ? "Grid Online" : "Grid Offline"}</span>
          </div>
          <div className="w-px h-6 bg-zinc-100 dark:bg-zinc-800" />
          <div className="flex items-center gap-3">
            <RefreshCw className={cn("w-4 h-4 text-zinc-900 dark:text-zinc-50 cursor-pointer hover:opacity-80 transition-all", refreshing && "animate-spin")} onClick={fetchStatus} />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-50">Latency Opt. · Queue: {queueSize}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN - Form */}
        <div className="lg:col-span-4 space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-premium shadow-sm border border-zinc-200 dark:border-zinc-800">
          
          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Niche Selection</label>
            <div className="flex flex-wrap gap-2">
              {niches.map((n) => (
                <button
                  key={n}
                  onClick={() => setNiche(n)}
                  className={cn(
                    "px-4 py-2 rounded-[var(--radius-button)] text-[10px] font-black uppercase tracking-widest transition-all border",
                    niche === n 
                      ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white" 
                      : "bg-white border-[var(--color-border)] text-[#374151] hover:border-zinc-400 hover:text-zinc-900"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Content DNA</label>
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "px-4 py-2 rounded-[var(--radius-button)] text-[10px] font-black uppercase tracking-widest transition-all border",
                    type === t 
                      ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white" 
                      : "bg-white border-[var(--color-border)] text-[#374151] hover:border-zinc-400 hover:text-zinc-900"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Distribution Nodes</label>
            <textarea 
              value={accounts}
              onChange={(e) => setAccounts(e.target.value)}
              className="w-full h-24 p-4 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-zinc-900/5 placeholder:text-zinc-300 resize-none transition-all"
              placeholder="Ex: account_1, account_2..."
            />
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">Comma-separated distribution targets.</p>
          </div>

          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" /> Epoch Schedule (Optional)
            </label>
            <input 
              type="datetime-local" 
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full p-4 bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
            />
          </div>

          <div className="pt-6 space-y-3">
            <PrimaryButton 
              onClick={handleGenerate}
              disabled={!isOnline || loading || bulkLoading}
              className="w-full group flex items-center justify-center gap-3"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
              Orchestrate Generation
            </PrimaryButton>
            <PrimaryButton 
              variant="ghost"
              onClick={handleBulk}
              disabled={!isOnline || loading || bulkLoading}
              className="w-full flex items-center justify-center gap-3"
            >
              {bulkLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 text-indigo-500" />}
              Bulk Synthesis (x3 Niches)
            </PrimaryButton>
          </div>

        </div>

        <div className="lg:col-span-4 space-y-4">
          <h2 className="text-xl font-bold font-display flex items-center gap-2 pb-2 text-zinc-900 dark:text-zinc-50">
            <Sparkles className="w-5 h-5 text-indigo-500" /> Live Generation Feed
          </h2>

          <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
            {feed.length === 0 ? (
              <EmptyState 
                icon={RefreshCw}
                title="No telemetry signal"
                subtitle="Synthesis required."
              />
            ) : (
              feed.map((item, idx) => (
                <div 
                  key={`${item.id}-${idx}`} 
                  onClick={() => { setSelectedId(item.id); setPanelMode("preview"); }}
                  className={cn(
                    "bg-white dark:bg-zinc-900 p-6 rounded-premium shadow-sm border cursor-pointer transition-all animate-in fade-in slide-in-from-bottom-4 group",
                    selectedId === item.id
                      ? "border-indigo-400 dark:border-indigo-500 ring-4 ring-indigo-400/10"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                        {item.niche}
                      </span>
                      <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {item.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); setPanelMode("edit"); }}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-indigo-500 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); setPanelMode("preview"); }}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-emerald-500 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <p className="text-sm font-bold font-display leading-relaxed my-4 line-clamp-3 text-zinc-900 dark:text-zinc-50 tracking-tight">
                    {item.caption.length > 0 ? item.caption : "Synthetic packet awaiting latent diffusion..."}
                  </p>

                  {item.hashtags && item.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {item.hashtags.slice(0, 5).map(tag => (
                        <span key={tag} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                          <Hash className="w-3 h-3" /> {tag.replace('#', '')}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="w-full h-px bg-zinc-100 dark:bg-zinc-800 my-4" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(item.scheduled_at).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg">
                      {item.target_accounts.length} Clusters
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - Preview / Editor */}
        <div className="lg:col-span-4 space-y-4">
          {selectedItem ? (
            <>
              <h2 className="text-xl font-bold flex items-center gap-2 pb-2">
                {panelMode === "preview" ? (
                  <><Eye className="w-5 h-5" /> Aperçu Instagram</>
                ) : (
                  <><Pencil className="w-5 h-5" /> Modifier le contenu</>
                )}
              </h2>

              {panelMode === "preview" ? (
                <InstagramPreview
                  username={selectedItem.target_accounts[0] || "account"}
                  caption={selectedItem.caption}
                  hashtags={selectedItem.hashtags || []}
                  visualUrl={selectedItem.visual_url}
                  niche={selectedItem.niche}
                  type={selectedItem.type}
                />
              ) : (
                <ContentEditor
                  contentId={selectedItem.id}
                  initialCaption={selectedItem.caption}
                  initialHashtags={selectedItem.hashtags || []}
                  onSave={handleSaveEdits}
                  onClose={() => setPanelMode("preview")}
                />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl text-neutral-400">
              <Eye className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">Sélectionnez un contenu pour voir l&apos;aperçu</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
