/**
 * IOrderBook Interface
 * Represents the current state of an order book for a single token (YES or NO)
 */

export interface IOrderLevel {
  /** Price in 0-1 range representing probability */
  price: number;
  /** Token quantity available at this level */
  size: number;
  /** Number of individual orders at this level */
  orders: number;
}

export interface IOrderBook {
  /** Unique market identifier */
  marketId: string;
  /** Token identifier (YES or NO token address) */
  tokenId: string;
  /** Timestamp when snapshot was taken (Unix ms) */
  timestamp: number;
  /** Buy orders sorted by price descending */
  bids: IOrderLevel[];
  /** Sell orders sorted by price ascending */
  asks: IOrderLevel[];
  /** Best (highest) bid price, null if no bids */
  bestBid: number | null;
  /** Best (lowest) ask price, null if no asks */
  bestAsk: number | null;
  /** Mid price = (bestBid + bestAsk) / 2 */
  midPrice: number | null;
  /** Spread = bestAsk - bestBid */
  spread: number | null;
}

/**
 * Factory function to create an empty order book
 */
export function createEmptyOrderBook(
  marketId: string,
  tokenId: string
): IOrderBook {
  return {
    marketId,
    tokenId,
    timestamp: Date.now(),
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    midPrice: null,
    spread: null,
  };
}
