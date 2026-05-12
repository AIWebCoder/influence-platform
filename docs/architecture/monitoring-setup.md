# Production Monitoring Setup

This guide outlines how to set up professional monitoring for the Influence Platform using Prometheus and Grafana.

## 1. Metrics Endpoints
Both backend services expose Prometheus-compatible metrics:
- **Distribution Engine**: `http://localhost:3001/metrics`
- **Content Factory**: `http://localhost:8000/metrics`

## 2. Key Metrics to Watch
- `http_requests_total`: Monitor traffic spikes and error rates (4xx, 5xx).
- `queue_size`: (Custom metric) Number of packets in Redis `content:ready`.
- `database_connections`: Ensure the pool isn't saturated.
- `worker_events`: Track successful vs failed publishing/generation attempts.

## 3. Alerts
We recommend setting up the following alerts in Grafana/Alertmanager:

|     Alert Name      |                Condition                | Severity |
| :-----------------: | :-------------------------------------: | :------: |
|  **QueueBacklog**   |        `queue_size > 50` for 5m         | Warning  |
| **HighFailureRate** |        `pub_failure_rate > 10%`         | Critical |
|   **ServiceDown**   |                `up == 0`                | Critical |
| **RateLimitSpike**  | `http_requests_status{code="429"} > 50` | Warning  |

## 4. Grafana Dashboard
Import the standard "Node.js" and "FastAPI" dashboards from Grafana Labs and add a custom panel for the Redis queue size using the provided metrics endpoint.
