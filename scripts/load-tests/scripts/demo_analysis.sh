#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOAD_TESTS_DIR="$SCRIPT_DIR/.."
RESULTS_DIR="$LOAD_TESTS_DIR/results"

generate_mock_results() {
    mkdir -p "$RESULTS_DIR"
    
    echo "Generating mock load test results for demonstration..."
    
    cat > "$RESULTS_DIR/content_generation_50accounts_20260318_120000.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:00:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 1250 } },
    "http_req_duration": {
      "values": {
        "avg": 850,
        "p(95)": 1450,
        "p(99)": 2100,
        "max": 3200
      }
    },
    "http_req_failed": { "values": { "rate": 0.015 } },
    "content_generate_duration": { "values": { "avg": 720 } }
  }
}
EOF

    cat > "$RESULTS_DIR/content_generation_200accounts_20260318_120500.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:05:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 4800 } },
    "http_req_duration": {
      "values": {
        "avg": 1280,
        "p(95)": 2400,
        "p(99)": 3800,
        "max": 6500
      }
    },
    "http_req_failed": { "values": { "rate": 0.045 } },
    "content_generate_duration": { "values": { "avg": 1100 } }
  }
}
EOF

    cat > "$RESULTS_DIR/content_generation_500accounts_20260318_121000.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:10:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 11500 } },
    "http_req_duration": {
      "values": {
        "avg": 2850,
        "p(95)": 5200,
        "p(99)": 7800,
        "max": 15000
      }
    },
    "http_req_failed": { "values": { "rate": 0.125 } },
    "content_generate_duration": { "values": { "avg": 2400 } }
  }
}
EOF

    cat > "$RESULTS_DIR/queue_publishing_50accounts_20260318_120100.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:01:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 980 } },
    "http_req_duration": {
      "values": {
        "avg": 320,
        "p(95)": 580,
        "p(99)": 890,
        "max": 1500
      }
    },
    "http_req_failed": { "values": { "rate": 0.008 } },
    "publish_success": { "values": { "rate": 0.985 } }
  }
}
EOF

    cat > "$RESULTS_DIR/queue_publishing_200accounts_20260318_120600.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:06:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 3900 } },
    "http_req_duration": {
      "values": {
        "avg": 680,
        "p(95)": 1200,
        "p(99)": 2100,
        "max": 4500
      }
    },
    "http_req_failed": { "values": { "rate": 0.028 } },
    "publish_success": { "values": { "rate": 0.945 } }
  }
}
EOF

    cat > "$RESULTS_DIR/queue_publishing_500accounts_20260318_121100.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:11:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 9200 } },
    "http_req_duration": {
      "values": {
        "avg": 1850,
        "p(95)": 3800,
        "p(99)": 6200,
        "max": 12000
      }
    },
    "http_req_failed": { "values": { "rate": 0.095 } },
    "publish_success": { "values": { "rate": 0.865 } }
  }
}
EOF

    cat > "$RESULTS_DIR/account_activity_50accounts_20260318_120200.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:02:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 1450 } },
    "http_req_duration": {
      "values": {
        "avg": 1250,
        "p(95)": 2800,
        "p(99)": 4200,
        "max": 8500
      }
    },
    "http_req_failed": { "values": { "rate": 0.025 } },
    "login_success": { "values": { "rate": 0.92 } },
    "proxy_success": { "values": { "rate": 0.88 } }
  }
}
EOF

    cat > "$RESULTS_DIR/account_activity_200accounts_20260318_120700.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:07:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 5600 } },
    "http_req_duration": {
      "values": {
        "avg": 2400,
        "p(95)": 4800,
        "p(99)": 7200,
        "max": 15000
      }
    },
    "http_req_failed": { "values": { "rate": 0.068 } },
    "login_success": { "values": { "rate": 0.78 } },
    "proxy_success": { "values": { "rate": 0.65 } }
  }
}
EOF

    cat > "$RESULTS_DIR/account_activity_500accounts_20260318_121200.json" << 'EOF'
{
  "state": {
    "testRunDurationMs": 180000,
    "timestamp": "2026-03-18T12:12:00Z"
  },
  "metrics": {
    "http_reqs": { "values": { "count": 12800 } },
    "http_req_duration": {
      "values": {
        "avg": 4500,
        "p(95)": 9200,
        "p(99)": 14000,
        "max": 28000
      }
    },
    "http_req_failed": { "values": { "rate": 0.185 } },
    "login_success": { "values": { "rate": 0.52 } },
    "proxy_success": { "values": { "rate": 0.38 } }
  }
}
EOF

    cat > "$RESULTS_DIR/system_metrics_50accounts_20260318_120300.json" << 'EOF'
{
  "timestamp": "2026-03-18T12:03:00Z",
  "services": {
    "content_factory": { "status": "healthy" },
    "distribution_engine": { "status": "healthy" }
  },
  "redis": {
    "queue_size": 45,
    "pending_count": 12
  },
  "docker": [
    { "Name": "content-factory", "CPUPerc": "45%", "MemUsage": "512MiB" },
    { "Name": "distribution-engine", "CPUPerc": "62%", "MemUsage": "1024MiB" }
  ]
}
EOF

    cat > "$RESULTS_DIR/system_metrics_200accounts_20260318_120800.json" << 'EOF'
{
  "timestamp": "2026-03-18T12:08:00Z",
  "services": {
    "content_factory": { "status": "healthy" },
    "distribution_engine": { "status": "healthy" }
  },
  "redis": {
    "queue_size": 280,
    "pending_count": 145
  },
  "docker": [
    { "Name": "content-factory", "CPUPerc": "78%", "MemUsage": "1024MiB" },
    { "Name": "distribution-engine", "CPUPerc": "92%", "MemUsage": "2048MiB" }
  ]
}
EOF

    cat > "$RESULTS_DIR/system_metrics_500accounts_20260318_121300.json" << 'EOF'
{
  "timestamp": "2026-03-18T12:13:00Z",
  "services": {
    "content_factory": { "status": "degraded" },
    "distribution_engine": { "status": "degraded" }
  },
  "redis": {
    "queue_size": 1250,
    "pending_count": 890
  },
  "docker": [
    { "Name": "content-factory", "CPUPerc": "95%", "MemUsage": "1536MiB" },
    { "Name": "distribution-engine", "CPUPerc": "98%", "MemUsage": "3072MiB" }
  ]
}
EOF

    echo "✓ Generated mock results in $RESULTS_DIR"
}

show_demo_analysis() {
    echo ""
    echo "=============================================="
    echo "Sample Analysis Output (from mock data)"
    echo "=============================================="
    
    python3 "$SCRIPT_DIR/analyze_results.py" "$RESULTS_DIR" 2>/dev/null || true
}

case "${1:-demo}" in
    demo)
        generate_mock_results
        show_demo_analysis
        ;;
    generate)
        generate_mock_results
        ;;
    *)
        echo "Usage: $0 [demo|generate]"
        echo "  demo     - Generate mock data and show analysis (default)"
        echo "  generate - Only generate mock data"
        exit 1
        ;;
esac
