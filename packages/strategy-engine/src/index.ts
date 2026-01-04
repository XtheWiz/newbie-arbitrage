/**
 * Strategy Engine Entry Point
 * Orchestrates the arbitrage detection and signal generation pipeline
 */

import type { IMarketData, ITradeSignal } from '@polymarket-arb/shared';
import { createLogger, createTradeSignal } from '@polymarket-arb/shared';
import { MarketDataSubscriber } from './adapters/redis/MarketDataSubscriber.js';
import { SignalPublisher } from './adapters/redis/SignalPublisher.js';
import {
  detectArbitrageWithDepth,
  makeTradeRecommendation,
  generateSignal,
  DEFAULT_STRATEGY_CONFIG,
  type MarketSnapshot,
  type StrategyConfig,
} from './core/index.js';

const logger = createLogger({ name: 'strategy-engine' });

class StrategyEngine {
  private marketDataPort: MarketDataSubscriber;
  private signalPort: SignalPublisher;
  private config: StrategyConfig;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
    this.marketDataPort = new MarketDataSubscriber();
    this.signalPort = new SignalPublisher();
  }

  async start(): Promise<void> {
    logger.info({ config: this.config }, 'Starting Strategy Engine');

    await this.marketDataPort.subscribe(async (data: IMarketData) => {
      await this.processMarketData(data);
    });

    logger.info('Strategy Engine started, listening for market data');
  }

  private async processMarketData(data: IMarketData): Promise<void> {
    // Convert to pure math snapshot
    const snapshot: MarketSnapshot = {
      yesPrice: data.yesPrice,
      noPrice: data.noPrice,
      yesBidDepth: data.yesOrderBook.bids.reduce((s, l) => s + l.size, 0),
      yesAskDepth: data.yesOrderBook.asks.reduce((s, l) => s + l.size, 0),
      noBidDepth: data.noOrderBook.bids.reduce((s, l) => s + l.size, 0),
      noAskDepth: data.noOrderBook.asks.reduce((s, l) => s + l.size, 0),
      volume24h: data.volume24h,
    };

    // Run pure arbitrage detection (Rust-portable)
    const opportunity = detectArbitrageWithDepth(snapshot, this.config);

    if (!opportunity) {
      return; // No opportunity
    }

    logger.debug(
      { marketId: data.marketId, spread: opportunity.spread },
      'Opportunity detected'
    );

    // Calculate position sizing (Rust-portable)
    const recommendation = makeTradeRecommendation(snapshot, opportunity, this.config);

    if (!recommendation.shouldTrade) {
      logger.debug({ reason: recommendation.reason }, 'Trade not recommended');
      return;
    }

    // Generate signal (Rust-portable)
    const signal = generateSignal(
      recommendation,
      opportunity.spread,
      data.volume24h,
      this.config
    );

    if (!signal) {
      return;
    }

    // Create full trade signal (includes I/O: UUID, timestamp)
    const tradeSignal: ITradeSignal = createTradeSignal({
      marketId: data.marketId,
      action: signal.action,
      price: signal.price,
      size: signal.size,
      confidence: signal.confidence,
      expectedProfit: signal.expectedProfit,
      maxSlippage: this.config.maxSlippage,
      urgency: signal.urgency,
      metadata: {
        spread: opportunity.spread,
        yesPrice: data.yesPrice,
        noPrice: data.noPrice,
        strategyId: 'arbitrage-v1',
        reason: `Spread: ${(opportunity.spread * 100).toFixed(2)}%`,
        availableDepth: recommendation.size,
      },
    });

    // Publish signal (I/O)
    await this.signalPort.publish(tradeSignal);

    logger.info(
      {
        signalId: tradeSignal.signalId,
        marketId: data.marketId,
        action: tradeSignal.action,
        size: tradeSignal.size,
        expectedProfit: tradeSignal.expectedProfit,
      },
      'Trade signal generated'
    );
  }

  async stop(): Promise<void> {
    logger.info('Stopping Strategy Engine');
    await this.marketDataPort.unsubscribe();
    await this.signalPort.disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  const engine = new StrategyEngine({
    minSpread: parseFloat(process.env.MIN_SPREAD ?? '0.02'),
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE ?? '1000'),
    riskFactor: parseFloat(process.env.RISK_FACTOR ?? '0.5'),
  });

  await engine.start();

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Strategy Engine');
  process.exit(1);
});
