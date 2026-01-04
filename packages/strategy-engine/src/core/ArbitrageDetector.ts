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
