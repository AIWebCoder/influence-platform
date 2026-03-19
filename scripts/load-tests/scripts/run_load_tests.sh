#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
RESULTS_DIR="$SCRIPT_DIR/results"

BASE_URL_CONTENT_FACTORY="${BASE_URL_CONTENT_FACTORY:-http://localhost:8000}"
BASE_URL_DISTRIBUTION="${BASE_URL_DISTRIBUTION:-http://localhost:3001}"

mkdir -p "$RESULTS_DIR"

AUTH_TOKEN=""
if [ -f "$SCRIPT_DIR/../.env" ]; then
  AUTH_TOKEN=$(grep JWT_SECRET "$SCRIPT_DIR/../.env" | cut -d '=' -f2 | head -1)
fi

echo "========================================"
echo "Influence Platform - Load Test Runner"
echo "========================================"
echo "Content Factory: $BASE_URL_CONTENT_FACTORY"
echo "Distribution: $BASE_URL_DISTRIBUTION"
echo ""

check_service() {
  local url=$1
  local name=$2
  echo -n "Checking $name... "
  if curl -s -f "$url" > /dev/null 2>&1; then
    echo "✓ Available"
    return 0
  else
    echo "✗ Not available"
    return 1
  fi
}

run_test() {
  local scenario=$1
  local accounts=$2
  local output_file="$RESULTS_DIR/${scenario}_${accounts}accounts_$(date +%Y%m%d_%H%M%S)"
  
  echo ""
  echo "----------------------------------------"
  echo "Running: $scenario with $accounts accounts"
  echo "Output: $output_file"
  echo "----------------------------------------"
  
  k6 run \
    --out json="$output_file.json" \
    --summary-export="$output_file_summary.json" \
    -e BASE_URL_CONTENT_FACTORY="$BASE_URL_CONTENT_FACTORY" \
    -e BASE_URL_DISTRIBUTION="$BASE_URL_DISTRIBUTION" \
    -e AUTH_TOKEN="$AUTH_TOKEN" \
    -e NUM_ACCOUNTS="$accounts" \
    "$SCENARIOS_DIR/$scenario.js" || true
  
  if [ -f "$output_file_summary.json" ]; then
    echo ""
    echo "Summary for $scenario ($accounts accounts):"
    cat "$output_file_summary.json" | jq -r '
      "  HTTP Req Duration (avg): " + (.metrics.http_req_duration.values.avg // 0 | tostring) + "ms",
      "  HTTP Req Duration (p95): " + (.metrics.http_req_duration.values["p(95)"] // 0 | tostring) + "ms",
      "  Error Rate: " + ((.metrics.http_req_failed.values.rate // 0) * 100 | tostring) + "%"
    ' 2>/dev/null || true
  fi
}

collect_system_metrics() {
  local output_file="$RESULTS_DIR/system_metrics_$(date +%Y%m%d_%H%M%S).json"
  
  echo ""
  echo "Collecting system metrics..."
  
  {
    echo "{"
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    
    if command -v docker &> /dev/null; then
      echo "  \"docker_stats\": "
      docker stats --no-stream --format "{{json .}}" 2>/dev/null | jq -s . || echo "[]"
      echo ","
    fi
    
    echo "  \"redis_queue_size\": $(redis-cli LLEN content:ready 2>/dev/null || echo "0")"
    
    echo "}"
  } > "$output_file"
  
  echo "System metrics saved to: $output_file"
}

run_full_suite() {
  local levels=(50 200 500)
  local scenarios=("content_generation.js" "queue_publishing.js" "account_activity.js")
  
  check_service "$BASE_URL_CONTENT_FACTORY/health" "Content Factory" || exit 1
  check_service "$BASE_URL_DISTRIBUTION/health" "Distribution Engine" || exit 1
  
  for level in "${levels[@]}"; do
    echo ""
    echo "========================================"
    echo "TEST LEVEL: $level accounts"
    echo "========================================"
    
    for scenario in "${scenarios[@]}"; do
      run_test "$scenario" "$level"
      sleep 10
    done
    
    collect_system_metrics
    sleep 30
  done
  
  generate_report
}

run_single_test() {
  local scenario=$1
  local accounts=${2:-50}
  
  check_service "$BASE_URL_CONTENT_FACTORY/health" "Content Factory" || exit 1
  
  run_test "$scenario" "$accounts"
}

generate_report() {
  local report_file="$RESULTS_DIR/load_test_report_$(date +%Y%m%d_%H%M%S).txt"
  
  echo ""
  echo "========================================"
  echo "Generating Report"
  echo "========================================"
  
  {
    echo "=========================================="
    echo "INFLUENCE PLATFORM - LOAD TEST REPORT"
    echo "=========================================="
    echo "Date: $(date)"
    echo "Environment: $BASE_URL_CONTENT_FACTORY"
    echo ""
    echo "TEST LEVELS:"
    echo "  - Baseline: 50 accounts"
    echo "  - Stress: 200 accounts"
    echo "  - Limit: 500 accounts"
    echo ""
    echo "SCENARIOS:"
    echo "  - content_generation: POST /content/generate, /content/generate/bulk"
    echo "  - queue_publishing: /scheduling/publish, queue operations"
    echo "  - account_activity: login, post, like, follow, comment"
    echo ""
    echo "RESULTS FILES:"
    ls -la "$RESULTS_DIR"/*.json 2>/dev/null | tail -20
    echo ""
    echo "=========================================="
    echo "SUCCESS CRITERIA:"
    echo "  ✓ Stable at 200 accounts"
    echo "  ✓ Controlled degradation at 500 accounts"
    echo "  ✓ No critical crashes"
    echo "  ✓ Publish success rate > 90%"
    echo "=========================================="
  } > "$report_file"
  
  echo "Report saved to: $report_file"
}

case "${1:-full}" in
  full)
    run_full_suite
    ;;
  content)
    run_single_test "content_generation.js" "${2:-50}"
    ;;
  queue)
    run_single_test "queue_publishing.js" "${2:-50}"
    ;;
  activity)
    run_single_test "account_activity.js" "${2:-50}"
    ;;
  metrics)
    collect_system_metrics
    ;;
  *)
    echo "Usage: $0 [full|content|queue|activity|metrics] [accounts]"
    echo ""
    echo "Commands:"
    echo "  full       - Run all scenarios at all levels (50, 200, 500)"
    echo "  content    - Run content generation test"
    echo "  queue      - Run queue/publishing test"
    echo "  activity   - Run account activity test"
    echo "  metrics    - Collect current system metrics"
    echo ""
    echo "Examples:"
    echo "  $0 full"
    echo "  $0 content 200"
    echo "  $0 queue 500"
    exit 1
    ;;
esac
