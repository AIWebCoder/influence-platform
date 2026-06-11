require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
// Sentry — must be first import
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.2,
    environment: process.env.ENVIRONMENT || 'development',
  });
  console.log('✅ Sentry initialisé (Distribution Engine)');
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initRedis, consumeQueue } = require('./core/redis');
const { initDB } = require('./core/database');
const authMiddleware = require('./middleware/auth');
const authRouter = require('./managers/authRouter');
const accountsRouter = require('./managers/accountsRouter');
const healthRouter = require('./health/healthRouter');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// CORS — Must be before limiter to ensure 429s have CORS headers
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-trace-id', 'x-request-id'],
}));

// Rate Limiting — 5000 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);

// Prometheus metrics must be public (scrapers have no JWT)
const { register } = require('./core/metrics');
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Public smoke check (no JWT) — confirms engagement router is deployed
app.get('/engagement/ping', (_req, res) => {
  res.json({
    ok: true,
    module: 'engagement',
    implementation: 'native',
    routes: [
      'GET /engagement/posts',
      'GET /engagement/posts/:mediaId/comments',
      'GET /engagement/conversations',
      'GET /engagement/conversations/:id/messages',
      'GET /engagement/intents',
    ],
  });
});

app.use(authMiddleware);
app.use('/accounts', accountsRouter);

const publicationsRouter = require('./managers/publicationsRouter');
app.use('/publications', publicationsRouter);

const queueRouter = require('./managers/queueRouter');
app.use('/queue', queueRouter);

const proxyRouter = require('./managers/proxyRouter');
app.use('/proxies', proxyRouter);

const personasRouter = require('./managers/personasRouter');
app.use('/personas', personasRouter);

const analyticsRouter = require('./managers/analyticsRouter');
app.use('/analytics', analyticsRouter);

const abTestingRouter = require('./managers/abTestingRouter');
app.use('/ab-tests', abTestingRouter);

const campaignRouter = require('./managers/campaignRouter');
app.use('/campaigns', campaignRouter);

const dashboardRouter = require('./managers/dashboardRouter');
app.use('/dashboard', dashboardRouter);

const engagementRouter = require('./managers/engagementRouter');
const engagementPostsRoutes = require('./managers/engagementPostsRoutes');
const engagementDmRoutes = require('./managers/engagementDmRoutes');
app.use('/engagement', engagementRouter);
app.use('/engagement', engagementPostsRoutes);
app.use('/engagement', engagementDmRoutes);

app.get('/', (req, res) => {
  res.json({
    service: 'Distribution Engine',
    version: '1.0.0',
    status: 'running'
  });
});

// Démarrage
async function start() {
  try {
    await initDB();
    await initRedis();
    console.log('✅ Base de données et Redis prêts');

    const { publishModeLabel } = require('./core/publishMode');
    const dry = publishModeLabel() === 'DRY_RUN';
    console.log(JSON.stringify({
      event: 'publish_pipeline_startup',
      mode: publishModeLabel(),
      publish_mode: dry ? 'DRY_RUN_MODE' : 'REAL_PUBLISH_MODE',
      PUBLISH_DRY_RUN: process.env.PUBLISH_DRY_RUN,
      hint: dry
        ? 'DRY_RUN_MODE: no Playwright / Instagram tokens. Set PUBLISH_DRY_RUN=false only for controlled real posts.'
        : 'REAL_PUBLISH_MODE: external automation and tokens will be used.',
    }));

    // Démarrer le consumer de queue en background
    consumeQueue('content:ready');

    const PublishingWorker = require('./publisher/PublishingWorker');
    PublishingWorker.startPublishConsumer();
    const EngagementWorker = require('./engagement/EngagementWorker');
    EngagementWorker.startEngagementConsumer();
    console.log(JSON.stringify({
      event: 'engagement_pipeline_startup',
      mode: require('./engagement/engagementMode').engagementModeLabel(),
      ENGAGEMENT_DRY_RUN: process.env.ENGAGEMENT_DRY_RUN,
      queue: 'engagement:commands',
    }));
    const { startTokenExpiryCron } = require('./services/tokenExpiryMonitor');
    startTokenExpiryCron();

    // Initialize Automated Services (after DB/Redis are READY)

    /** Never let scheduled async work reject unhandled — that can crash Node and drop all HTTP clients (ERR_EMPTY_RESPONSE). */
    const runScheduled = (label, fn) => {
      Promise.resolve()
        .then(fn)
        .catch((err) => {
          console.error(`[DistributionEngine] Scheduled job "${label}" failed:`, err?.message || err);
          if (process.env.SENTRY_DSN) {
            Sentry.captureException(err);
          }
        });
    };

    // 1. Proxy Health Check (every 5 minutes)
    const ProxyManager = require('./proxy/ProxyManager');
    const OperationalAlertMonitor = require('./services/OperationalAlertMonitor');
    setInterval(() => {
      console.log('[DistributionEngine] Running scheduled proxy health checks...');
      runScheduled('proxy-health', () => ProxyManager.runHealthCheckAll());
    }, 5 * 60 * 1000);
    setInterval(() => {
      runScheduled('operational-alerts', () => OperationalAlertMonitor.runAll());
    }, 5 * 60 * 1000);
    // Initial run
    ProxyManager.runHealthCheckAll().catch(err =>
      console.warn('[HealthCheck] Initial proxy check failed:', err.message)
    );
    OperationalAlertMonitor.runAll().catch(err =>
      console.warn('[OperationalAlertMonitor] Initial run failed:', err.message)
    );

    // 2. Campaign Automation orchestrator
    const CampaignManager = require('./automation/CampaignManager');
    CampaignManager.start();

    // 3. Analytics Metrics Collection (every 2 hours)
    const MetricsCollector = require('./analytics/MetricsCollector');
    setInterval(() => {
      console.log('[DistributionEngine] Running scheduled metrics collection...');
      runScheduled('metrics-collector', () => MetricsCollector.collectAll());
    }, 2 * 60 * 60 * 1000);

    // 4. A/B Test Auto-Evaluation (every 4 hours)
    const WinnerDetectionService = require('./analytics/WinnerDetectionService');
    setInterval(() => {
      console.log('[DistributionEngine] Running scheduled A/B test evaluations...');
      runScheduled('ab-auto-evaluation', () => WinnerDetectionService.runAutoEvaluation());
    }, 4 * 60 * 60 * 1000);

    // 5. Shadowban engagement scan (every 12 hours, Instagram accounts)
    const ShadowbanMonitor = require('./health/ShadowbanMonitor');
    const runShadowbanSweep = async () => {
      try {
        const pool = require('./core/database').getPool();
        const res = await pool.query(
          `SELECT id FROM accounts
           WHERE LOWER(COALESCE(platform, 'instagram')) = 'instagram'
             AND LOWER(status) IN ('active', 'warming')`
        );
        for (const row of res.rows) {
          await ShadowbanMonitor.analyzeEngagement(row.id);
        }
        console.log(`[ShadowbanMonitor] Sweep completed for ${res.rows.length} accounts`);
      } catch (err) {
        console.warn('[ShadowbanMonitor] Scheduled sweep failed:', err.message);
      }
    };
    setInterval(() => runScheduled('shadowban-sweep', runShadowbanSweep), 12 * 60 * 60 * 1000);
    runScheduled('shadowban-sweep-initial', runShadowbanSweep);

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`✅ Distribution Engine démarré sur port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Erreur démarrage:', err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[DistributionEngine] unhandledRejection:', reason);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
});
process.on('uncaughtException', (err) => {
  console.error('[DistributionEngine] uncaughtException:', err);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
});

start();
