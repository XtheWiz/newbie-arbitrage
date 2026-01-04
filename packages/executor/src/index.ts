/**
 * Executor Service Entry Point
 * Receives trade signals and executes orders with Paper/Live mode support
 */

import type { ITradeSignal } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';
import { SignalSubscriber } from './adapters/redis/SignalSubscriber.js';
import { ResultPublisher } from './adapters/redis/ResultPublisher.js';
import { TradeExecutor } from './application/TradeExecutor.js';
import { loadExecutorConfig } from './infrastructure/config.js';

const logger = createLogger({ name: 'executor' });

/**
 * Main Executor class integrating all components
 */
class Executor {
  private signalSubscriber: SignalSubscriber;
  private resultPublisher: ResultPublisher;
  private tradeExecutor: TradeExecutor;
  private pendingSignals: Map<string, ITradeSignal> = new Map();
  private maxConcurrentExecutions: number;
  private activeExecutions = 0;

  constructor() {
    const config = loadExecutorConfig();
    
    this.signalSubscriber = new SignalSubscriber();
    this.resultPublisher = new ResultPublisher();
    this.tradeExecutor = new TradeExecutor(config);
    this.maxConcurrentExecutions = config.maxConcurrentTx;

    logger.info(
      { mode: config.mode, maxConcurrent: config.maxConcurrentTx },
      'Executor configured'
    );
  }

  async start(): Promise<void> {
    logger.info('Starting Executor service...');

    // Initialize trade executor
    await this.tradeExecutor.initialize();

    // Subscribe to trade signals
    await this.signalSubscriber.subscribe(async (signal: ITradeSignal) => {
      await this.handleSignal(signal);
    });

    // Log stats periodically
    setInterval(() => {
      const stats = this.tradeExecutor.getStats();
      logger.info(stats, 'Executor stats');
    }, 60000);

    logger.info('Executor started, listening for signals');
  }

  private async handleSignal(signal: ITradeSignal): Promise<void> {
    logger.info(
      {
        signalId: signal.signalId,
        action: signal.action,
        price: signal.price,
        size: signal.size,
        urgency: signal.urgency,
      },
      'Signal received'
    );

    // Check signal TTL
    if (Date.now() > signal.timestamp + signal.ttlMs) {
      logger.warn({ signalId: signal.signalId }, 'Signal expired, skipping');
      await this.publishResult({
        signalId: signal.signalId,
        success: false,
        mode: this.tradeExecutor.getStats().mode as 'PAPER' | 'LIVE',
        error: 'Signal expired before processing',
        timestamp: Date.now(),
      });
      return;
    }

    // Rate limiting: queue if too many concurrent executions
    if (this.activeExecutions >= this.maxConcurrentExecutions) {
      if (signal.urgency === 'CRITICAL') {
        logger.warn({ signalId: signal.signalId }, 'Executor at capacity, queueing critical signal');
        this.pendingSignals.set(signal.signalId, signal);
        return;
      }
      logger.warn({ signalId: signal.signalId }, 'Executor at capacity, dropping signal');
      return;
    }

    await this.executeSignal(signal);
  }

  private async executeSignal(signal: ITradeSignal): Promise<void> {
    this.activeExecutions++;

    try {
      // Execute trade (Paper or Live based on config)
      const result = await this.tradeExecutor.execute(signal);

      // Publish result to Redis
      await this.publishResult(result);

      logger.info(
        {
          signalId: result.signalId,
          success: result.success,
          mode: result.mode,
          profit: result.profit,
          txHash: result.txHash,
        },
        result.success ? 'Signal executed successfully' : 'Signal execution failed'
      );
    } catch (error) {
      logger.error({ error, signalId: signal.signalId }, 'Execution error');

      await this.publishResult({
        signalId: signal.signalId,
        success: false,
        mode: this.tradeExecutor.getStats().mode as 'PAPER' | 'LIVE',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    } finally {
      this.activeExecutions--;

      // Process queued signals
      if (this.pendingSignals.size > 0) {
        const [signalId, nextSignal] = this.pendingSignals.entries().next().value!;
        this.pendingSignals.delete(signalId);
        
        // Only process if not expired
        if (Date.now() <= nextSignal.timestamp + nextSignal.ttlMs) {
          await this.executeSignal(nextSignal);
        }
      }
    }
  }

  private async publishResult(result: {
    signalId: string;
    success: boolean;
    mode: 'PAPER' | 'LIVE';
    txHash?: string;
    executedPrice?: number;
    executedSize?: number;
    profit?: number;
    error?: string;
    timestamp: number;
  }): Promise<void> {
    await this.resultPublisher.publishResult({
      signalId: result.signalId,
      success: result.success,
      txHash: result.txHash,
      executedPrice: result.executedPrice,
      executedSize: result.executedSize,
      error: result.error,
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping Executor...');
    
    const stats = this.tradeExecutor.getStats();
    logger.info(stats, 'Final executor stats');

    await this.signalSubscriber.disconnect();
    await this.resultPublisher.disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  const executor = new Executor();

  await executor.start();

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    await executor.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Executor');
  process.exit(1);
});
