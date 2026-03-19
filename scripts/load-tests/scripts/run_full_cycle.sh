#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOAD_TESTS_DIR="$SCRIPT_DIR/.."
RESULTS_DIR="$LOAD_TESTS_DIR/results"

echo "=============================================="
echo "Running Complete Load Test & Analysis Cycle"
echo "=============================================="

check_prerequisites() {
    echo ""
    echo "Checking prerequisites..."
    
    if ! command -v k6 &> /dev/null; then
        echo "ERROR: k6 is not installed"
        echo "Install from: https://k6.io/docs/getting-started/installation/"
        exit 1
    fi
    
    if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
        echo "ERROR: Python is not installed"
        exit 1
    fi
    
    echo "✓ Prerequisites OK"
}

check_services() {
    echo ""
    echo "Checking services..."
    
    BASE_URL_CONTENT_FACTORY="${BASE_URL_CONTENT_FACTORY:-http://localhost:8000}"
    BASE_URL_DISTRIBUTION="${BASE_URL_DISTRIBUTION:-http://localhost:3001}"
    
    if curl -s -f "$BASE_URL_CONTENT_FACTORY/health" > /dev/null 2>&1; then
        echo "✓ Content Factory available"
    else
        echo "WARNING: Content Factory not available at $BASE_URL_CONTENT_FACTORY"
    fi
    
    if curl -s -f "$BASE_URL_DISTRIBUTION/health" > /dev/null 2>&1; then
        echo "✓ Distribution Engine available"
    else
        echo "WARNING: Distribution Engine not available at $BASE_URL_DISTRIBUTION"
    fi
}

run_baseline_test() {
    local accounts=$1
    local scenario=$2
    
    echo ""
    echo "----------------------------------------"
    echo "Running: $scenario with $accounts accounts"
    echo "----------------------------------------"
    
    local output_file="$RESULTS_DIR/${scenario}_${accounts}accounts_$(date +%Y%m%d_%H%M%S)"
    
    k6 run \
        --out json="$output_file.json" \
        -e BASE_URL_CONTENT_FACTORY="${BASE_URL_CONTENT_FACTORY:-http://localhost:8000}" \
        -e BASE_URL_DISTRIBUTION="${BASE_URL_DISTRIBUTION:-http://localhost:3001}" \
        -e NUM_ACCOUNTS="$accounts" \
        "$LOAD_TESTS_DIR/scenarios/$scenario.js" || true
    
    echo "Results saved to: $output_file.json"
}

collect_metrics() {
    local label=$1
    local output_file="$RESULTS_DIR/system_metrics_${label}_$(date +%Y%m%d_%H%M%S).json"
    
    python3 "$SCRIPT_DIR/collect_metrics.py" --output "$output_file" 2>/dev/null || true
    
    if [ -f "$output_file" ]; then
        echo "System metrics saved to: $output_file"
    fi
}

run_full_test_cycle() {
    local levels=(50 200 500)
    local scenarios=("content_generation.js" "queue_publishing.js" "account_activity.js")
    
    check_prerequisites
    check_services
    
    mkdir -p "$RESULTS_DIR"
    
    for level in "${levels[@]}"; do
        echo ""
        echo "=============================================="
        echo "TEST LEVEL: $level accounts"
        echo "=============================================="
        
        for scenario in "${scenarios[@]}"; do
            run_baseline_test "$level" "$scenario"
            sleep 5
        done
        
        collect_metrics "${level}accounts"
        sleep 15
    done
    
    generate_analysis
}

run_targeted_test() {
    local target=$1
    
    check_prerequisites
    mkdir -p "$RESULTS_DIR"
    
    case "$target" in
        baseline)
            run_baseline_test 50 "content_generation.js"
            collect_metrics "baseline"
            ;;
        stress)
            run_baseline_test 200 "content_generation.js"
            collect_metrics "stress"
            ;;
        limit)
            run_baseline_test 500 "content_generation.js"
            collect_metrics "limit"
            ;;
        all-content)
            for level in 50 200 500; do
                run_baseline_test "$level" "content_generation.js"
                sleep 10
            done
            ;;
        all-queue)
            for level in 50 200 500; do
                run_baseline_test "$level" "queue_publishing.js"
                sleep 10
            done
            ;;
        all-activity)
            for level in 50 200 500; do
                run_baseline_test "$level" "account_activity.js"
                sleep 10
            done
            ;;
        *)
            echo "Unknown target: $target"
            exit 1
            ;;
    esac
    
    generate_analysis
}

generate_analysis() {
    echo ""
    echo "=============================================="
    echo "Generating Analysis Report"
    echo "=============================================="
    
    python3 "$SCRIPT_DIR/analyze_results.py" "$RESULTS_DIR" --output "$RESULTS_DIR/final_report.json"
    
    if [ -f "$RESULTS_DIR/final_report.json" ]; then
        echo ""
        echo "✓ Final report generated: $RESULTS_DIR/final_report.json"
        
        echo ""
        echo "Key Findings:"
        python3 -c "
import json
with open('$RESULTS_DIR/final_report.json') as f:
    data = json.load(f)
    capacity = data['system_capacity']
    print(f\"  Max Stable Accounts: {capacity['max_stable_accounts']}\")
    print(f\"  Max Degraded Accounts: {capacity['max_degraded_accounts']}\")
    print(f\"  Recommended Limit: {capacity['recommended_limit']}\")
    print(f\"  Breaking Point: {capacity['breaking_point'] or 'Not reached'}\")
    print()
    print('  Top Recommendations:')
    for rec in data['recommendations'][:3]:
        print(f\"    - [{rec['impact'].upper()}] {rec['category']}: {rec['action']}\")
"
    fi
}

show_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  full              - Run complete test cycle (50→200→500 accounts)"
    echo "  baseline          - Quick baseline test (50 accounts)"
    echo "  stress            - Stress test (200 accounts)"
    echo "  limit             - Limit test (500 accounts)"
    echo "  all-content       - Test content generation at all levels"
    echo "  all-queue         - Test queue operations at all levels"
    echo "  all-activity      - Test account activity at all levels"
    echo "  analyze           - Analyze existing results"
    echo ""
    echo "Examples:"
    echo "  $0 full           # Run everything"
    echo "  $0 baseline       # Quick smoke test"
    echo "  $0 analyze        # Just analyze existing results"
}

case "${1:-full}" in
    full)
        run_full_test_cycle
        ;;
    baseline|stress|limit|all-content|all-queue|all-activity)
        run_targeted_test "$1"
        ;;
    analyze)
        generate_analysis
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
