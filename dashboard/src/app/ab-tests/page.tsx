'use client';

import React from 'react';
import { Split } from 'lucide-react';

export default function ABTestingPage() {
  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div>
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            <Split className="w-10 h-10 text-indigo-500" />
            AB Tests
          </h2>
          <p className="page-subtitle">Coming soon for V1. Experimentation is disabled during launch hardening.</p>
        </div>
      </div>
      <div className="rounded-premium border border-dashed border-zinc-300 bg-zinc-50 p-8 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        A/B testing is deferred after V1 production stabilization.
      </div>
    </div>
  );
}
