import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

// The Distribution Engine API (Node.js) on port 3001 by default
const distributionClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_DISTRIBUTION_API_URL || 'http://localhost:3001',
  timeout: 5000,
});

// The Content Factory API (Python) on port 8000
const contentClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_CONTENT_API_URL || 'http://localhost:8000',
  timeout: 5000,
});

const contentClientLongTimeout = axios.create({
  baseURL: process.env.NEXT_PUBLIC_CONTENT_API_URL || 'http://localhost:8000',
  timeout: 300000,
});

/** Same JWT_SECRET as distribution-engine + Content Factory — attach session token for Bearer APIs */
async function attachBearerAuth(config: InternalAxiosRequestConfig) {
  if (typeof window === 'undefined') return config;
  const { getSession } = await import('next-auth/react');
  const session = await getSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const traceId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  config.headers = config.headers ?? {};
  (config.headers as Record<string, string>)["x-trace-id"] = String(traceId);
  if (token) {
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
}

distributionClient.interceptors.request.use(attachBearerAuth);
contentClient.interceptors.request.use(attachBearerAuth);
contentClientLongTimeout.interceptors.request.use(attachBearerAuth);

let authRecoveryInProgress = false;

async function handleUnauthorizedError(error: any) {
  if (typeof window === 'undefined') {
    return Promise.reject(error);
  }

  const status = error?.response?.status;
  if (status !== 401) {
    return Promise.reject(error);
  }

  // Prevent multiple concurrent redirects when several requests fail together.
  if (!authRecoveryInProgress) {
    authRecoveryInProgress = true;
    try {
      const { signOut } = await import('next-auth/react');
      await signOut({ callbackUrl: '/login' });
    } catch (_e) {
      window.location.href = '/login';
    } finally {
      authRecoveryInProgress = false;
    }
  }

  return Promise.reject(error);
}

distributionClient.interceptors.response.use((response) => response, handleUnauthorizedError);
contentClient.interceptors.response.use((response) => response, handleUnauthorizedError);
contentClientLongTimeout.interceptors.response.use((response) => response, handleUnauthorizedError);

export const api = {
  distribution: {
    getAccounts: async () => {
      const response = await distributionClient.get('/accounts');
      return response.data;
    },
    getAccountById: async (id: string) => {
      const response = await distributionClient.get(`/accounts/${id}`);
      return response.data;
    },
    getAccountSafety: async (id: string) => {
      const response = await distributionClient.get(`/accounts/${id}/safety`);
      return response.data;
    },
    addAccount: async (payload: { username: string; password_encrypted: string; status: string; metadata?: any }) => {
      const response = await distributionClient.post('/accounts', payload);
      return response.data;
    },
    getPublications: async (status?: string, limit = 100, offset = 0) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const response = await distributionClient.get(`/publications?${params.toString()}`);
      return response.data;
    },
    getPublicationStats: async () => {
      const response = await distributionClient.get('/publications/stats');
      return response.data;
    },
    getQueueStats: async () => {
      const response = await distributionClient.get('/queue/stats');
      return response.data;
    },
    getProxies: async () => {
      const response = await distributionClient.get('/proxies');
      return response.data;
    },
    getProxyStats: async () => {
      const response = await distributionClient.get('/proxies/stats');
      return response.data;
    },
    checkProxies: async () => {
      const response = await distributionClient.post('/proxies/check');
      return response.data;
    },
    getPostAnalytics: async () => {
      const response = await distributionClient.get('/analytics/posts');
      return response.data;
    },
    getAccountGrowth: async (id: string) => {
      const response = await distributionClient.get(`/analytics/accounts/${id}/growth`);
      return response.data;
    },
    getTopPerforming: async () => {
      const response = await distributionClient.get('/analytics/top-performing');
      return response.data;
    },
    getABTests: async () => {
      const response = await distributionClient.get('/ab-tests');
      return response.data;
    },
    getABTestPerformance: async (id: string) => {
      const response = await distributionClient.get(`/ab-tests/${id}/performance`);
      return response.data;
    },
    evaluateABTest: async (id: string) => {
      const response = await distributionClient.post(`/ab-tests/${id}/evaluate`);
      return response.data;
    },
    getOptimalPostingTimes: async (params: { niche?: string; accountId?: string }) => {
      const response = await distributionClient.get('/analytics/optimization/posting-times', { params });
      return response.data;
    },
    getSuggestedFrequency: async (accountId: string) => {
      const response = await distributionClient.get('/analytics/optimization/frequency', { params: { accountId } });
      return response.data;
    },
    getCampaigns: async () => {
      const response = await distributionClient.get('/campaigns');
      return response.data;
    },
    createCampaign: async (payload: any) => {
      const response = await distributionClient.post('/campaigns', payload);
      return response.data;
    },
    updateCampaignStatus: async (id: string, status: string) => {
      const response = await distributionClient.patch(`/campaigns/${id}`, { status });
      return response.data;
    },
    getCampaignHistory: async (id: string) => {
      const response = await distributionClient.get(`/campaigns/${id}/history`);
      return response.data;
    },
  },
  content: {
    scoreCaption: async (caption: string, hashtags?: string[]) => {
      const response = await contentClient.post('/analytics/caption/score', { caption, hashtags });
      return response.data;
    },
    getTemplates: async () => {
      const response = await contentClient.get('/templates');
      return response.data;
    },
    generateContent: async (data: { niche: string, type?: string, target_accounts: string[], scheduled_at?: string }) => {
      const payload = {
        niche: data.niche,
        type: data.type || "post",
        target_accounts: data.target_accounts,
        ...(data.scheduled_at && { scheduled_at: data.scheduled_at })
      };
      const response = await contentClient.post('/content/generate', payload);
      return response.data;
    },
    getHealth: async () => {
      const response = await contentClient.get('/health');
      return response.data;
    },
    getQueueSize: async () => {
      const response = await contentClient.get('/content/queue/size');
      return response.data;
    },
    patchContentPacket: async (id: string, data: { caption?: string; hashtags?: string[] }) => {
      const response = await contentClient.patch(`/content/${id}`, data);
      return response.data;
    }
  },
  generationJobs: {
    create: async (data: {
      execution_mode?: "scene_based" | "multi_scene_single_video";
      content_type: string;
      mode: string;
      niche: string;
      topic: string;
      target_accounts: string[];
      scheduled_at?: string;
      template_id?: string;
      campaign_id?: string;
      scene_count?: number;
      video_duration?: number;
    }) => {
      const payload = {
        execution_mode: data.execution_mode ?? "multi_scene_single_video",
        ...data,
      };
      const response = await contentClientLongTimeout.post('/generation-jobs', payload);
      return response.data as { job_id: string };
    },
    launch: async (jobId: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/launch`);
      return response.data as { status: string; job_id: string };
    },
    cancel: async (jobId: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/cancel`);
      return response.data as { status: string; job_id: string };
    },
    markReady: async (jobId: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/ready`);
      return response.data as { status: string; job_id: string };
    },
    getCostEstimate: async (jobId: string) => {
      const response = await contentClient.get(`/generation-jobs/${jobId}/cost-estimate`);
      return response.data as {
        total_credits: number;
        currency: string;
        breakdown: Array<{ line: string; units: number; unit_credits: number; subtotal: number }>;
      };
    },
    get: async (jobId: string) => {
      const response = await contentClient.get(`/generation-jobs/${jobId}`);
      return response.data;
    },
    previewScenes: async (data: {
      content_type: string;
      mode: string;
      niche: string;
      topic: string;
      scene_count?: number;
    }) => {
      const response = await contentClientLongTimeout.post('/generation-jobs/preview-scenes', data);
      return response.data as Array<{
        scene_index: number;
        prompt: string;
        duration: number;
        role?: string;
      }>;
    },
    retryStep: async (jobId: string, step_name: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/retry-step`, { step_name });
      return response.data;
    },
    cancelStep: async (jobId: string, step: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/cancel-step`, { step });
      return response.data as { status: string; job_id: string; step: string };
    },
    retryScene: async (jobId: string, scene_id: string) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/retry-scene`, { scene_id });
      return response.data;
    },
    patchScene: async (
      jobId: string,
      sceneId: string,
      data: { prompt?: string; duration?: number; scene_role?: string; metadata?: Record<string, unknown> }
    ) => {
      const response = await contentClient.patch(`/generation-jobs/${jobId}/scenes/${sceneId}`, data);
      return response.data;
    },
    reorderScenes: async (jobId: string, sceneIds: string[]) => {
      const response = await contentClient.put(`/generation-jobs/${jobId}/scenes/reorder`, { scene_ids: sceneIds });
      return response.data;
    },
    previewScene: async (jobId: string, sceneId: string, kind: 'image' | 'video' = 'image') => {
      const response = await contentClientLongTimeout.post(
        `/generation-jobs/${jobId}/scenes/${sceneId}/preview`,
        { kind }
      );
      return response.data;
    },
  },
  alerts: {
    getAlerts: async (isRead?: boolean) => {
      const params = isRead !== undefined ? `?is_read=${isRead}` : '';
      const response = await contentClient.get(`/alerts${params}`);
      return response.data;
    },
    getUnreadCount: async () => {
      const response = await contentClient.get('/alerts/unread/count');
      return response.data;
    },
    markAsRead: async (alertId: string) => {
      const response = await contentClient.post(`/alerts/read/${alertId}`);
      return response.data;
    }
  }
};
