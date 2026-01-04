/**
 * Metrics Exporter
 * Prometheus metrics for monitoring the arbitrage bot
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { createServer, type Server } from 'http';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'metrics' });

/**
 * Centralized metrics registry and definitions
 */
export class MetricsExporter {
  private registry: Registry;
  private server: Server | null = null;

  // Arbitrage metrics
  public readonly arbSpreadDetected: Gauge;
  public readonly arbOpportunitiesTotal: Counter;
  
  // Profit metrics
  public readonly simulatedProfitTotal: Counter;
  public readonly realizedProfitTotal: Counter;
  
  // Gas metrics
  public readonly gasPriceCurrent: Gauge;
  public readonly gasUsedTotal: Counter;
  
  // Execution metrics
  public readonly executionLatencyMs: Histogram;
  public readonly executionsTotal: Counter;
  public readonly executionErrorsTotal: Counter;
  
  // Order book metrics
  public readonly orderBookUpdates: Counter;
  public readonly orderBookStale: Gauge;
  public readonly orderBookDepth: Gauge;
  
  // Circuit breaker metrics
  public readonly circuitBreakerState: Gauge;
  public readonly circuitBreakerTrips: Counter;

  constructor(serviceName: string) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: serviceName });

    // Collect Node.js default metrics (memory, CPU, event loop, etc.)
    collectDefaultMetrics({ register: this.registry });

    // ==========================================================================
    // Arbitrage Metrics
    // ==========================================================================

    this.arbSpreadDetected = new Gauge({
      name: 'arb_spread_detected',
      help: 'Current detected arbitrage spread (net after fees)',
      labelNames: ['market_id'],
      registers: [this.registry],
    });

    this.arbOpportunitiesTotal = new Counter({
      name: 'arb_opportunities_total',
      help: 'Total number of arbitrage opportunities detected',
      labelNames: ['market_id', 'action'],
      registers: [this.registry],
    });

    // ==========================================================================
    // Profit Metrics
    // ==========================================================================

    this.simulatedProfitTotal = new Counter({
      name: 'simulated_profit_total',
      help: 'Total simulated profit from paper trading (USDC)',
      labelNames: ['market_id'],
      registers: [this.registry],
    });

    this.realizedProfitTotal = new Counter({
      name: 'realized_profit_total',
      help: 'Total realized profit from live trading (USDC)',
      labelNames: ['market_id'],
      registers: [this.registry],
    });

    // ==========================================================================
    // Gas Metrics
    // ==========================================================================

    this.gasPriceCurrent = new Gauge({
      name: 'gas_price_current',
      help: 'Current gas price in gwei',
      labelNames: ['type'], // 'base_fee', 'priority_fee', 'max_fee'
      registers: [this.registry],
    });

    this.gasUsedTotal = new Counter({
      name: 'gas_used_total',
      help: 'Total gas used by transactions',
      registers: [this.registry],
    });

    // ==========================================================================
    // Execution Metrics
    // ==========================================================================

    this.executionLatencyMs = new Histogram({
      name: 'execution_latency_ms',
      help: 'Trade execution latency in milliseconds',
      labelNames: ['mode', 'status'], // mode: 'paper'/'live', status: 'success'/'failure'
      buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.registry],
    });

    this.executionsTotal = new Counter({
      name: 'executions_total',
      help: 'Total number of trade executions',
      labelNames: ['mode', 'status'],
      registers: [this.registry],
    });

    this.executionErrorsTotal = new Counter({
      name: 'execution_errors_total',
      help: 'Total number of execution errors',
      labelNames: ['error_type'],
      registers: [this.registry],
    });

    // ==========================================================================
    // Order Book Metrics
    // ==========================================================================

    this.orderBookUpdates = new Counter({
      name: 'orderbook_updates_total',
      help: 'Total number of order book updates received',
      labelNames: ['market_id', 'side'], // side: 'yes'/'no'
      registers: [this.registry],
    });

    this.orderBookStale = new Gauge({
      name: 'orderbook_stale',
      help: 'Whether order book data is stale (1=stale, 0=fresh)',
      labelNames: ['market_id'],
      registers: [this.registry],
    });

    this.orderBookDepth = new Gauge({
      name: 'orderbook_depth',
      help: 'Order book depth in USDC',
      labelNames: ['market_id', 'side', 'book_side'], // book_side: 'bid'/'ask'
      registers: [this.registry],
    });

    // ==========================================================================
    // Circuit Breaker Metrics
    // ==========================================================================

    this.circuitBreakerState = new Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      registers: [this.registry],
    });

    this.circuitBreakerTrips = new Counter({
      name: 'circuit_breaker_trips_total',
      help: 'Total number of circuit breaker trips',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  /**
   * Start the HTTP server to expose metrics
   */
  async startServer(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        if (req.url === '/metrics') {
          res.setHeader('Content-Type', this.registry.contentType);
          res.end(await this.registry.metrics());
        } else if (req.url === '/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.statusCode = 404;
          res.end('Not Found');
        }
      });

      this.server.listen(port, () => {
        logger.info({ port }, 'Metrics server started');
        resolve();
      });
    });
  }

  /**
   * Stop the metrics server
   */
  async stopServer(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('Metrics server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get registry for testing
   */
  getRegistry(): Registry {
    return this.registry;
  }
}

// Singleton instances for each service
let metricsInstance: MetricsExporter | null = null;

export function getMetrics(serviceName: string): MetricsExporter {
  if (!metricsInstance) {
    metricsInstance = new MetricsExporter(serviceName);
  }
  return metricsInstance;
}
