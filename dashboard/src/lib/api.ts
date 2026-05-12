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

/**
 * Maps axios / FastAPI errors to a single string for toasts (timeouts, network, detail, validation arrays).
 */
export function formatContentApiError(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;
  if (error.code === "ECONNABORTED" || error.message?.toLowerCase().includes("timeout")) {
    return "Request timed out. The Content API may be slow or unreachable — try again.";
  }
  if (!error.response) {
    return "Cannot reach Content API. Check NEXT_PUBLIC_CONTENT_API_URL (from the browser it must resolve, e.g. http://localhost:8000).";
  }
  const data = error.response.data as { detail?: unknown; error?: string } | undefined;
  if (data?.detail !== undefined) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      const msgs = data.detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) return String((item as { msg: string }).msg);
        return JSON.stringify(item);
      });
      if (msgs.length) return msgs.join(" ");
    }
  }
  if (typeof data?.error === "string") return data.error;
  return fallback;
}

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
    addAccount: async (payload: {
      username: string;
      password_encrypted: string;
      status: string;
      platform?: string;
      metadata?: Record<string, unknown>;
    }) => {
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
    getPublicationDiagnostics: async (publicationId: string) => {
      const response = await distributionClient.get(`/publications/${publicationId}/diagnostics`);
      return response.data as {
        id: string;
        status: string;
        error_message: string | null;
        failure_type: string | null;
        retry_count: number;
        max_retries: number;
        attempt: number;
        last_retry_at: string | null;
        next_retry_at: string | null;
        created_at: string;
        updated_at: string;
        published_at: string | null;
        post_url: string | null;
        account_id: string;
        account_username: string;
        content_id: string | null;
        content_type: string | null;
        content_niche: string | null;
        content_caption: string | null;
      };
    },
    retryPublication: async (publicationId: string) => {
      const response = await distributionClient.post(`/publications/${publicationId}/retry`);
      return response.data as {
        publication_id: string;
        status: string;
        next_retry_at: string;
      };
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
    generateCaption: async (data: {
      niche: string;
      topic?: string;
      content_type?: string;
      variant_style?: string;
    }) => {
      // LLM calls routinely exceed the default 5s contentClient timeout
      const response = await contentClientLongTimeout.post('/content/caption/generate', data);
      return response.data as { caption: string; hashtags: string[] };
    },
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
    getJobAssets: async (jobId: string) => {
      const response = await contentClient.get(`/generation-jobs/${jobId}/assets`);
      return response.data as Array<{
        id: string;
        generation_job_id: string;
        asset_type: "image" | "video" | "thumbnail";
        storage_provider: string;
        object_key: string;
        public_url: string;
        mime_type: string;
        size_bytes: number;
        duration_seconds?: number | null;
        width?: number | null;
        height?: number | null;
        checksum_sha256: string;
        status: "ready";
        created_at?: string | null;
        updated_at?: string | null;
      }>;
    },
    createPublishIntent: async (
      jobId: string,
      payload: {
        asset_id: string;
        content_type: "post" | "reel" | "story";
        caption: string;
        hashtags: string[];
        mode: "publish_now" | "save_for_later" | "scheduled";
        scheduled_for?: string;
        target_account_ids: string[];
        idempotency_key: string;
      }
    ) => {
      const response = await contentClient.post(`/generation-jobs/${jobId}/publish-intents`, payload);
      return response.data as {
        intent_id: string;
        status: string;
        targets: Array<{ account_id: string; platform: string; status: string }>;
      };
    },
    dispatchPublishIntent: async (intentId: string) => {
      const response = await contentClient.post(`/publication-intents/${intentId}/dispatch`);
      return response.data as {
        intent_id: string;
        status: string;
        dispatched_targets: number;
      };
    },
    create: async (data: {
      execution_mode?: "scene_based" | "multi_scene_single_video" | "ailiveai_single_video";
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
      ailiveai_media_id?: string;
      ailiveai_gender?: string;
      ailiveai_video_model?: string;
      ailiveai_scene?: string;
      ailiveai_server_id?: string;
      ailiveai_last_frame_media_id?: string;
      ailiveai_video_quality?: string;
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
      execution_mode?: 'scene_based' | 'multi_scene_single_video' | 'ailiveai_single_video';
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
