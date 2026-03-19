import os
import json
import subprocess
import time
import requests
from datetime import datetime
from typing import Dict, Any, List
import redis

BASE_URL_CONTENT_FACTORY = os.getenv("BASE_URL_CONTENT_FACTORY", "http://localhost:8000")
BASE_URL_DISTRIBUTION = os.getenv("BASE_URL_DISTRIBUTION", "http://localhost:3001")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def get_redis_connection():
    """Get Redis connection."""
    try:
        return redis.from_url(REDIS_URL, decode_responses=True)
    except Exception as e:
        print(f"Redis connection error: {e}")
        return None


def check_service_health(url: str, name: str) -> Dict[str, Any]:
    """Check if a service is healthy."""
    try:
        response = requests.get(f"{url}/health", timeout=5)
        return {
            "name": name,
            "url": url,
            "status": "healthy" if response.status_code == 200 else "unhealthy",
            "status_code": response.status_code,
            "response": response.json() if response.status_code == 200 else None
        }
    except Exception as e:
        return {
            "name": name,
            "url": url,
            "status": "unavailable",
            "error": str(e)
        }


def get_redis_metrics() -> Dict[str, Any]:
    """Get Redis queue metrics."""
    r = get_redis_connection()
    if not r:
        return {"error": "Redis unavailable"}
    
    try:
        queue_size = r.llen("content:ready")
        pending_count = r.zcard("scheduling:pending") or 0
        
        return {
            "queue_size": queue_size,
            "pending_count": pending_count,
            "info": {
                "used_memory": r.info("memory").get("used_memory_human"),
                "connected_clients": r.info("clients").get("connected_clients"),
            }
        }
    except Exception as e:
        return {"error": str(e)}


def get_docker_stats() -> List[Dict[str, Any]]:
    """Get Docker container stats."""
    try:
        result = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        stats = []
        for line in result.stdout.strip().split('\n'):
            if line:
                try:
                    stats.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return stats
    except Exception as e:
        return [{"error": str(e)}]


def get_prometheus_metrics(url: str) -> Dict[str, Any]:
    """Get Prometheus metrics from a service."""
    try:
        response = requests.get(f"{url}/metrics", timeout=5)
        if response.status_code == 200:
            return {"status": "available", "sample_count": len(response.text.split('\n'))}
        return {"status": "unavailable"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def collect_all_metrics() -> Dict[str, Any]:
    """Collect all system metrics."""
    timestamp = datetime.utcnow().isoformat()
    
    return {
        "timestamp": timestamp,
        "services": {
            "content_factory": check_service_health(BASE_URL_CONTENT_FACTORY, "Content Factory"),
            "distribution_engine": check_service_health(BASE_URL_DISTRIBUTION, "Distribution Engine"),
        },
        "redis": get_redis_metrics(),
        "docker": get_docker_stats(),
        "prometheus": {
            "content_factory": get_prometheus_metrics(BASE_URL_CONTENT_FACTORY),
            "distribution_engine": get_prometheus_metrics(BASE_URL_DISTRIBUTION),
        }
    }


def print_metrics(metrics: Dict[str, Any]):
    """Print metrics in a readable format."""
    print("\n" + "=" * 50)
    print("SYSTEM METRICS")
    print("=" * 50)
    print(f"Timestamp: {metrics['timestamp']}")
    
    print("\n--- Services ---")
    for name, data in metrics['services'].items():
        status = data.get('status', 'unknown')
        symbol = "✓" if status == "healthy" else "✗"
        print(f"  {symbol} {name}: {status}")
    
    print("\n--- Redis ---")
    redis_data = metrics.get('redis', {})
    if 'error' in redis_data:
        print(f"  ✗ {redis_data['error']}")
    else:
        print(f"  Queue Size: {redis_data.get('queue_size', 0)}")
        print(f"  Pending: {redis_data.get('pending_count', 0)}")
        if 'info' in redis_data:
            print(f"  Memory: {redis_data['info'].get('used_memory', 'N/A')}")
    
    print("\n--- Docker ---")
    docker_data = metrics.get('docker', [])
    if docker_data and 'error' not in docker_data[0]:
        for container in docker_data:
            print(f"  {container.get('Name', 'unknown')}: CPU {container.get('CPUPerc', 'N/A')}, MEM {container.get('MemUsage', 'N/A')}")
    else:
        print("  Docker stats unavailable")
    
    print("\n--- Prometheus ---")
    for name, data in metrics.get('prometheus', {}).items():
        status = data.get('status', 'unknown')
        print(f"  {name}: {status}")


def save_metrics(metrics: Dict[str, Any], output_file: str = None):
    """Save metrics to file."""
    if not output_file:
        output_file = f"metrics_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(output_file, 'w') as f:
        json.dump(metrics, f, indent=2)
    
    print(f"\nMetrics saved to: {output_file}")


def continuous_monitoring(interval: int = 30, duration: int = 300):
    """Continuously monitor metrics."""
    print(f"Starting continuous monitoring (interval: {interval}s, duration: {duration}s)")
    start_time = time.time()
    
    while time.time() - start_time < duration:
        metrics = collect_all_metrics()
        print_metrics(metrics)
        time.sleep(interval)
    
    print("\nMonitoring complete")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Influence Platform Load Test Metrics")
    parser.add_argument("--output", "-o", help="Output file for metrics")
    parser.add_argument("--continuous", "-c", action="store_true", help="Continuous monitoring")
    parser.add_argument("--interval", "-i", type=int, default=30, help="Monitoring interval in seconds")
    parser.add_argument("--duration", "-d", type=int, default=300, help="Total monitoring duration in seconds")
    
    args = parser.parse_args()
    
    if args.continuous:
        continuous_monitoring(args.interval, args.duration)
    else:
        metrics = collect_all_metrics()
        print_metrics(metrics)
        save_metrics(metrics, args.output)
