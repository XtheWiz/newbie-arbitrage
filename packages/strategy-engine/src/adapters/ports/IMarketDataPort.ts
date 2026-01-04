/**
 * Market Data Port Interface
 * Defines how the strategy engine receives market data
 * 
 * This port abstraction enables dependency injection and testing,
 * and makes porting to Rust easier by clearly defining I/O boundaries.
 */

import type { IMarketData } from '@polymarket-arb/shared';

export interface IMarketDataPort {
  /**
   * Subscribe to market data updates
   */
  subscribe(handler: (data: IMarketData) => void | Promise<void>): Promise<void>;

  /**
   * Unsubscribe from market data
   */
  unsubscribe(): Promise<void>;

  /**
   * Get current market data snapshot
   */
  getSnapshot(marketId: string): Promise<IMarketData | null>;
}
