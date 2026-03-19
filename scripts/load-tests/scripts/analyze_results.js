const fs = require('fs');
const path = require('path');

class LoadTestAnalyzer {
    constructor(resultsDir) {
        this.resultsDir = resultsDir;
        this.testResults = [];
        this.systemMetrics = [];
    }

    loadK6Results() {
        const files = fs.readdirSync(this.resultsDir);
        
        for (const filename of files) {
            if (!filename.endsWith('.json')) continue;
            if (filename.includes('summary') || filename.includes('system') || filename.includes('final')) continue;
            
            try {
                const data = JSON.parse(fs.readFileSync(path.join(this.resultsDir, filename), 'utf8'));
                const result = this.parseK6Result(data, filename);
                if (result) this.testResults.push(result);
            } catch (e) {
                console.log(`Warning: Could not parse ${filename}: ${e.message}`);
            }
        }
        
        return this.testResults;
    }

    parseK6Result(data, filename) {
        try {
            const metrics = data.metrics || {};
            
            let accounts = 50;
            if (filename.includes('50accounts')) accounts = 50;
            else if (filename.includes('200accounts')) accounts = 200;
            else if (filename.includes('500accounts')) accounts = 500;
            
            let scenario = 'unknown';
            if (filename.includes('content_generation')) scenario = 'content_generation';
            else if (filename.includes('queue_publishing')) scenario = 'queue_publishing';
            else if (filename.includes('account_activity')) scenario = 'account_activity';
            
            const httpDuration = metrics.http_req_duration?.values || {};
            const httpFailed = metrics.http_req_failed?.values || {};
            
            return {
                scenario,
                accounts,
                durationSeconds: (data.state?.testRunDurationMs || 0) / 1000,
                totalRequests: metrics.http_reqs?.values?.count || 0,
                httpReqDurationAvg: httpDuration.avg || 0,
                httpReqDurationP95: httpDuration['p(95)'] || 0,
                httpReqDurationP99: httpDuration['p(99)'] || 0,
                httpReqDurationMax: httpDuration.max || 0,
                errorRate: httpFailed.rate || 0,
                customMetrics: metrics,
                timestamp: data.state?.timestamp || ''
            };
        } catch (e) {
            return null;
        }
    }

    loadSystemMetrics() {
        const files = fs.readdirSync(this.resultsDir);
        
        for (const filename of files) {
            if (!filename.includes('system_') || !filename.endsWith('.json')) continue;
            
            try {
                const data = JSON.parse(fs.readFileSync(path.join(this.resultsDir, filename), 'utf8'));
                this.systemMetrics.push(this.parseSystemMetrics(data));
            } catch (e) {
                continue;
            }
        }
        
        return this.systemMetrics;
    }

    parseSystemMetrics(data) {
        const services = data.services || {};
        const servicesHealthy = Object.values(services).every(s => s.status === 'healthy');
        const redisData = data.redis || {};
        
        return {
            timestamp: data.timestamp || '',
            servicesHealthy,
            redisQueueSize: redisData.queue_size || 0,
            dockerCpu: data.docker || []
        };
    }

    analyzeByLevel() {
        const levels = { 50: [], 200: [], 500: [] };
        
        for (const result of this.testResults) {
            if (levels[result.accounts]) {
                levels[result.accounts].push(result);
            }
        }
        
        const analysis = {};
        
        for (const [level, results] of Object.entries(levels)) {
            if (results.length === 0) continue;
            
            const avgResponse = results.reduce((sum, r) => sum + r.httpReqDurationAvg, 0) / results.length;
            const p95Response = results.reduce((sum, r) => sum + r.httpReqDurationP95, 0) / results.length;
            const p99Response = results.reduce((sum, r) => sum + r.httpReqDurationP99, 0) / results.length;
            const maxResponse = Math.max(...results.map(r => r.httpReqDurationMax));
            const errorRate = results.reduce((sum, r) => sum + r.errorRate, 0) / results.length;
            
            let publishSuccess = null;
            for (const r of results) {
                if (r.customMetrics.publish_success) {
                    publishSuccess = r.customMetrics.publish_success.values.rate;
                    break;
                }
            }
            
            analysis[level] = {
                scenariosTested: [...new Set(results.map(r => r.scenario))],
                totalRequests: results.reduce((sum, r) => sum + r.totalRequests, 0),
                avgResponseTimeMs: Math.round(avgResponse * 100) / 100,
                p95LatencyMs: Math.round(p95Response * 100) / 100,
                p99LatencyMs: Math.round(p99Response * 100) / 100,
                maxLatencyMs: Math.round(maxResponse * 100) / 100,
                errorRatePercent: Math.round(errorRate * 10000) / 100,
                publishSuccessRate: publishSuccess ? Math.round(publishSuccess * 10000) / 100 : null
            };
        }
        
        return analysis;
    }

    detectBottlenecks() {
        const bottlenecks = {
            cpuSaturation: [],
            redisBottleneck: [],
            databaseLimits: [],
            proxyFailures: [],
            apiDegradation: []
        };
        
        for (const metric of this.systemMetrics) {
            for (const container of metric.dockerCpu) {
                const cpu = parseFloat(container.CPUPerc?.replace('%', '') || '0');
                if (cpu > 80) {
                    bottlenecks.cpuSaturation.push({
                        container: container.Name,
                        cpuPercent: cpu,
                        timestamp: metric.timestamp
                    });
                }
            }
            
            if (metric.redisQueueSize > 100) {
                bottlenecks.redisBottleneck.push({
                    queueSize: metric.redisQueueSize,
                    timestamp: metric.timestamp
                });
            }
        }
        
        for (const result of this.testResults) {
            if (result.httpReqDurationP95 > 2000) {
                bottlenecks.apiDegradation.push({
                    scenario: result.scenario,
                    accounts: result.accounts,
                    p95Ms: result.httpReqDurationP95
                });
            }
            
            if (result.errorRate > 0.05) {
                bottlenecks.apiDegradation.push({
                    scenario: result.scenario,
                    accounts: result.accounts,
                    errorRate: result.errorRate
                });
            }
        }
        
        return bottlenecks;
    }

    calculateSystemCapacity() {
        const analysis = this.analyzeByLevel();
        
        let stableAccounts = null;
        let degradedAccounts = null;
        let breakingPoint = null;
        
        for (const level of [50, 200, 500]) {
            if (!analysis[level]) continue;
            
            const levelData = analysis[level];
            const errorRate = levelData.errorRatePercent;
            const p95 = levelData.p95LatencyMs;
            
            if (errorRate < 2 && p95 < 1500) {
                stableAccounts = level;
            } else if (errorRate < 10 && p95 < 3000) {
                degradedAccounts = level;
            } else {
                breakingPoint = level;
                break;
            }
        }
        
        return {
            maxStableAccounts: stableAccounts || 50,
            maxDegradedAccounts: degradedAccounts || 200,
            breakingPoint: breakingPoint,
            recommendedLimit: (stableAccounts || 50) - 20
        };
    }

    generateRecommendations() {
        const recommendations = [];
        const bottlenecks = this.detectBottlenecks();
        const capacity = this.calculateSystemCapacity();
        
        if (bottlenecks.cpuSaturation.length > 0) {
            recommendations.push({
                category: 'CPU',
                issue: 'High CPU usage detected on containers',
                action: 'Increase worker count or scale horizontally',
                impact: 'high'
            });
        }
        
        if (bottlenecks.redisBottleneck.length > 0) {
            recommendations.push({
                category: 'Redis',
                issue: 'Queue backlog detected',
                action: 'Increase consumer workers, optimize batching',
                impact: 'high'
            });
        }
        
        if (capacity.recommendedLimit < 200) {
            recommendations.push({
                category: 'Scaling',
                issue: `System stable at ${capacity.maxStableAccounts} accounts`,
                action: 'Add PgBouncer, optimize DB connections',
                impact: 'critical'
            });
        }
        
        for (const result of this.testResults) {
            if (result.httpReqDurationP95 > 2000 && result.accounts <= 50) {
                recommendations.push({
                    category: 'API',
                    issue: `High latency in ${result.scenario}`,
                    action: 'Add caching, optimize queries',
                    impact: 'medium'
                });
            }
        }
        
        return recommendations;
    }

    generateReport() {
        return {
            generatedAt: new Date().toISOString(),
            summary: {
                totalTests: this.testResults.length,
                totalMetrics: this.systemMetrics.length
            },
            performanceByLevel: this.analyzeByLevel(),
            bottlenecks: this.detectBottlenecks(),
            systemCapacity: this.calculateSystemCapacity(),
            recommendations: this.generateRecommendations()
        };
    }

    printSummary() {
        const report = this.generateReport();
        
        console.log('\n' + '='.repeat(60));
        console.log('LOAD TEST ANALYSIS SUMMARY');
        console.log('='.repeat(60));
        
        console.log('\n--- Performance by Load Level ---');
        for (const [level, data] of Object.entries(report.performanceByLevel)) {
            console.log(`\n  ${level} Accounts:`);
            console.log(`    Avg Response: ${data.avgResponseTimeMs}ms`);
            console.log(`    P95 Latency: ${data.p95LatencyMs}ms`);
            console.log(`    P99 Latency: ${data.p99LatencyMs}ms`);
            console.log(`    Error Rate:  ${data.errorRatePercent}%`);
            if (data.publishSuccessRate) {
                console.log(`    Publish Success: ${data.publishSuccessRate}%`);
            }
        }
        
        console.log('\n--- System Capacity ---');
        const capacity = report.systemCapacity;
        console.log(`  Max Stable:    ${capacity.maxStableAccounts} accounts`);
        console.log(`  Max Degraded:  ${capacity.maxDegradedAccounts} accounts`);
        console.log(`  Breaking Point: ${capacity.breakingPoint || 'Not reached'}`);
        console.log(`  Recommended Limit: ${capacity.recommendedLimit} accounts`);
        
        console.log('\n--- Bottlenecks Detected ---');
        const bottlenecks = report.bottlenecks;
        const totalIssues = Object.values(bottlenecks).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`  Total issues: ${totalIssues}`);
        
        if (bottlenecks.cpuSaturation.length > 0) {
            console.log(`  CPU saturation events: ${bottlenecks.cpuSaturation.length}`);
        }
        if (bottlenecks.redisBottleneck.length > 0) {
            console.log(`  Redis queue backlog events: ${bottlenecks.redisBottleneck.length}`);
        }
        if (bottlenecks.apiDegradation.length > 0) {
            console.log(`  API degradation events: ${bottlenecks.apiDegradation.length}`);
        }
        
        console.log('\n--- Recommendations ---');
        report.recommendations.forEach((rec, i) => {
            console.log(`  ${i + 1}. [${rec.impact.toUpperCase()}] ${rec.category}: ${rec.issue}`);
            console.log(`     → ${rec.action}`);
        });
        
        console.log('\n' + '='.repeat(60));
        
        return report;
    }

    saveReport(outputFile) {
        if (!outputFile) {
            outputFile = path.join(this.resultsDir, 'final_report.json');
        }
        
        const report = this.generateReport();
        fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
        
        console.log(`Report saved to: ${outputFile}`);
        return report;
    }
}

const resultsDir = process.argv[2] || path.join(__dirname, '../results');

if (!fs.existsSync(resultsDir)) {
    console.log(`Results directory not found: ${resultsDir}`);
    console.log('Run demo_analysis.sh first to generate mock data');
    process.exit(1);
}

const analyzer = new LoadTestAnalyzer(resultsDir);

console.log(`Loading results from: ${resultsDir}`);

analyzer.loadK6Results();
analyzer.loadSystemMetrics();

console.log(`Loaded ${analyzer.testResults.length} test results`);
console.log(`Loaded ${analyzer.systemMetrics.length} system metrics`);

analyzer.printSummary();

const outputFile = path.join(resultsDir, 'final_report.json');
analyzer.saveReport(outputFile);
