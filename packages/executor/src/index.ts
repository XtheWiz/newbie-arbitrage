/**
 * Executor Service Entry Point
 * Receives trade signals and executes orders on Polymarket CLOB
 */

import type { ITradeSignal } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';
import { SignalSubscriber } from './adapters/redis/SignalSubscriber.js';
import { ResultPublisher } from './adapters/redis/ResultPublisher.js';
import { CLOBClient } from './adapters/polymarket/CLOBClient.js';

const logger = createLogger({ name: 'executor' });

class Executor {
  private signalSubscriber: SignalSubscriber;
  private resultPublisher: ResultPublisher;
  private clobClient: CLOBClient;
  private pendingSignals: Map<string, ITradeSignal> = new Map();
  private maxConcurrentExecutions = 5;
  private activeExecutions = 0;

  constructor() {
    this.signalSubscriber = new SignalSubscriber();
    this.resultPublisher = new ResultPublisher();
    this.clobClient = new CLOBClient({
      apiUrl: process.env.POLYMARKET_API_URL ?? 'https://clob.polymarket.com',
      apiKey: process.env.POLYMARKET_API_KEY,
    });
  }

  async start(): Promise<void> {
    logger.info('Starting Executor service');

    await this.signalSubscriber.subscribe(async (signal: ITradeSignal) => {
      await this.handleSignal(signal);
    });

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

    // Rate limiting: queue if too many concurrent executions
    if (this.activeExecutions >= this.maxConcurrentExecutions) {
      if (signal.urgency === 'CRITICAL') {
        // For critical signals, wait and retry
        logger.warn({ signalId: signal.signalId }, 'Executor at capacity, queueing critical signal');
        this.pendingSignals.set(signal.signalId, signal);
        return;
      }
      logger.warn({ signalId: signal.signalId }, 'Executor at capacity, dropping non-critical signal');
      return;
    }

    await this.executeSignal(signal);
  }

  private async executeSignal(signal: ITradeSignal): Promise<void> {
    this.activeExecutions++;

    try {
      // Validate signal is still valid
      if (Date.now() > signal.timestamp + signal.ttlMs) {
        logger.warn({ signalId: signal.signalId }, 'Signal expired before execution');
        await this.resultPublisher.publishResult({
          signalId: signal.signalId,
          success: false,
          error: 'Signal expired',
        });
        return;
      }

      // Execute order
      const result = await this.clobClient.executeSignal(signal);

      // Publish result
      await this.resultPublisher.publishResult({
        signalId: signal.signalId,
        success: result.success,
        txHash: result.txHash,
        executedPrice: result.order?.price,
        executedSize: result.order?.size,
        error: result.error,
      });

      logger.info(
        {
          signalId: signal.signalId,
          orderId: result.order?.orderId,
          success: result.success,
        },
        'Signal executed'
      );
    } catch (error) {
      logger.error({ error, signalId: signal.signalId }, 'Execution failed');

      await this.resultPublisher.publishResult({
        signalId: signal.signalId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.activeExecutions--;

      // Process queued signals
      if (this.pendingSignals.size > 0) {
        const [signalId, nextSignal] = this.pendingSignals.entries().next().value!;
        this.pendingSignals.delete(signalId);
        await this.executeSignal(nextSignal);
      }
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping Executor');
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
