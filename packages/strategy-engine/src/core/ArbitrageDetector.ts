/**
 * Arbitrage Detector
 * 
 * 🚀 RUST-PORTABLE: Pure functions with no side effects.
 * All functions take primitives/simple structs and return data.
 * 
 * The core insight: On Polymarket, YES + NO should equal $1.
 * When Pyes + Pno ≠ 1, there's an arbitrage opportunity.
 */

import type { ArbitrageOpportunity, MarketSnapshot, StrategyConfig } from './types.js';

/**
 * Detect if an arbitrage opportunity exists
 * 
 * @param yesPrice - Current YES token price (0-1)
 * @param noPrice - Current NO token price (0-1)
 * @param config - Strategy configuration
 * @returns ArbitrageOpportunity if profitable, null otherwise
 * 
 * @example
 * // YES = 0.45, NO = 0.50 → spread = 0.05 (5% profit opportunity)
 * detectArbitrage(0.45, 0.50, config) // Returns opportunity
 * 
 * // YES = 0.52, NO = 0.50 → spread = -0.02 (no opportunity)
 * detectArbitrage(0.52, 0.50, config) // Returns null
 */
export function detectArbitrage(
  yesPrice: number,
  noPrice: number,
  config: StrategyConfig
): ArbitrageOpportunity | null {
  // Calculate the raw spread: positive = prices sum to less than 1 = profit opportunity
  const spread = 1 - (yesPrice + noPrice);

  // Check if spread exceeds minimum threshold (after accounting for fees)
  const netSpread = spread - 2 * config.feePercent; // Fees on both legs

  if (netSpread <= config.minSpread) {
    return null;
  }

  // Determine optimal side based on which has better pricing
  // If YES is cheaper relative to fair value, buy YES
  const fairValue = 0.5; // Simplified - in reality would be model-based
  const yesMispricing = fairValue - yesPrice;
  const noMispricing = fairValue - noPrice;
  const optimalSide = yesMispricing > noMispricing ? 'YES' : 'NO';

  // Calculate expected profit per unit
  const expectedProfitPerUnit = netSpread / 2; // Split across both legs

  // Calculate confidence based on spread magnitude
  const confidence = Math.min(netSpread / 0.1, 1); // Max confidence at 10% spread

  return {
    spread: netSpread,
    profitable: true,
    expectedProfitPerUnit,
    optimalSide,
    confidence,
  };
}

/**
 * Enhanced arbitrage detection with full market snapshot
 * Considers liquidity and depth in addition to prices
 */
export function detectArbitrageWithDepth(
  snapshot: MarketSnapshot,
  config: StrategyConfig
): ArbitrageOpportunity | null {
  // First check basic arbitrage
  const opportunity = detectArbitrage(snapshot.yesPrice, snapshot.noPrice, config);

  if (!opportunity) {
    return null;
  }

  // Check if there's enough liquidity
  const totalDepth = Math.min(
    snapshot.yesAskDepth + snapshot.yesBidDepth,
    snapshot.noAskDepth + snapshot.noBidDepth
  );

  if (totalDepth < config.minLiquidity) {
    return null;
  }

  // Adjust confidence based on liquidity
  const liquidityFactor = Math.min(totalDepth / 5000, 1);
  opportunity.confidence *= liquidityFactor;

  // Adjust based on 24h volume (higher volume = more reliable pricing)
  const volumeFactor = Math.min(snapshot.volume24h / 100000, 1);
  opportunity.confidence *= 0.5 + 0.5 * volumeFactor;

  return opportunity;
}

/**
 * Calculate the profit from a complete arbitrage cycle
 * Buy YES + Buy NO should cost < $1, then redeem for $1
 */
export function calculateCycleProfit(
  yesPrice: number,
  noPrice: number,
  size: number,
  feePercent: number
): number {
  const totalCost = (yesPrice + noPrice) * size;
  const fees = totalCost * feePercent;
  const redemptionValue = size; // Always $1 per complete set
  
  return redemptionValue - totalCost - fees;
}

// ============================================================================
// VWAP-BASED ARBITRAGE DETECTION
// ============================================================================

import {
  calculateArbitrageVWAP,
  hasEnoughLiquidity,
} from './VWAPCalculator.js';
import type {
  DetailedMarketSnapshot,
  VWAPArbitrageOpportunity,
} from './types.js';

/**
 * Configuration for VWAP-based arbitrage detection
 */
export interface VWAPStrategyConfig {
  /** Trade size in USDC to calculate VWAP for */
  tradeSizeUSDC: number;
  /** Minimum net spread to trigger (after fees) */
  minNetSpread: number;
  /** Fee percentage per trade (applied to both legs) */
  feePercent: number;
  /** Maximum acceptable price impact */
  maxPriceImpact: number;
  /** Maximum data age before considered stale (ms) */
  staleThresholdMs: number;
}

export const DEFAULT_VWAP_STRATEGY_CONFIG: VWAPStrategyConfig = {
  tradeSizeUSDC: 500,
  minNetSpread: 0.02,  // 2% minimum profit
  feePercent: 0.001,   // 0.1% fee
  maxPriceImpact: 0.02, // 2% max slippage
  staleThresholdMs: 5000, // 5 second stale threshold
};

/**
 * Check if market data is stale
 * 
 * @param lastUpdateTimestamp - Last update timestamp in ms
 * @param staleThresholdMs - Threshold for stale data
 * @param currentTimestamp - Current time (optional, defaults to now)
 * @returns true if data is stale
 */
export function isDataStale(
  lastUpdateTimestamp: number,
  staleThresholdMs: number,
  currentTimestamp: number = Date.now()
): boolean {
  return currentTimestamp - lastUpdateTimestamp > staleThresholdMs;
}

/**
 * VWAP-based arbitrage detection
 * 
 * 🚀 RUST-PORTABLE: Pure function with no side effects.
 * 
 * This is the core arbitrage detection using realistic execution prices:
 * profit = 1.00 - (VWAP_YES + VWAP_NO) - fees
 * 
 * @param snapshot - Detailed market snapshot with order book levels
 * @param config - VWAP strategy configuration
 * @param currentTimestamp - Optional current timestamp for stale check
 * @returns Arbitrage opportunity if profitable, null otherwise
 */
export function detectVWAPArbitrage(
  snapshot: DetailedMarketSnapshot,
  config: VWAPStrategyConfig,
  currentTimestamp: number = Date.now()
): VWAPArbitrageOpportunity | null {
  // 1. Stale data check - CRITICAL SAFETY
  if (isDataStale(snapshot.lastUpdateTimestamp, config.staleThresholdMs, currentTimestamp)) {
    return null;
  }

  // 2. Calculate VWAP for both sides using order book depth
  const { yesVWAP, noVWAP, combinedCost } = calculateArbitrageVWAP(
    snapshot.yesAsks,
    snapshot.noAsks,
    config.tradeSizeUSDC
  );

  // 3. Check if both sides have sufficient liquidity
  if (!hasEnoughLiquidity(yesVWAP, config.maxPriceImpact) ||
      !hasEnoughLiquidity(noVWAP, config.maxPriceImpact)) {
    return null;
  }

  // 4. Calculate arbitrage spread
  // Raw spread: 1 - (VWAP_YES + VWAP_NO)
  // If positive, we pay less than $1 for a complete set worth $1
  const rawSpread = 1 - combinedCost;

  // Account for fees on both legs
  const totalFees = 2 * config.feePercent * (config.tradeSizeUSDC / 2);
  const feesAsSpread = totalFees / (config.tradeSizeUSDC / 2);
  const netSpread = rawSpread - feesAsSpread;

  // 5. Check if profitable
  // Formula: 1.00 - (VWAP_YES + VWAP_NO) > (Threshold + Fees)
  if (netSpread <= config.minNetSpread) {
    return null;
  }

  // 6. Calculate expected profit
  // Each side gets half the trade size
  const tokensPerSide = (config.tradeSizeUSDC / 2) / combinedCost;
  const expectedProfit = tokensPerSide * netSpread;

  // 7. Calculate confidence based on liquidity and spread stability
  const avgPriceImpact = (yesVWAP.priceImpact + noVWAP.priceImpact) / 2;
  const liquidityConfidence = 1 - (avgPriceImpact / config.maxPriceImpact);
  const spreadConfidence = Math.min(netSpread / 0.1, 1); // Max at 10% spread
  const confidence = liquidityConfidence * 0.6 + spreadConfidence * 0.4;

  return {
    rawSpread,
    netSpread,
    yesVWAP: yesVWAP.vwap,
    noVWAP: noVWAP.vwap,
    expectedProfit,
    tradeSize: config.tradeSizeUSDC,
    hasLiquidity: true,
    priceImpact: avgPriceImpact,
    confidence,
  };
}

/**
 * Light version for quick pre-check before full VWAP calculation
 * Uses best prices only, returns true if worth checking VWAP
 */
export function quickArbitrageCheck(
  yesBestAsk: number,
  noBestAsk: number,
  minSpread: number
): boolean {
  const rawSpread = 1 - (yesBestAsk + noBestAsk);
  return rawSpread > minSpread * 0.8; // 80% of threshold as pre-check
}

