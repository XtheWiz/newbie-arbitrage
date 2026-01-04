/**
 * IMarketData Interface
 * Combined market state including YES and NO order books and derived metrics
 */

import type { IOrderBook } from './IOrderBook.js';

export interface IMarketData {
  /** Unique market identifier */
  marketId: string;
  /** Market question/description */
  question: string;
  /** Condition ID (Polymarket specific) */
  conditionId: string;
  /** YES token order book */
  yesOrderBook: IOrderBook;
  /** NO token order book */
  noOrderBook: IOrderBook;
  /** Best YES price (asks side - cost to buy YES) */
  yesPrice: number;
  /** Best NO price (asks side - cost to buy NO) */
  noPrice: number;
  /**
   * Arbitrage spread = 1 - (yesPrice + noPrice)
   * Positive spread = potential profit opportunity
   * Zero spread = efficient market
   * Negative spread = locked-in loss
   */
  spread: number;
  /** Timestamp when data was captured (Unix ms) */
  timestamp: number;
  /** 24-hour trading volume in USDC */
  volume24h: number;
  /** Market liquidity score (derived from order book depth) */
  liquidityScore: number;
  /** Whether the market is currently active */
  isActive: boolean;
}

/**
 * Type guard to validate IMarketData
 */
export function isValidMarketData(data: unknown): data is IMarketData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.marketId === 'string' &&
    typeof d.yesPrice === 'number' &&
    typeof d.noPrice === 'number' &&
    typeof d.spread === 'number' &&
    typeof d.timestamp === 'number'
  );
}
