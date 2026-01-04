/**
 * Redis Signal Publisher Adapter
 * Implements ISignalPort using Redis Pub/Sub
 */

import type { ITradeSignal } from '@polymarket-arb/shared';
import {
  createPublisher,
  Publisher,
  CHANNELS,
  createRedisClientFromEnv,
  createLogger,
} from '@polymarket-arb/shared';
import type { ISignalPort } from '../ports/ISignalPort.js';

const logger = createLogger({ name: 'strategy:signal-publisher' });

export class SignalPublisher implements ISignalPort {
  private publisher: Publisher;

  constructor() {
    const redis = createRedisClientFromEnv();
    this.publisher = createPublisher(redis);
  }

  async publish(signal: ITradeSignal): Promise<void> {
    const result = await this.publisher.publishTradeSignal(
      CHANNELS.SIGNALS_TRADE,
      signal
    );

    logger.info(
      {
        signalId: signal.signalId,
        action: signal.action,
        subscribers: result.subscriberCount,
      },
      'Signal published'
    );
  }

  async cancel(signalId: string): Promise<void> {
    await this.publisher.publish(CHANNELS.SIGNALS_CANCEL, {
      signalId,
      timestamp: Date.now(),
    });

    logger.info({ signalId }, 'Signal cancelled');
  }

  async disconnect(): Promise<void> {
    await this.publisher.disconnect();
  }
}
