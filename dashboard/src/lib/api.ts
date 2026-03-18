import axios from 'axios';

// The Distribution Engine API (Node.js) usually on port 3000
const distributionClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_DISTRIBUTION_API_URL || 'http://localhost:3001',
  timeout: 5000,
});

// The Content Factory API (Python) usually on port 8000
const contentClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_CONTENT_API_URL || 'http://localhost:8000',
  timeout: 5000,
});

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
      // Hardcode port 3001 fallback just in case env is 3000 but the engine runs on 3001
      const response = await axios.post((process.env.NEXT_PUBLIC_DISTRIBUTION_API_URL || 'http://localhost:3001') + '/accounts', payload);
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
      // Mocking endpoint for now, waiting for Track A
      const response = await contentClient.get('/templates').catch(() => ({ data: [] }));
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
      const response = await contentClient.get('/health').catch(() => ({ data: { status: 'offline' } }));
      return response.data;
    },
    getQueueSize: async () => {
      const response = await contentClient.get('/content/queue/size').catch(() => ({ data: { size: '?' } }));
      return response.data;
    },
    patchContentPacket: async (id: string, data: { caption?: string; hashtags?: string[] }) => {
      const response = await contentClient.patch(`/content/${id}`, data);
      return response.data;
    }
  },
  alerts: {
    getAlerts: async (isRead?: boolean) => {
      const params = isRead !== undefined ? `?is_read=${isRead}` : '';
      const response = await contentClient.get(`/alerts${params}`).catch(() => ({ data: [] }));
      return response.data;
    },
    getUnreadCount: async () => {
      const response = await contentClient.get('/alerts/unread/count').catch(() => ({ data: { unread_count: 0 } }));
      return response.data;
    },
    markAsRead: async (alertId: string) => {
      const response = await contentClient.post(`/alerts/read/${alertId}`).catch(() => ({ data: { status: 'error' } }));
      return response.data;
    }
  }
};
