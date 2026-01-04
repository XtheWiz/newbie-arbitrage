/**
 * Order Book Manager
 * Maintains real-time state of YES/NO order books for each market
 * with stale data detection
 */

import type { IOrderBook, IOrderLevel } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'ingestor:orderbook-manager' });

/**
 * Token type for a market
 */
export type TokenType = 'YES' | 'NO';

/**
 * Combined market state with both order books
 */
export interface MarketOrderBookState {
  marketId: string;
  yesBook: IOrderBook | null;
  noBook: IOrderBook | null;
  lastYesUpdate: number;
  lastNoUpdate: number;
  isStale: boolean;
}

/**
 * Configuration for the order book manager
 */
export interface OrderBookManagerConfig {
  /** Maximum age in ms before data is considered stale (default: 5000) */
  staleThresholdMs: number;
  /** How often to check for stale data (default: 1000) */
  staleCheckIntervalMs: number;
}

const DEFAULT_CONFIG: OrderBookManagerConfig = {
  staleThresholdMs: 5000,
  staleCheckIntervalMs: 1000,
};

/**
 * Token ID patterns for identifying YES/NO tokens
 * Polymarket uses specific token ID formats
 */
function identifyTokenType(tokenId: string): TokenType | null {
  const lowerTokenId = tokenId.toLowerCase();
  
  // Check for common patterns in Polymarket token IDs
  if (lowerTokenId.includes('yes') || lowerTokenId.endsWith('1')) {
    return 'YES';
  }
  if (lowerTokenId.includes('no') || lowerTokenId.endsWith('0')) {
    return 'NO';
  }
  
  // For condition IDs, odd positions are typically YES
  // This is a heuristic - actual implementation may need market metadata
  return null;
}

/**
 * Manages real-time order book state for multiple markets
 */
export class OrderBookManager {
  private markets: Map<string, MarketOrderBookState> = new Map();
  private tokenToMarket: Map<string, { marketId: string; type: TokenType }> = new Map();
  private staleCheckInterval: NodeJS.Timeout | null = null;
  private config: OrderBookManagerConfig;

  constructor(config: Partial<OrderBookManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a market with its YES/NO token IDs
   */
  registerMarket(marketId: string, yesTokenId: string, noTokenId: string): void {
    this.markets.set(marketId, {
      marketId,
      yesBook: null,
      noBook: null,
      lastYesUpdate: 0,
      lastNoUpdate: 0,
      isStale: true,
    });

    this.tokenToMarket.set(yesTokenId, { marketId, type: 'YES' });
    this.tokenToMarket.set(noTokenId, { marketId, type: 'NO' });

    logger.info({ marketId, yesTokenId, noTokenId }, 'Market registered');
  }

  /**
   * Update order book from WebSocket message
   */
  updateOrderBook(orderBook: IOrderBook): MarketOrderBookState | null {
    const now = Date.now();
    
    // Try to find market by token ID
    let marketInfo = this.tokenToMarket.get(orderBook.tokenId);
    
    // If not found, try to identify token type and use market ID
    if (!marketInfo) {
      const tokenType = identifyTokenType(orderBook.tokenId);
      if (tokenType) {
        // Check if market exists by marketId
        if (this.markets.has(orderBook.marketId)) {
          marketInfo = { marketId: orderBook.marketId, type: tokenType };
          this.tokenToMarket.set(orderBook.tokenId, marketInfo);
        } else {
          // Auto-register market if we can determine token type
          this.markets.set(orderBook.marketId, {
            marketId: orderBook.marketId,
            yesBook: null,
            noBook: null,
            lastYesUpdate: 0,
            lastNoUpdate: 0,
            isStale: true,
          });
          marketInfo = { marketId: orderBook.marketId, type: tokenType };
          this.tokenToMarket.set(orderBook.tokenId, marketInfo);
          logger.info({ marketId: orderBook.marketId, tokenType }, 'Auto-registered market');
        }
      }
    }

    if (!marketInfo) {
      logger.warn({ tokenId: orderBook.tokenId }, 'Unknown token ID, skipping update');
      return null;
    }

    const state = this.markets.get(marketInfo.marketId);
    if (!state) {
      return null;
    }

    // Update the appropriate order book
    if (marketInfo.type === 'YES') {
      state.yesBook = orderBook;
      state.lastYesUpdate = now;
    } else {
      state.noBook = orderBook;
      state.lastNoUpdate = now;
    }

    // Update stale status
    state.isStale = this.isMarketStale(state, now);

    logger.debug(
      {
        marketId: state.marketId,
        type: marketInfo.type,
        bestBid: orderBook.bestBid,
        bestAsk: orderBook.bestAsk,
        isStale: state.isStale,
      },
      'Order book updated'
    );

    return state;
  }

  /**
   * Check if a market's data is stale
   */
  isMarketStale(state: MarketOrderBookState, now: number = Date.now()): boolean {
    // If either book is missing, consider stale
    if (!state.yesBook || !state.noBook) {
      return true;
    }

    const yesAge = now - state.lastYesUpdate;
    const noAge = now - state.lastNoUpdate;

    return yesAge > this.config.staleThresholdMs || noAge > this.config.staleThresholdMs;
  }

  /**
   * Get current state for a market
   */
  getMarketState(marketId: string): MarketOrderBookState | null {
    const state = this.markets.get(marketId);
    if (!state) return null;

    // Update stale status on access
    state.isStale = this.isMarketStale(state);
    return state;
  }

  /**
   * Get all non-stale markets with complete order books
   */
  getActiveMarkets(): MarketOrderBookState[] {
    const now = Date.now();
    const active: MarketOrderBookState[] = [];

    for (const state of this.markets.values()) {
      state.isStale = this.isMarketStale(state, now);
      if (!state.isStale && state.yesBook && state.noBook) {
        active.push(state);
      }
    }

    return active;
  }

  /**
   * Convert order book levels to a format suitable for VWAP calculation
   */
  static extractLevels(
    levels: IOrderLevel[]
  ): Array<{ price: number; size: number }> {
    return levels.map((l) => ({ price: l.price, size: l.size }));
  }

  /**
   * Start periodic stale data checking
   */
  startStaleChecker(onStale?: (marketId: string) => void): void {
    if (this.staleCheckInterval) return;

    this.staleCheckInterval = setInterval(() => {
      const now = Date.now();
      
      for (const state of this.markets.values()) {
        const wasStale = state.isStale;
        state.isStale = this.isMarketStale(state, now);
        
        if (!wasStale && state.isStale) {
          logger.warn({ marketId: state.marketId }, 'Market data became stale');
          if (onStale) {
            onStale(state.marketId);
          }
        }
      }
    }, this.config.staleCheckIntervalMs);
  }

  /**
   * Stop periodic stale data checking
   */
  stopStaleChecker(): void {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
  }

  /**
   * Get statistics about managed markets
   */
  getStats(): { total: number; active: number; stale: number } {
    const now = Date.now();
    let active = 0;
    let stale = 0;

    for (const state of this.markets.values()) {
      if (this.isMarketStale(state, now)) {
        stale++;
      } else {
        active++;
      }
    }

    return {
      total: this.markets.size,
      active,
      stale,
    };
  }
}
