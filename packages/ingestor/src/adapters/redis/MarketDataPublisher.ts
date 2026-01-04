/**
 * Market Data Publisher Adapter
 * Publishes normalized market data to Redis
 */

import type { IOrderBook, IMarketData } from '@polymarket-arb/shared';
import {
  createPublisher,
  Publisher,
  CHANNELS,
  createRedisClientFromEnv,
  createLogger,
} from '@polymarket-arb/shared';
import type { MarketOrderBookState } from '../../domain/OrderBookManager.js';

const logger = createLogger({ name: 'ingestor:publisher' });

/**
 * Extended market data with full order book levels for VWAP calculation
 */
export interface DetailedMarketData extends IMarketData {
  yesAsks: Array<{ price: number; size: number }>;
  yesBids: Array<{ price: number; size: number }>;
  noAsks: Array<{ price: number; size: number }>;
  noBids: Array<{ price: number; size: number }>;
  lastUpdateTimestamp: number;
}

export class MarketDataPublisher {
  private publisher: Publisher;
  private marketCache: Map<string, { yes: IOrderBook | null; no: IOrderBook | null }> =
    new Map();

  constructor() {
    const redis = createRedisClientFromEnv();
    this.publisher = createPublisher(redis);
  }

  async connect(): Promise<void> {
    logger.info('Market data publisher initialized');
  }

  async publishOrderBook(orderBook: IOrderBook): Promise<void> {
    // Update cache
    const cached = this.marketCache.get(orderBook.marketId) ?? { yes: null, no: null };

    // Determine if this is YES or NO token (simplified logic)
    const isYes = orderBook.tokenId.endsWith('yes') || orderBook.tokenId.includes('YES');

    if (isYes) {
      cached.yes = orderBook;
    } else {
      cached.no = orderBook;
    }
    this.marketCache.set(orderBook.marketId, cached);

    // Publish raw order book
    await this.publisher.publish(CHANNELS.MARKET_ORDERBOOK, orderBook);

    // If we have both books, publish combined market data
    if (cached.yes && cached.no) {
      const marketData = this.buildMarketData(orderBook.marketId, cached.yes, cached.no);
      await this.publisher.publishMarketData(CHANNELS.MARKET_SNAPSHOT, marketData);
    }
  }

  /**
   * Publish combined market data from OrderBookManager state
   * Includes full order book levels for VWAP calculation
   */
  async publishCombinedMarketData(state: MarketOrderBookState): Promise<void> {
    if (!state.yesBook || !state.noBook) {
      logger.warn({ marketId: state.marketId }, 'Cannot publish: missing order book');
      return;
    }

    const detailedData: DetailedMarketData = {
      ...this.buildMarketData(state.marketId, state.yesBook, state.noBook),
      // Include order book levels for VWAP calculation
      yesAsks: state.yesBook.asks.map((l) => ({ price: l.price, size: l.size })),
      yesBids: state.yesBook.bids.map((l) => ({ price: l.price, size: l.size })),
      noAsks: state.noBook.asks.map((l) => ({ price: l.price, size: l.size })),
      noBids: state.noBook.bids.map((l) => ({ price: l.price, size: l.size })),
      lastUpdateTimestamp: Math.max(state.lastYesUpdate, state.lastNoUpdate),
    };

    await this.publisher.publish(CHANNELS.MARKET_SNAPSHOT, detailedData);
    
    logger.debug(
      {
        marketId: state.marketId,
        yesLevels: detailedData.yesAsks.length,
        noLevels: detailedData.noAsks.length,
      },
      'Published detailed market data'
    );
  }

  private buildMarketData(
    marketId: string,
    yesBook: IOrderBook,
    noBook: IOrderBook
  ): IMarketData {
    const yesPrice = yesBook.bestAsk ?? 0.5;
    const noPrice = noBook.bestAsk ?? 0.5;
    const spread = 1 - (yesPrice + noPrice);

    return {
      marketId,
      question: '', // Will be populated from market registry
      conditionId: '',
      yesOrderBook: yesBook,
      noOrderBook: noBook,
      yesPrice,
      noPrice,
      spread,
      timestamp: Date.now(),
      volume24h: 0,
      liquidityScore: this.calculateLiquidityScore(yesBook, noBook),
      isActive: true,
    };
  }

  private calculateLiquidityScore(yesBook: IOrderBook, noBook: IOrderBook): number {
    // Simple liquidity score based on depth
    const yesDepth = yesBook.bids.reduce((sum, l) => sum + l.size, 0);
    const noDepth = noBook.bids.reduce((sum, l) => sum + l.size, 0);
    return Math.min((yesDepth + noDepth) / 10000, 1); // Normalize to 0-1
  }

  async disconnect(): Promise<void> {
    await this.publisher.disconnect();
  }
}

