/**
 * Redis Subscriber
 * Type-safe message subscription to Redis Pub/Sub channels
 */

import type Redis from 'ioredis';
import type { ChannelName } from './channels.js';

export interface ReceivedMessage<T = unknown> {
  data: T;
  timestamp: number;
  source: string;
  channel: string;
}

export type MessageHandler<T = unknown> = (message: ReceivedMessage<T>) => void | Promise<void>;

export class Subscriber {
  private handlers: Map<string, MessageHandler[]> = new Map();
  private isSubscribed = false;

  constructor(private readonly redis: Redis) {
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.redis.on('message', async (channel: string, message: string) => {
      const handlers = this.handlers.get(channel);
      if (!handlers || handlers.length === 0) return;

      try {
        const parsed = JSON.parse(message) as ReceivedMessage;
        parsed.channel = channel;

        for (const handler of handlers) {
          try {
            await handler(parsed);
          } catch (error) {
            console.error(`Handler error on channel ${channel}:`, error);
          }
        }
      } catch (error) {
        console.error(`Failed to parse message on channel ${channel}:`, error);
      }
    });
  }

  /**
   * Subscribe to a channel with a handler
   */
  async subscribe<T>(channel: ChannelName, handler: MessageHandler<T>): Promise<void> {
    const handlers = this.handlers.get(channel) ?? [];
    handlers.push(handler as MessageHandler);
    this.handlers.set(channel, handlers);

    if (!this.isSubscribed) {
      this.isSubscribed = true;
    }

    await this.redis.subscribe(channel);
  }

  /**
   * Subscribe to multiple channels
   */
  async subscribeMany(
    channels: ChannelName[],
    handler: MessageHandler
  ): Promise<void> {
    for (const channel of channels) {
      await this.subscribe(channel, handler);
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: ChannelName): Promise<void> {
    this.handlers.delete(channel);
    await this.redis.unsubscribe(channel);
  }

  /**
   * Unsubscribe from all channels and disconnect
   */
  async disconnect(): Promise<void> {
    for (const channel of this.handlers.keys()) {
      await this.redis.unsubscribe(channel);
    }
    this.handlers.clear();
    await this.redis.quit();
  }
}

export function createSubscriber(redis: Redis): Subscriber {
  return new Subscriber(redis);
}
