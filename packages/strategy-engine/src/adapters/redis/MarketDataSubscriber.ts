/**
 * Redis Market Data Subscriber Adapter
 * Implements IMarketDataPort using Redis Pub/Sub
 */

import type { IMarketData } from '@polymarket-arb/shared';
import {
  createSubscriber,
  Subscriber,
  CHANNELS,
  createRedisClientFromEnv,
  ReceivedMessage,
} from '@polymarket-arb/shared';
import type { IMarketDataPort } from '../ports/IMarketDataPort.js';

export class MarketDataSubscriber implements IMarketDataPort {
  private subscriber: Subscriber;
  private snapshotCache: Map<string, IMarketData> = new Map();
  private handler: ((data: IMarketData) => void | Promise<void>) | null = null;

  constructor() {
    const redis = createRedisClientFromEnv();
    this.subscriber = createSubscriber(redis);
  }

  async subscribe(
    handler: (data: IMarketData) => void | Promise<void>
  ): Promise<void> {
    this.handler = handler;

    await this.subscriber.subscribe<IMarketData>(
      CHANNELS.MARKET_SNAPSHOT,
      async (message: ReceivedMessage<IMarketData>) => {
        const data = message.data;
        
        // Update cache
        this.snapshotCache.set(data.marketId, data);

        // Invoke handler
        if (this.handler) {
          await this.handler(data);
        }
      }
    );

    // Also subscribe to raw order book updates
    await this.subscriber.subscribe(CHANNELS.MARKET_ORDERBOOK, async () => {
      // Order book updates are handled implicitly through snapshots
    });
  }

  async unsubscribe(): Promise<void> {
    await this.subscriber.disconnect();
    this.handler = null;
  }

  async getSnapshot(marketId: string): Promise<IMarketData | null> {
    return this.snapshotCache.get(marketId) ?? null;
  }
}
