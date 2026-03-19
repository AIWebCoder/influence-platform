# Load Testing Suite

This directory contains load testing scenarios and tools for the Influence Platform.

## Prerequisites

1. **Install k6** (https://k6.io/docs/getting-started/installation/)
   ```bash
   # macOS
   brew install k6
   
   # Linux
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   
   # Windows
   winget install k6 --source winget
   ```

2. **Install Python dependencies** (for metrics collection):
   ```bash
   pip install -r requirements.txt
   ```

## Directory Structure

```
load-tests/
├── scenarios/           # k6 test scenarios
│   ├── content_generation.js
│   ├── queue_publishing.js
│   └── account_activity.js
├── scripts/             # Test runner and utilities
│   ├── run_load_tests.sh
│   └── collect_metrics.py
├── results/            # Test results output
├── .env.example        # Environment configuration
└── requirements.txt    # Python dependencies
```

## Usage

### Quick Start

1. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. Run all tests:
   ```bash
   cd scripts
   ./run_load_tests.sh full
   ```

3. View results in `results/` directory

### Test Scenarios

| Scenario | Description | Endpoints Tested |
|----------|-------------|------------------|
| `content_generation` | Content AI generation load | POST /content/generate, /content/generate/bulk |
| `queue_publishing` | Queue and publishing operations | POST /scheduling/publish, /scheduling/queue/size |
| `account_activity` | Account actions (login, post, like, follow) | POST /accounts/{id}/login, /publish, /actions/* |

### Test Levels

| Level | Accounts | Expected Behavior |
|-------|----------|-------------------|
| Baseline | 50 | Stable system |
| Stress | 200 | Minor queue delays, CPU spikes |
| Limit | 500 | Controlled degradation |

### Commands

```bash
# Run full test suite (all scenarios at all levels)
./run_load_tests.sh full

# Run specific scenario
./run_load_tests.sh content 200
./run_load_tests.sh queue 500
./run_load_tests.sh activity 50

# Collect system metrics
python scripts/collect_metrics.py
python scripts/collect_metrics.py --continuous --interval 30 --duration 300

# Run k6 directly with custom parameters
k6 run -e NUM_ACCOUNTS=200 scenarios/content_generation.js
```

## Metrics Collection

The test suite collects:
- **HTTP Response Times**: Average, p95, p99, max
- **Error Rates**: Failed requests percentage
- **Custom Metrics**:
  - `content_generate_duration`: Time for AI content generation
  - `queue_push_duration`: Time to push to Redis queue
  - `action_latency`: Time for account actions
  - `publish_success`: Publishing success rate
  - `proxy_success`: Proxy reliability

### System Metrics

Collect separately with:
```bash
python scripts/collect_metrics.py --output results/system_baseline.json
```

## Interpreting Results

### Success Criteria

| Metric | Target |
|--------|--------|
| HTTP p95 Response Time | < 2000ms |
| Error Rate | < 10% |
| Publish Success Rate | > 90% |
| System Stability at 200 accounts | No crashes |

### Common Bottlenecks

- **High CPU**: Increase worker count or scale horizontally
- **Redis Queue Backlog**: Increase consumer workers
- **DB Connection Exhaustion**: Configure PgBouncer
- **Proxy Failures**: Increase proxy pool size

## Troubleshooting

### Services Not Available

Ensure all services are running:
```bash
docker-compose ps
curl http://localhost:8000/health
curl http://localhost:3001/health
```

### Authentication Errors

Set AUTH_TOKEN in .env or export before running:
```bash
export AUTH_TOKEN="your-jwt-token"
./run_load_tests.sh content
```
