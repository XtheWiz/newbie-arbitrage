/**
 * Signal Subscriber Adapter
 * Subscribes to trade signals from Redis
 */

import type { ITradeSignal } from '@polymarket-arb/shared';
import {
  createSubscriber,
  Subscriber,
  CHANNELS,
  createRedisClientFromEnv,
  createLogger,
  ReceivedMessage,
  isSignalExpired,
} from '@polymarket-arb/shared';

const logger = createLogger({ name: 'executor:subscriber' });

export type SignalHandler = (signal: ITradeSignal) => Promise<void>;

export class SignalSubscriber {
  private subscriber: Subscriber;
  private handler: SignalHandler | null = null;
  private cancelledSignals: Set<string> = new Set();

  constructor() {
    const redis = createRedisClientFromEnv();
    this.subscriber = createSubscriber(redis);
  }

  async subscribe(handler: SignalHandler): Promise<void> {
    this.handler = handler;

    // Subscribe to trade signals
    await this.subscriber.subscribe<ITradeSignal>(
      CHANNELS.SIGNALS_TRADE,
      async (message: ReceivedMessage<ITradeSignal>) => {
        const signal = message.data;

        // Check if signal was cancelled
        if (this.cancelledSignals.has(signal.signalId)) {
          logger.debug({ signalId: signal.signalId }, 'Signal was cancelled, skipping');
          this.cancelledSignals.delete(signal.signalId);
          return;
        }

        // Check if signal has expired
        if (isSignalExpired(signal)) {
          logger.debug({ signalId: signal.signalId }, 'Signal expired, skipping');
          return;
        }

        if (this.handler) {
          await this.handler(signal);
        }
      }
    );

    // Subscribe to cancel signals
    await this.subscriber.subscribe<{ signalId: string }>(
      CHANNELS.SIGNALS_CANCEL,
      async (message) => {
        this.cancelledSignals.add(message.data.signalId);
        logger.debug({ signalId: message.data.signalId }, 'Signal cancel received');

        // Clean up old cancelled signals (keep last 1000)
        if (this.cancelledSignals.size > 1000) {
          const toDelete = Array.from(this.cancelledSignals).slice(0, 100);
          toDelete.forEach((id) => this.cancelledSignals.delete(id));
        }
      }
    );

    logger.info('Signal subscriber ready');
  }

  async disconnect(): Promise<void> {
    await this.subscriber.disconnect();
  }
}
