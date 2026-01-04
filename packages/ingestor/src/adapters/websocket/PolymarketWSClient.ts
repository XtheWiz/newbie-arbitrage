/**
 * Polymarket WebSocket Client Adapter
 * Connects to Polymarket CLOB WebSocket and emits normalized events
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { IOrderBook, IOrderLevel } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'ingestor:ws' });

export interface WSClientConfig {
  url: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  pingIntervalMs?: number;
}

export interface RawOrderBookMessage {
  event: 'book';
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  timestamp: string;
  hash: string;
}

export class PolymarketWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(private readonly config: WSClientConfig) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on('open', () => {
          logger.info('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startPingInterval();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          logger.warn('WebSocket disconnected');
          this.isConnected = false;
          this.stopPingInterval();
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error({ error }, 'WebSocket error');
          if (!this.isConnected) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      if (message.event === 'book') {
        const orderBook = this.normalizeOrderBook(message as RawOrderBookMessage);
        this.emit('orderbook', orderBook);
      } else if (message.event === 'trade') {
        this.emit('trade', message);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse message');
    }
  }

  private normalizeOrderBook(raw: RawOrderBookMessage): IOrderBook {
    const bids: IOrderLevel[] = raw.bids.map((b) => ({
      price: parseFloat(b.price),
      size: parseFloat(b.size),
      orders: 1,
    }));

    const asks: IOrderLevel[] = raw.asks.map((a) => ({
      price: parseFloat(a.price),
      size: parseFloat(a.size),
      orders: 1,
    }));

    const bestBid = bids.length > 0 ? Math.max(...bids.map((b) => b.price)) : null;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : null;

    return {
      marketId: raw.market,
      tokenId: raw.asset_id,
      timestamp: parseInt(raw.timestamp, 10),
      bids: bids.sort((a, b) => b.price - a.price),
      asks: asks.sort((a, b) => a.price - b.price),
      bestBid,
      bestAsk,
      midPrice: bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null,
      spread: bestBid && bestAsk ? bestAsk - bestBid : null,
    };
  }

  subscribe(markets: string[]): void {
    if (!this.ws || !this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    for (const market of markets) {
      this.ws.send(
        JSON.stringify({
          type: 'subscribe',
          channel: 'book',
          market,
        })
      );
      logger.info({ market }, 'Subscribed to market');
    }
  }

  private attemptReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 10;
    const delay = this.config.reconnectDelayMs ?? 1000;

    if (this.reconnectAttempts >= maxAttempts) {
      logger.error('Max reconnect attempts reached');
      this.emit('fatal', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const backoff = Math.min(delay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    logger.info({ attempt: this.reconnectAttempts, backoff }, 'Reconnecting...');

    setTimeout(() => {
      this.connect().catch((error) => {
        logger.error({ error }, 'Reconnect failed');
      });
    }, backoff);
  }

  private startPingInterval(): void {
    const interval = this.config.pingIntervalMs ?? 30000;
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping();
      }
    }, interval);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
