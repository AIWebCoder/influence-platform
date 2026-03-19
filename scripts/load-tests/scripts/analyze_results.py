import os
import json
import glob
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class TestResult:
    scenario: str
    accounts: int
    duration_seconds: float
    total_requests: int
    http_req_duration_avg: float
    http_req_duration_p95: float
    http_req_duration_p99: float
    http_req_duration_max: float
    error_rate: float
    custom_metrics: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""


@dataclass
class SystemMetrics:
    timestamp: str
    services_healthy: bool
    redis_queue_size: int
    docker_cpu: Dict[str, float] = field(default_factory=dict)
    docker_memory: Dict[str, float] = field(default_factory=dict)
    prometheus_metrics: Dict[str, Any] = field(default_factory=dict)


class LoadTestAnalyzer:
    def __init__(self, results_dir: str):
        self.results_dir = Path(results_dir)
        self.test_results: List[TestResult] = []
        self.system_metrics: List[SystemMetrics] = []
        
    def load_k6_results(self, pattern: str = "*.json") -> List[TestResult]:
        """Load all k6 JSON result files."""
        results = []
        
        for filepath in self.results_dir.glob(f"**/{pattern}"):
            if "summary" in filepath.name or "system" in filepath.name:
                continue
                
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                
                result = self._parse_k6_result(data, filepath.name)
                if result:
                    results.append(result)
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Warning: Could not parse {filepath.name}: {e}")
                continue
        
        return results
    
    def _parse_k6_result(self, data: Dict, filename: str) -> Optional[TestResult]:
        """Parse k6 JSON output into TestResult."""
        try:
            metrics = data.get('metrics', {})
            
            accounts = 50
            if '50accounts' in filename:
                accounts = 50
            elif '200accounts' in filename:
                accounts = 200
            elif '500accounts' in filename:
                accounts = 500
            
            scenario = 'unknown'
            if 'content_generation' in filename:
                scenario = 'content_generation'
            elif 'queue_publishing' in filename:
                scenario = 'queue_publishing'
            elif 'account_activity' in filename:
                scenario = 'account_activity'
            
            http_duration = metrics.get('http_req_duration', {})
            http_failed = metrics.get('http_req_failed', {})
            
            custom_metrics = {}
            for key in ['content_generate_duration', 'queue_push_duration', 
                       'action_latency', 'publish_success', 'proxy_success']:
                if key in metrics:
                    custom_metrics[key] = metrics[key]
            
            return TestResult(
                scenario=scenario,
                accounts=accounts,
                duration_seconds=data.get('state', {}).get('testRunDurationMs', 0) / 1000,
                total_requests=metrics.get('http_reqs', {}).get('values', {}).get('count', 0),
                http_req_duration_avg=http_duration.get('values', {}).get('avg', 0),
                http_req_duration_p95=http_duration.get('values', {}).get('p(95)', 0),
                http_req_duration_p99=http_duration.get('values', {}).get('p(99)', 0),
                http_req_duration_max=http_duration.get('values', {}).get('max', 0),
                error_rate=http_failed.get('values', {}).get('rate', 0),
                custom_metrics=custom_metrics,
                timestamp=data.get('state', {}).get('timestamp', '')
            )
        except Exception as e:
            print(f"Error parsing {filename}: {e}")
            return None
    
    def load_system_metrics(self, pattern: str = "system_*.json") -> List[SystemMetrics]:
        """Load system metrics files."""
        metrics = []
        
        for filepath in self.results_dir.glob(f"**/{pattern}"):
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                
                metric = self._parse_system_metrics(data)
                if metric:
                    metrics.append(metric)
            except json.JSONDecodeError:
                continue
        
        return metrics
    
    def _parse_system_metrics(self, data: Dict) -> Optional[SystemMetrics]:
        """Parse system metrics."""
        try:
            services = data.get('services', {})
            services_healthy = all(
                s.get('status') == 'healthy' 
                for s in services.values()
            )
            
            redis_data = data.get('redis', {})
            docker_data = data.get('docker', [])
            
            docker_cpu = {}
            docker_memory = {}
            for container in docker_data:
                if 'error' not in container:
                    name = container.get('Name', 'unknown')
                    cpu = container.get('CPUPerc', '0%').replace('%', '')
                    mem = container.get('MemUsage', '0/0').split('/')[0].replace('MiB', '').replace('GiB', '')
                    docker_cpu[name] = float(cpu)
                    try:
                        docker_memory[name] = float(mem)
                    except ValueError:
                        docker_memory[name] = 0.0
            
            return SystemMetrics(
                timestamp=data.get('timestamp', ''),
                services_healthy=services_healthy,
                redis_queue_size=redis_data.get('queue_size', 0),
                docker_cpu=docker_cpu,
                docker_memory=docker_memory,
                prometheus_metrics=data.get('prometheus', {})
            )
        except Exception as e:
            return None
    
    def analyze_by_level(self) -> Dict[int, Dict[str, Any]]:
        """Analyze results grouped by account level."""
        levels = {50: [], 200: [], 500: []}
        
        for result in self.test_results:
            if result.accounts in levels:
                levels[result.accounts].append(result)
        
        analysis = {}
        for level, results in levels.items():
            if not results:
                continue
                
            avg_response = sum(r.http_req_duration_avg for r in results) / len(results)
            p95_response = sum(r.http_req_duration_p95 for r in results) / len(results)
            p99_response = sum(r.http_req_duration_p99 for r in results) / len(results)
            max_response = max(r.http_req_duration_max for r in results)
            error_rate = sum(r.error_rate for r in results) / len(results)
            
            publish_success = None
            for r in results:
                if r.custom_metrics.get('publish_success'):
                    publish_success = r.custom_metrics['publish_success']['values']['rate']
                    break
            
            analysis[level] = {
                'scenarios_tested': list(set(r.scenario for r in results)),
                'total_requests': sum(r.total_requests for r in results),
                'avg_response_time_ms': round(avg_response, 2),
                'p95_latency_ms': round(p95_response, 2),
                'p99_latency_ms': round(p99_response, 2),
                'max_latency_ms': round(max_response, 2),
                'error_rate_percent': round(error_rate * 100, 2),
                'publish_success_rate': round(publish_success * 100, 2) if publish_success else None,
            }
        
        return analysis
    
    def detect_bottlenecks(self) -> Dict[str, Any]:
        """Detect system bottlenecks from results."""
        bottlenecks = {
            'cpu_saturation': [],
            'redis_bottleneck': [],
            'database_limits': [],
            'proxy_failures': [],
            'api_degradation': [],
        }
        
        for metric in self.system_metrics:
            for container, cpu in metric.docker_cpu.items():
                if cpu > 80:
                    bottlenecks['cpu_saturation'].append({
                        'container': container,
                        'cpu_percent': cpu,
                        'timestamp': metric.timestamp
                    })
            
            if metric.redis_queue_size > 100:
                bottlenecks['redis_bottleneck'].append({
                    'queue_size': metric.redis_queue_size,
                    'timestamp': metric.timestamp
                })
        
        for result in self.test_results:
            if result.http_req_duration_p95 > 2000:
                bottlenecks['api_degradation'].append({
                    'scenario': result.scenario,
                    'accounts': result.accounts,
                    'p95_ms': result.http_req_duration_p95,
                })
            
            if result.error_rate > 0.05:
                bottlenecks['api_degradation'].append({
                    'scenario': result.scenario,
                    'accounts': result.accounts,
                    'error_rate': result.error_rate,
                })
        
        return bottlenecks
    
    def calculate_system_capacity(self) -> Dict[str, Any]:
        """Calculate system capacity and limits."""
        analysis = self.analyze_by_level()
        
        stable_accounts = None
        degraded_accounts = None
        breaking_point = None
        
        for level in [50, 200, 500]:
            if level not in analysis:
                continue
                
            level_data = analysis[level]
            error_rate = level_data['error_rate_percent']
            p95 = level_data['p95_latency_ms']
            
            if error_rate < 2 and p95 < 1500:
                stable_accounts = level
            elif error_rate < 10 and p95 < 3000:
                degraded_accounts = level
            else:
                breaking_point = level
                break
        
        return {
            'max_stable_accounts': stable_accounts or 50,
            'max_degraded_accounts': degraded_accounts or 200,
            'breaking_point': breaking_point,
            'recommended_limit': (stable_accounts or 50) - 20 if stable_accounts else 50,
        }
    
    def generate_recommendations(self) -> List[Dict[str, str]]:
        """Generate optimization recommendations."""
        recommendations = []
        bottlenecks = self.detect_bottlenecks()
        capacity = self.calculate_system_capacity()
        
        if bottlenecks.get('cpu_saturation'):
            recommendations.append({
                'category': 'CPU',
                'issue': 'High CPU usage detected on containers',
                'action': 'Increase worker count or scale horizontally',
                'impact': 'high'
            })
        
        if bottlenecks.get('redis_bottleneck'):
            recommendations.append({
                'category': 'Redis',
                'issue': 'Queue backlog detected',
                'action': 'Increase consumer workers, optimize batching',
                'impact': 'high'
            })
        
        if capacity['recommended_limit'] < 200:
            recommendations.append({
                'category': 'Scaling',
                'issue': f"System stable at {capacity['max_stable_accounts']} accounts",
                'action': 'Add PgBouncer, optimize DB connections',
                'impact': 'critical'
            })
        
        for result in self.test_results:
            if result.http_req_duration_p95 > 2000 and result.accounts <= 50:
                recommendations.append({
                    'category': 'API',
                    'issue': f"High latency in {result.scenario}",
                    'action': 'Add caching, optimize queries',
                    'impact': 'medium'
                })
        
        return recommendations
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate complete analysis report."""
        return {
            'generated_at': datetime.utcnow().isoformat(),
            'summary': {
                'total_tests': len(self.test_results),
                'total_metrics': len(self.system_metrics),
            },
            'performance_by_level': self.analyze_by_level(),
            'bottlenecks': self.detect_bottlenecks(),
            'system_capacity': self.calculate_system_capacity(),
            'recommendations': self.generate_recommendations(),
        }
    
    def save_report(self, output_file: str = None):
        """Save report to file."""
        if not output_file:
            output_file = self.results_dir / "final_report.json"
        
        report = self.generate_report()
        
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"Report saved to: {output_file}")
        return report
    
    def print_summary(self):
        """Print human-readable summary."""
        report = self.generate_report()
        
        print("\n" + "=" * 60)
        print("LOAD TEST ANALYSIS SUMMARY")
        print("=" * 60)
        
        print("\n--- Performance by Load Level ---")
        for level, data in report['performance_by_level'].items():
            print(f"\n  {level} Accounts:")
            print(f"    Avg Response: {data['avg_response_time_ms']}ms")
            print(f"    P95 Latency: {data['p95_latency_ms']}ms")
            print(f"    P99 Latency: {data['p99_latency_ms']}ms")
            print(f"    Error Rate:  {data['error_rate_percent']}%")
            if data['publish_success_rate']:
                print(f"    Publish Success: {data['publish_success_rate']}%")
        
        print("\n--- System Capacity ---")
        capacity = report['system_capacity']
        print(f"  Max Stable:    {capacity['max_stable_accounts']} accounts")
        print(f"  Max Degraded:  {capacity['max_degraded_accounts']} accounts")
        print(f"  Breaking Point: {capacity['breaking_point'] or 'Not reached'}")
        print(f"  Recommended Limit: {capacity['recommended_limit']} accounts")
        
        print("\n--- Bottlenecks Detected ---")
        bottlenecks = report['bottlenecks']
        total_issues = sum(len(v) for v in bottlenecks.values())
        print(f"  Total issues: {total_issues}")
        
        if bottlenecks['cpu_saturation']:
            print(f"  CPU saturation events: {len(bottlenecks['cpu_saturation'])}")
        if bottlenecks['redis_bottleneck']:
            print(f"  Redis queue backlog events: {len(bottlenecks['redis_bottleneck'])}")
        if bottlenecks['api_degradation']:
            print(f"  API degradation events: {len(bottlenecks['api_degradation'])}")
        
        print("\n--- Recommendations ---")
        for i, rec in enumerate(report['recommendations'], 1):
            print(f"  {i}. [{rec['impact'].upper()}] {rec['category']}: {rec['issue']}")
            print(f"     → {rec['action']}")
        
        print("\n" + "=" * 60)


def analyze_results(results_dir: str):
    """Main function to analyze results."""
    analyzer = LoadTestAnalyzer(results_dir)
    
    print(f"Loading results from: {results_dir}")
    
    analyzer.test_results = analyzer.load_k6_results()
    analyzer.system_metrics = analyzer.load_system_metrics()
    
    print(f"Loaded {len(analyzer.test_results)} test results")
    print(f"Loaded {len(analyzer.system_metrics)} system metrics")
    
    analyzer.print_summary()
    
    return analyzer.save_report()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Analyze load test results")
    parser.add_argument("results_dir", help="Directory containing test results")
    parser.add_argument("--output", "-o", help="Output file for report")
    
    args = parser.parse_args()
    
    analyze_results(args.results_dir)
