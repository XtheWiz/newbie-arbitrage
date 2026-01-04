/**
 * Redis Publisher
 * Type-safe message publishing to Redis Pub/Sub channels
 */

import type Redis from 'ioredis';
import type { ChannelName } from './channels.js';
import type { IMarketData } from '../interfaces/IMarketData.js';
import type { ITradeSignal } from '../interfaces/ITradeSignal.js';

export interface PublishResult {
  success: boolean;
  channel: string;
  subscriberCount: number;
  timestamp: number;
}

export class Publisher {
  constructor(private readonly redis: Redis) {}

  /**
   * Publish a message to a channel
   */
  async publish<T>(channel: ChannelName, message: T): Promise<PublishResult> {
    const payload = JSON.stringify({
      data: message,
      timestamp: Date.now(),
      source: process.env.SERVICE_NAME ?? 'unknown',
    });

    const subscriberCount = await this.redis.publish(channel, payload);

    return {
      success: true,
      channel,
      subscriberCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Publish market data (type-safe shortcut)
   */
  async publishMarketData(
    channel: ChannelName,
    data: IMarketData
  ): Promise<PublishResult> {
    return this.publish(channel, data);
  }

  /**
   * Publish trade signal (type-safe shortcut)
   */
  async publishTradeSignal(
    channel: ChannelName,
    signal: ITradeSignal
  ): Promise<PublishResult> {
    return this.publish(channel, signal);
  }

  /**
   * Disconnect the publisher
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export function createPublisher(redis: Redis): Publisher {
  return new Publisher(redis);
}
