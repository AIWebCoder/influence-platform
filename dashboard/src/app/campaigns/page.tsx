'use client';

import React from 'react';
import { Activity } from 'lucide-react';

export default function CampaignsPage() {
  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div>
        <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
          <Activity className="w-10 h-10 text-indigo-500" />
          Campaigns
        </h2>
        <p className="page-subtitle">Coming soon for V1. This area is intentionally disabled at launch.</p>
      </div>
      <div className="rounded-premium border border-dashed border-zinc-300 bg-zinc-50 p-8 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        Campaign orchestration is deferred after V1 production stabilization.
      </div>
    </div>
  );
}
