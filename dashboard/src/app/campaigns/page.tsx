'use client';

import React, { useState, useEffect } from 'react';
import { 
  Rocket, 
  History, 
  TrendingUp, 
  Users, 
  Layers, 
  Plus, 
  Play, 
  Pause, 
  CheckCircle,
  Clock,
  ChevronRight,
  Target,
  BarChart3,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import {
  UnifiedModal,
  ModalInput,
  ModalSelect,
  ModalLabel,
  ModalFooter,
  ModalPrimaryButton,
  ModalCancelButton,
} from "@/components/ui/UnifiedModal";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  
  // Create Form State
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    type: 'growth',
    target_niche: '',
    target_account_id: '',
    er_threshold: 2.0
  });

  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    loadCampaigns();
    loadAccounts();
  }, []);

  const loadCampaigns = async () => {
    try {
      const data = await api.distribution.getCampaigns();
      setCampaigns(data);
    } catch (error) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const data = await api.distribution.getAccounts();
      setAccounts(data);
    } catch (error) {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: newCampaign.name,
        type: newCampaign.type,
        target_niche: newCampaign.target_niche || null,
        target_account_id: newCampaign.target_account_id || null,
        settings: { er_threshold: newCampaign.er_threshold }
      };
      await api.distribution.createCampaign(payload);
      toast.success('Campaign launched successfully');
      setShowCreate(false);
      loadCampaigns();
    } catch (error) {
      toast.error('Failed to launch campaign');
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'paused' : 'active';
      await api.distribution.updateCampaignStatus(id, newStatus);
      toast.success(`Campaign ${newStatus}`);
      loadCampaigns();
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  return (
    <div className="flex-1 space-y-10 p-8 pt-6 animate-in fade-in duration-700 bg-background/50">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="w-4 h-4 text-indigo-500" />
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-[0.2em]">Autonomous Engine</span>
          </div>
          <h1 className="page-title text-zinc-900 dark:text-zinc-50 font-display">Campaigns</h1>
          <p className="page-subtitle">Orchestrate autonomous growth and content strategies via AI.</p>
        </div>

        <PrimaryButton 
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 group"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
          Launch Campaign
        </PrimaryButton>
      </div>

      <UnifiedModal
        open={showCreate}
        onOpenChange={setShowCreate}
        title="New Strategy"
        description="Configure your autonomous growth parameters."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-5">
          <div className="space-y-1.5">
            <ModalLabel>Campaign Name *</ModalLabel>
            <ModalInput
              required
              type="text"
              placeholder="e.g. Q1 Fitness Growth Blitz"
              value={newCampaign.name}
              onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <ModalLabel>Strategy Type</ModalLabel>
              <ModalSelect
                value={newCampaign.type}
                onChange={(e) => setNewCampaign({ ...newCampaign, type: e.target.value })}
              >
                <option value="growth">Growth (Followers)</option>
                <option value="engagement">Engagement (ROI)</option>
                <option value="content">Content (Reach)</option>
              </ModalSelect>
            </div>
            <div className="space-y-1.5">
              <ModalLabel>Target Account</ModalLabel>
              <ModalSelect
                value={newCampaign.target_account_id}
                onChange={(e) => setNewCampaign({...newCampaign, target_account_id: e.target.value, target_niche: ''})}
              >
                <option value="">Niche Campaign (All)</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.username}</option>
                ))}
              </ModalSelect>
            </div>
          </div>

          {!newCampaign.target_account_id && (
            <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
              <ModalLabel>Target Niche</ModalLabel>
              <ModalInput
                value={newCampaign.target_niche}
                onChange={(e) => setNewCampaign({ ...newCampaign, target_niche: e.target.value })}
                placeholder="e.g. Fitness, Tech, Lifestyle"
              />
            </div>
          )}

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex gap-3">
            <div className="p-1.5 bg-blue-100 rounded-md shrink-0">
              <AlertCircle className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs text-blue-700 leading-relaxed font-medium">
              This campaign will autonomously adjust account parameters (frequency, captions, times) based on real-time engagement telemetry.
            </p>
          </div>

          <ModalFooter>
            <ModalCancelButton
              type="button"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </ModalCancelButton>
            <ModalPrimaryButton type="submit">
              Confirm & Launch
            </ModalPrimaryButton>
          </ModalFooter>
        </form>
      </UnifiedModal>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1,2,3].map(i => (
            <div key={i} className="h-96 rounded-premium bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-premium p-8 hover:border-indigo-500/30 transition-all relative overflow-hidden shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 hover:-translate-y-1">
               <div className={`absolute top-0 right-0 m-6 w-3 h-3 rounded-full ${campaign.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'} ring-4 ring-zinc-50 dark:ring-zinc-800 ${campaign.status === 'active' && 'animate-pulse'}`} />
               
               <div className="flex items-center gap-5 mb-8">
                 <div className="w-14 h-14 flex items-center justify-center bg-indigo-500/10 rounded-2xl rotate-3 group-hover:rotate-0 transition-transform">
                    {campaign.type === 'growth' ? <Users className="w-6 h-6 text-indigo-500" /> : 
                     campaign.type === 'content' ? <Layers className="w-6 h-6 text-blue-500" /> :
                     <TrendingUp className="w-6 h-6 text-purple-500" />}
                 </div>
                 <div>
                    <h3 className="text-lg font-black text-zinc-900 dark:text-zinc-50 transition-colors uppercase tracking-tight">{campaign.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-black tracking-widest uppercase">{campaign.type} ENGINE</span>
                    </div>
                 </div>
               </div>

               <div className="space-y-4 mb-8">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/50">
                    <div className="flex items-center gap-2">
                       <Target className="w-4 h-4 text-zinc-400" />
                       <span className="text-xs font-bold text-zinc-500">Targeting</span>
                    </div>
                    <span className="text-xs font-black text-zinc-900 dark:text-zinc-50">{campaign.target_niche || 'Account-Wide'}</span>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/50">
                    <div className="flex items-center gap-2">
                       <Calendar className="w-4 h-4 text-zinc-400" />
                       <span className="text-xs font-bold text-zinc-500">Started</span>
                    </div>
                    <span className="text-xs font-black text-zinc-900 dark:text-zinc-50">{format(new Date(campaign.created_at), 'MMM d, yyyy')}</span>
                  </div>
               </div>

               <div className="flex items-center gap-4 pt-6 border-t border-zinc-100 dark:border-zinc-800/50">
                 <button 
                    onClick={() => toggleStatus(campaign.id, campaign.status)}
                    className={cn(
                      "flex-1 h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-all",
                      campaign.status === 'active' 
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-red-500/10 hover:text-red-500" 
                        : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20"
                    )}
                 >
                   {campaign.status === 'active' ? (
                     <><Pause className="w-4 h-4" /> Pause</>
                   ) : (
                     <><Play className="w-4 h-4" /> Resume</>
                   )}
                 </button>
                 
                 <button className="w-12 h-12 flex items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800 text-zinc-400 hover:text-indigo-500 transition-all border border-zinc-100 dark:border-zinc-800/50">
                   <ChevronRight className="w-5 h-5" />
                 </button>
               </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 bg-zinc-50/50 dark:bg-zinc-900/20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-premium space-y-6 animate-in zoom-in-95 duration-1000">
          <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-premium flex items-center justify-center shadow-inner">
            <Rocket className="w-10 h-10 text-zinc-300 dark:text-zinc-700" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-black text-zinc-900 dark:text-zinc-50">Zero Autonomous Flows</h3>
            <p className="text-muted-foreground font-medium max-w-xs mx-auto">Launch your first AI strategy to start scaling your presence automatically.</p>
          </div>
          <PrimaryButton 
             onClick={() => setShowCreate(true)}
          >
            Launch Engine
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
