/**
 * VWAP Calculator
 * 
 * 🚀 RUST-PORTABLE: Pure functions for Volume-Weighted Average Price calculation.
 * Walks the order book depth to calculate realistic execution prices.
 * 
 * This is critical for accurate arbitrage detection - using mid-prices leads to
 * false signals that can't actually be executed profitably.
 */

import type { OrderBookLevels, VWAPResult } from './types.js';

/**
 * Calculate Volume-Weighted Average Price by walking order book depth
 * 
 * For a BUY order, we consume the ASK side (sellers)
 * For a SELL order, we consume the BID side (buyers)
 * 
 * @param levels - Order book levels (bids or asks)
 * @param tradeSize - Size of trade in USDC
 * @param side - 'buy' consumes asks, 'sell' consumes bids
 * @returns VWAP result with execution price and details
 * 
 * @example
 * // Order book asks: [{ price: 0.45, size: 100 }, { price: 0.46, size: 200 }]
 * // Trade size: 150 USDC
 * // VWAP = (100 * 0.45 + 50 * 0.46) / 150 = 0.4533
 */
export function calculateVWAP(
  levels: OrderBookLevels,
  tradeSize: number
): VWAPResult {
  // For buying tokens, we consume ask levels (sorted ascending)
  // For selling tokens, we consume bid levels (sorted descending)
  // The caller provides the appropriate levels already sorted
  // - asks: ascending (best/lowest first)
  // - bids: descending (best/highest first)
  
  if (levels.length === 0) {
    return {
      vwap: 0,
      totalSize: 0,
      totalCost: 0,
      levelsConsumed: 0,
      fullyFilled: false,
      insufficientLiquidity: true,
      priceImpact: 0,
    };
  }

  let remainingSize = tradeSize;
  let totalCost = 0;
  let totalSize = 0;
  let levelsConsumed = 0;
  const bestPrice = levels[0].price;

  for (const level of levels) {
    if (remainingSize <= 0) break;

    // Calculate how much we can fill at this level
    // size is in tokens, we need to convert using price
    // For buying: cost = price * tokens, so tokens = cost / price
    // For selling: revenue = price * tokens
    
    const availableSizeInUSDC = level.size * level.price;
    const fillSizeUSDC = Math.min(remainingSize, availableSizeInUSDC);
    const fillSizeTokens = fillSizeUSDC / level.price;

    totalCost += fillSizeUSDC;
    totalSize += fillSizeTokens;
    remainingSize -= fillSizeUSDC;
    levelsConsumed++;
  }

  const fullyFilled = remainingSize <= 0.0001; // Floating point tolerance
  const vwap = totalSize > 0 ? totalCost / totalSize : 0;
  
  // Price impact = (VWAP - bestPrice) / bestPrice
  // For buys, higher VWAP = worse (we pay more)
  // For sells, lower VWAP = worse (we receive less)
  const priceImpact = bestPrice > 0 
    ? Math.abs(vwap - bestPrice) / bestPrice 
    : 0;

  return {
    vwap,
    totalSize,
    totalCost,
    levelsConsumed,
    fullyFilled,
    insufficientLiquidity: !fullyFilled,
    priceImpact,
  };
}

/**
 * Calculate VWAP for buying tokens (consuming asks)
 * This is the price you'd actually pay to acquire tokens
 */
export function calculateBuyVWAP(
  asks: OrderBookLevels,
  tradeSizeUSDC: number
): VWAPResult {
  return calculateVWAP(asks, tradeSizeUSDC);
}

/**
 * Calculate VWAP for selling tokens (consuming bids)
 * This is the price you'd actually receive for selling tokens
 */
export function calculateSellVWAP(
  bids: OrderBookLevels,
  tradeSizeUSDC: number
): VWAPResult {
  return calculateVWAP(bids, tradeSizeUSDC);
}

/**
 * Calculate the effective cost to buy both YES and NO tokens
 * for a complete arbitrage set
 * 
 * @param yesAsks - YES token ask levels
 * @param noAsks - NO token ask levels  
 * @param tradeSizeUSDC - Total USDC to deploy (split between YES/NO)
 * @returns Combined VWAP for the arbitrage pair
 */
export function calculateArbitrageVWAP(
  yesAsks: OrderBookLevels,
  noAsks: OrderBookLevels,
  tradeSizeUSDC: number
): { yesVWAP: VWAPResult; noVWAP: VWAPResult; combinedCost: number } {
  // For arbitrage, we buy equal value of YES and NO
  const perSideSize = tradeSizeUSDC / 2;
  
  const yesVWAP = calculateBuyVWAP(yesAsks, perSideSize);
  const noVWAP = calculateBuyVWAP(noAsks, perSideSize);
  
  // Combined cost per token for a complete set
  const combinedCost = yesVWAP.vwap + noVWAP.vwap;
  
  return { yesVWAP, noVWAP, combinedCost };
}

/**
 * Determine if there's sufficient liquidity to execute a trade
 */
export function hasEnoughLiquidity(
  vwapResult: VWAPResult,
  maxPriceImpact: number
): boolean {
  return vwapResult.fullyFilled && vwapResult.priceImpact <= maxPriceImpact;
}
