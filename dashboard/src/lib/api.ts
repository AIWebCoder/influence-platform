import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { humanizeGenerationMessage } from '@/lib/generation-errors';

/** Hostnames only resolvable inside Docker — the browser must never use these. */
function isDockerInternalApiUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === 'distribution-engine' ||
      h === 'content-factory' ||
      h === 'emulator-controller'
    );
  } catch {
    return false;
  }
}

/** Browser: public URL or same host as the dashboard. Server (SSR / route handlers): internal service URL. */
function resolveDistributionBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const fromEnv = (process.env.NEXT_PUBLIC_DISTRIBUTION_API_URL || '').trim();
    if (fromEnv && !isDockerInternalApiUrl(fromEnv)) return fromEnv;
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3001`;
  }
  const internal = (process.env.DISTRIBUTION_ENGINE_INTERNAL_URL || '').trim();
  if (internal) return internal;
  const pub = (process.env.NEXT_PUBLIC_DISTRIBUTION_API_URL || '').trim();
  if (pub && !isDockerInternalApiUrl(pub)) return pub;
  return 'http://distribution-engine:3001';
}

function resolveContentBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const fromEnv = (process.env.NEXT_PUBLIC_CONTENT_API_URL || '').trim();
    if (fromEnv && !isDockerInternalApiUrl(fromEnv)) return fromEnv;
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }
  const internal = (process.env.CONTENT_FACTORY_INTERNAL_URL || '').trim();
  if (internal) return internal;
  const pub = (process.env.NEXT_PUBLIC_CONTENT_API_URL || '').trim();
  if (pub && !isDockerInternalApiUrl(pub)) return pub;
  return 'http://content-factory:8000';
}

/** Client `fetch()` calls must use the same rules as axios (never Docker-only hostnames in the browser). */
export function getClientContentApiUrl(): string {
  if (typeof window === 'undefined') {
    return (process.env.NEXT_PUBLIC_CONTENT_API_URL || '').trim() || 'http://localhost:8000';
  }
  return resolveContentBaseUrl();
}

const distributionClient = axios.create({ timeout: 5000 });
distributionClient.interceptors.request.use((config) => {
  config.baseURL = resolveDistributionBaseUrl();
  return config;
});

const contentClient = axios.create({ timeout: 5000 });
contentClient.interceptors.request.use((config) => {
  config.baseURL = resolveContentBaseUrl();
  return config;
});

const contentClientLongTimeout = axios.create({ timeout: 300000 });
contentClientLongTimeout.interceptors.request.use((config) => {
  config.baseURL = resolveContentBaseUrl();
  return config;
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
  const data = error.response.data as {
    detail?: unknown;
    error?: string;
    details?: string;
    message?: string;
  } | undefined;
  if (data?.detail !== undefined) {
    if (typeof data.detail === "string") return humanizeGenerationMessage(data.detail);
    if (Array.isArray(data.detail)) {
      const msgs = data.detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) return String((item as { msg: string }).msg);
        return JSON.stringify(item);
      });
      if (msgs.length) return humanizeGenerationMessage(msgs.join(" "));
    }
  }
  if (typeof data?.error === "string") {
    const base = humanizeGenerationMessage(data.error);
    const hint =
      data && typeof data === "object" && "hint" in data && typeof (data as { hint?: string }).hint === "string"
        ? (data as { hint: string }).hint
        : "";
    return hint ? `${base} ${hint}` : base;
  }
  if (typeof data?.details === "string") return humanizeGenerationMessage(data.details);
  if (typeof data?.message === "string") return humanizeGenerationMessage(data.message);
  return fallback;
}

export type CampaignRecord = {
  id: string;
  name: string;
  type: string;
  status: string;
  target_niche?: string | null;
  target_account_id?: string | null;
  settings?: {
    topic?: string;
    account_ids?: string[];
    generation_job_ids?: string[];
    [key: string]: unknown;
  };
  created_at?: string;
  updated_at?: string;
};

export type CreateCampaignPayload = {
  name: string;
  type: 'content' | 'growth' | 'engagement';
  target_niche?: string;
  target_account_id?: string | null;
  settings?: Record<string, unknown>;
};

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
      ig_user_id?: string;
      ig_access_token?: string;
    }) => {
      const response = await distributionClient.post('/accounts', payload);
      return response.data;
    },
    updateAccountInstagram: async (
      id: string,
      payload: { ig_user_id?: string; ig_access_token?: string }
    ) => {
      const response = await distributionClient.patch(`/accounts/${id}/instagram`, payload);
      return response.data;
    },
    updateAccountStatus: async (id: string, status: string) => {
      const response = await distributionClient.patch(`/accounts/${id}`, { status });
      return response.data;
    },
    assignAccountProxy: async (id: string, proxyId?: string) => {
      const response = await distributionClient.post(`/accounts/${id}/proxy/assign`, {
        ...(proxyId ? { proxy_id: proxyId } : {}),
      });
      return response.data as {
        success: boolean;
        proxy_id: string;
        proxy_url: string;
        account: Record<string, unknown>;
      };
    },
    rotateAccountProxy: async (id: string) => {
      const response = await distributionClient.post(`/accounts/${id}/proxy/rotate`);
      return response.data;
    },
    deleteAccount: async (id: string) => {
      const response = await distributionClient.delete(`/accounts/${id}`);
      return response.data as { success: boolean; message?: string };
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
      return response.data as {
        total: number;
        active: number;
        unhealthy: number;
        avg_latency_ms: number;
        capacity?: {
          unassigned_active: number;
          accounts: number;
          slots_available: number;
          strict_one_to_one: boolean;
          can_add_accounts: boolean;
        };
      };
    },
    createProxy: async (payload: {
      host: string;
      port: number;
      username?: string;
      provider?: string;
      country?: string;
    }) => {
      const response = await distributionClient.post('/proxies', payload);
      return response.data;
    },
    updateProxy: async (
      id: string,
      payload: {
        host?: string;
        port?: number;
        provider?: string | null;
        country?: string | null;
        is_active?: boolean;
      },
    ) => {
      const response = await distributionClient.patch(`/proxies/${id}`, payload);
      return response.data;
    },
    deleteProxy: async (id: string) => {
      const response = await distributionClient.delete(`/proxies/${id}`);
      return response.data;
    },
    bulkImportAccounts: async (
      accounts: Array<{
        username: string;
        password_encrypted: string;
        status?: string;
        ig_user_id?: string;
        ig_access_token?: string;
      }>,
    ) => {
      const response = await distributionClient.post('/accounts/bulk', { accounts });
      return response.data as {
        created_count: number;
        failed_count: number;
        created: Array<{ id: string; username: string }>;
        failed: Array<{ index: number; username: string; error: string }>;
      };
    },
    getOpsSummary: async () => {
      const response = await distributionClient.get('/dashboard/ops-summary');
      return response.data;
    },
    checkProxies: async () => {
      const response = await distributionClient.post('/proxies/check');
      return response.data;
    },
    listPersonas: async (status?: string) => {
      const response = await distributionClient.get('/personas', {
        params: status ? { status } : undefined,
      });
      return response.data as { personas: import('@/types/persona').PersonaRow[] };
    },
    getPersona: async (id: string) => {
      const response = await distributionClient.get(`/personas/${id}`);
      return response.data as import('@/types/persona').PersonaRow;
    },
    createPersona: async (payload: {
      name: string;
      proxy_id?: string;
      timezone?: string;
      locale?: string;
    }) => {
      const response = await distributionClient.post('/personas', payload);
      return response.data;
    },
    assignPersonaProxy: async (personaId: string, proxyId: string) => {
      const response = await distributionClient.post(`/personas/${personaId}/proxy/assign`, {
        proxy_id: proxyId,
      });
      return response.data;
    },
    bindPersonaDevice: async (
      personaId: string,
      payload: { emulator_serial: string; adb_port?: number; appium_port?: number },
    ) => {
      const response = await distributionClient.post(`/personas/${personaId}/device/bind`, payload);
      return response.data;
    },
    verifyPersonaEgress: async (personaId: string) => {
      const response = await distributionClient.post(`/personas/${personaId}/verify-egress`);
      return response.data as { success: boolean; egress_ip: string };
    },
    deletePersona: async (personaId: string) => {
      const response = await distributionClient.delete(`/personas/${personaId}`);
      return response.data as { deleted: boolean; id: string };
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
      return response.data as CampaignRecord[];
    },
    createCampaign: async (payload: CreateCampaignPayload) => {
      const response = await distributionClient.post('/campaigns', payload);
      return response.data as CampaignRecord;
    },
    updateCampaignStatus: async (id: string, status: string) => {
      const response = await distributionClient.patch(`/campaigns/${id}`, { status });
      return response.data as CampaignRecord;
    },
    patchCampaignSettings: async (id: string, settings: Record<string, unknown>) => {
      const response = await distributionClient.patch(`/campaigns/${id}`, { settings });
      return response.data as CampaignRecord;
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
    getNiches: async () => {
      const response = await contentClient.get('/niches');
      const data = response.data;
      if (Array.isArray(data)) {
        return data as Array<{
          id: string;
          name: string;
          description?: string | null;
          hashtags: string[];
          posting_times: number[];
        }>;
      }
      return [];
    },
    getTemplates: async (params?: { niche_id?: string; active_only?: boolean }) => {
      const response = await contentClient.get('/templates', { params });
      const data = response.data;
      if (Array.isArray(data)) {
        return data as Array<{
          id: string;
          name: string;
          caption_template: string;
          visual_prompt?: string | null;
          hashtag_groups: string[];
          is_active: boolean;
          niche_id?: string | null;
        }>;
      }
      if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
        return (data as { items: Array<{
          id: string;
          name: string;
          caption_template: string;
          visual_prompt?: string | null;
          hashtag_groups: string[];
          is_active: boolean;
          niche_id?: string | null;
        }> }).items;
      }
      return [];
    },
    createTemplate: async (data: {
      name: string;
      caption_template: string;
      visual_prompt?: string;
      hashtag_groups?: string[];
      is_active?: boolean;
      niche_id?: string;
    }) => {
      const response = await contentClient.post('/templates', data);
      return response.data;
    },
    updateTemplate: async (
      id: string,
      data: Partial<{
        name: string;
        caption_template: string;
        visual_prompt: string;
        hashtag_groups: string[];
        is_active: boolean;
      }>,
    ) => {
      const response = await contentClient.put(`/templates/${id}`, data);
      return response.data;
    },
    deleteTemplate: async (id: string) => {
      await contentClient.delete(`/templates/${id}`);
    },
    getEditorialCalendar: async (params: { start_date: string; end_date: string; niche?: string }) => {
      const response = await contentClient.get('/scheduling/calendar', { params });
      return response.data as Array<{
        id: string;
        generation_job_id?: string | null;
        caption?: string | null;
        visual_url?: string | null;
        scheduled_at?: string | null;
        niche?: string | null;
        status: string;
        mode?: string;
        content_type?: string;
        target_count?: number;
      }>;
    },
    patchPublishIntentSchedule: async (intentId: string, scheduled_at: string) => {
      const response = await contentClient.patch(
        `/scheduling/publish-intents/${intentId}/schedule`,
        { scheduled_at },
      );
      return response.data as {
        id: string;
        generation_job_id?: string | null;
        caption?: string | null;
        scheduled_at?: string | null;
        status: string;
        mode?: string;
      };
    },
    getReadyQueue: async (params?: { status?: string; limit?: number }) => {
      const response = await contentClient.get('/ready-queue', { params });
      return response.data as Array<{
        intent_id: string;
        generation_job_id: string;
        status: string;
        content_type?: string | null;
        caption?: string | null;
        public_url?: string | null;
        target_count: number;
        created_at?: string | null;
      }>;
    },
    listEngagementPosts: async (params: { account_id: string; limit?: number; include_graph?: boolean }) => {
      const response = await distributionClient.get('/engagement/posts', { params });
      return response.data as {
        posts: Array<{
          media_id: string;
          caption?: string | null;
          permalink?: string | null;
          published_at?: string | null;
          source: string;
          account_id: string;
          comments_count?: number | null;
          original_media_id?: string;
          media_id_resolved?: boolean;
        }>;
        count: number;
        graph_error?: string | null;
      };
    },
    listPostComments: async (
      mediaId: string,
      params: { account_id: string; limit?: number; caption_hint?: string },
    ) => {
      const response = await distributionClient.get(`/engagement/posts/${encodeURIComponent(mediaId)}/comments`, {
        params,
      });
      return response.data as {
        media_id: string;
        original_media_id?: string;
        media_id_resolved?: boolean;
        account_id: string;
        comments: Array<{
          id: string;
          text: string;
          username?: string | null;
          from_id?: string | null;
          timestamp?: string | null;
          like_count?: number;
          media_id: string;
        }>;
        count: number;
        dry_run?: boolean;
        hint?: string | null;
        graph_error?: string | null;
        comments_count_reported?: number | null;
      };
    },
    listEngagementIntents: async (params?: { status?: string; action_type?: string; limit?: number }) => {
      const response = await distributionClient.get('/engagement/intents', { params });
      return response.data as Array<{
        intent_id: string;
        status: string;
        action_type: string;
        account_id: string;
        target_id: string;
        message_text?: string | null;
        error_message?: string | null;
        external_result_id?: string | null;
        created_at?: string | null;
      }>;
    },
    createEngagementIntent: async (body: {
      account_id: string;
      action_type: string;
      target_id: string;
      target_type?: string;
      target_username?: string;
      parent_target_id?: string;
      message_text?: string;
      platform?: string;
      mode?: string;
      scheduled_for?: string;
      idempotency_key: string;
    }) => {
      const response = await distributionClient.post('/engagement/intents', body);
      return response.data as {
        intent_id: string;
        status: string;
        action_type: string;
        account_id: string;
        target_id: string;
      };
    },
    dispatchEngagementIntent: async (intentId: string) => {
      const response = await distributionClient.post(`/engagement/intents/${intentId}/dispatch`);
      return response.data as { intent_id: string; status: string; action_type?: string; note?: string };
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
    /** Create publish intent from a completed job and dispatch to Instagram (queue / ops shortcut). */
    dispatchCompletedJob: async (
      jobId: string,
      targetAccountIds: string[],
      overrides?: { caption?: string; hashtags?: string[] }
    ) => {
      const job = (await contentClient.get(`/generation-jobs/${jobId}`)).data as {
        status?: string;
        input_payload?: {
          caption?: string;
          hashtags?: string[];
          content_type?: string;
        };
      };
      if (job.status !== "completed") {
        throw new Error("Job must be completed before dispatch");
      }
      const assets = (await contentClient.get(`/generation-jobs/${jobId}/assets`)).data as Array<{
        id: string;
        asset_type: string;
        public_url?: string;
      }>;
      const video = assets.find(
        (a) => a.asset_type === "video" && (a.public_url || "").trim().startsWith("https://"),
      );
      if (!video) {
        throw new Error("No public HTTPS video asset on this job");
      }
      const payload = job.input_payload || {};
      const targetIds = targetAccountIds.filter(Boolean);
      if (targetIds.length === 0) {
        throw new Error("Select at least one account to publish");
      }
      const contentType =
        payload.content_type === "reel" || payload.content_type === "story" || payload.content_type === "post"
          ? payload.content_type
          : "reel";
      const hashtags = (overrides?.hashtags ?? payload.hashtags ?? [])
        .map((h) => String(h).replace(/^#/, "").trim())
        .filter(Boolean);
      const caption = (typeof overrides?.caption === "string" ? overrides.caption : payload.caption || "").trim();
      const accountKey = [...targetIds].sort().join(",");
      const intent = (
        await contentClient.post(`/generation-jobs/${jobId}/publish-intents`, {
          asset_id: video.id,
          content_type: contentType,
          caption,
          hashtags,
          mode: "publish_now",
          target_account_ids: targetIds,
          idempotency_key: `queue-dispatch-${jobId}-${video.id}-${accountKey}`,
        })
      ).data as { intent_id: string };
      return contentClient.post(`/publication-intents/${intent.intent_id}/dispatch`).then((r) => r.data);
    },
    create: async (data: {
      execution_mode?: "scene_based" | "multi_scene_single_video" | "ailiveai_single_video";
      content_type: string;
      mode: string;
      niche: string;
      topic: string;
      target_accounts?: string[];
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
    list: async (params?: { status?: string; limit?: number; skip?: number; readyToPublish?: boolean }) => {
      const response = await contentClient.get('/generation-jobs', {
        params: {
          limit: params?.limit,
          skip: params?.skip,
          status: params?.status,
          ready_to_publish: params?.readyToPublish ? true : undefined,
        },
      });
      return response.data as Array<{
        id: string;
        status: string;
        progress: number;
        execution_mode?: string;
        caption?: string | null;
        topic?: string | null;
        content_type?: string | null;
        niche?: string | null;
        target_account_count: number;
        target_account_ids?: string[];
        target_account_usernames?: string[];
        output_url?: string | null;
        preview_url?: string | null;
        publish_intent_id?: string | null;
        publish_intent_status?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      }>;
    },
    listReadyQueue: async (params?: { limit?: number; skip?: number; accountId?: string }) => {
      const response = await contentClient.get('/generation-jobs', {
        params: {
          ready_to_publish: true,
          limit: params?.limit ?? 20,
          skip: params?.skip ?? 0,
          account_id: params?.accountId || undefined,
        },
      });
      return response.data as {
        items: Array<{
          id: string;
          status: string;
          progress: number;
          caption?: string | null;
          topic?: string | null;
          content_type?: string | null;
          niche?: string | null;
          target_account_count: number;
          target_account_ids?: string[];
          target_account_usernames?: string[];
          output_url?: string | null;
          preview_url?: string | null;
          publish_intent_id?: string | null;
          publish_intent_status?: string | null;
          queue_display_title?: string | null;
          updated_at?: string | null;
        }>;
        total: number;
        skip: number;
        limit: number;
        account_filters: Array<{ id: string; username: string; count: number }>;
      };
    },
    delete: async (jobId: string) => {
      const response = await contentClient.delete(`/generation-jobs/${jobId}`);
      return response.data as { deleted: boolean; job_id: string };
    },
    setTargetAccounts: async (jobId: string, targetAccountIds: string[]) => {
      const response = await contentClient.patch(`/generation-jobs/${jobId}/target-accounts`, {
        target_account_ids: targetAccountIds,
      });
      return response.data as {
        id: string;
        target_account_ids?: string[];
        target_account_usernames?: string[];
      };
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
    /** Dev/demo: completed job on /queue without Kie tokens (requires GENERATION_ALLOW_QUEUE_SIMULATION). */
    simulateQueueEntry: async (data: {
      job_id?: string;
      execution_mode?: 'scene_based' | 'multi_scene_single_video' | 'ailiveai_single_video';
      content_type?: string;
      mode?: string;
      niche?: string;
      topic?: string;
      target_accounts?: string[];
    }) => {
      const response = await contentClient.post('/generation-jobs/simulate-queue', data);
      return response.data as { job_id: string; status: string; simulated: boolean };
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
    },
    markAllAsRead: async () => {
      const response = await contentClient.post('/alerts/read-all');
      return response.data as { status: string; marked_count: number };
    },
  },
  users: {
    me: async () => {
      const response = await contentClient.get('/users/me');
      return response.data as UserRecord;
    },
    changeMyPassword: async (payload: { current_password: string; new_password: string }) => {
      const response = await contentClient.post('/users/me/password', payload);
      return response.data as { message: string };
    },
    list: async () => {
      // Trailing slash avoids Starlette 307 → wrong public URL behind /api/content nginx strip.
      const response = await contentClient.get('/users/');
      return response.data as UserRecord[];
    },
    create: async (payload: { email: string; password: string; role?: AppUserRole }) => {
      const response = await contentClient.post('/users/', payload);
      return response.data as UserRecord;
    },
    update: async (
      id: string,
      payload: { role?: AppUserRole; is_active?: boolean; password?: string }
    ) => {
      const response = await contentClient.patch(`/users/${id}`, payload);
      return response.data as UserRecord;
    },
    remove: async (id: string) => {
      const response = await contentClient.delete(`/users/${id}`);
      return response.data as { message: string };
    },
  },
};

export type AppUserRole = "admin" | "operator" | "viewer";

export interface UserRecord {
  id: string;
  email: string;
  role: AppUserRole;
  is_active: boolean;
  created_at: string;
}
