/**
 * Risk Calculator
 * 
 * 🚀 RUST-PORTABLE: Pure functions for position sizing and risk management.
 */

import type { StrategyConfig, MarketSnapshot, TradeRecommendation } from './types.js';

/**
 * Calculate optimal position size based on Kelly Criterion
 * 
 * @param winProbability - Estimated probability of profit (0-1)
 * @param expectedReturn - Expected return if win (ratio, e.g., 0.05 = 5%)
 * @param config - Strategy configuration
 * @returns Optimal position size in USDC
 */
export function calculateKellySize(
  winProbability: number,
  expectedReturn: number,
  config: StrategyConfig
): number {
  // SECURITY FIX: Guard against division by zero
  if (expectedReturn <= 0) {
    return 0;
  }

  // Clamp probability to valid range
  const p = Math.max(0, Math.min(1, winProbability));
  const q = 1 - p;

  // Kelly formula: f = (bp - q) / b
  // where b = odds, p = win probability, q = 1 - p
  const b = expectedReturn;
  const kellyFraction = (b * p - q) / b;

  // Apply fractional Kelly based on risk factor
  const adjustedFraction = kellyFraction * config.riskFactor;

  // Clamp to max position size
  const size = Math.min(
    adjustedFraction * config.maxPositionSize,
    config.maxPositionSize
  );

  return Math.max(0, size);
}

/**
 * Calculate position size based on available liquidity
 * Never exceed what the order book can support
 */
export function calculateLiquidityAdjustedSize(
  desiredSize: number,
  availableDepth: number,
  maxSlippage: number
): number {
  // Assume linear price impact: size / depth = slippage
  // Solve for max size: size = depth * maxSlippage
  const maxSizeFromLiquidity = availableDepth * maxSlippage / 0.01;
  
  return Math.min(desiredSize, maxSizeFromLiquidity);
}

/**
 * Calculate risk-adjusted return (Sharpe-like ratio)
 */
export function calculateRiskAdjustedReturn(
  expectedProfit: number,
  volatility: number,
  timeHorizonHours: number
): number {
  // Annualize the return
  const hoursPerYear = 8760;
  const annualizationFactor = Math.sqrt(hoursPerYear / timeHorizonHours);
  
  // Risk-adjusted return = (expected return) / (volatility * annualization)
  if (volatility === 0) return expectedProfit > 0 ? Infinity : 0;
  
  return (expectedProfit * annualizationFactor) / volatility;
}

/**
 * Make final trade recommendation combining all risk factors
 */
export function makeTradeRecommendation(
  snapshot: MarketSnapshot,
  opportunity: { spread: number; optimalSide: 'YES' | 'NO'; confidence: number },
  config: StrategyConfig
): TradeRecommendation {
  // Calculate base position size from Kelly
  const kellySize = calculateKellySize(
    opportunity.confidence,
    opportunity.spread,
    config
  );

  // Adjust for liquidity
  const depth = opportunity.optimalSide === 'YES'
    ? snapshot.yesAskDepth
    : snapshot.noAskDepth;
  
  const adjustedSize = calculateLiquidityAdjustedSize(
    kellySize,
    depth,
    config.maxSlippage
  );

  // Calculate expected profit
  const price = opportunity.optimalSide === 'YES'
    ? snapshot.yesPrice
    : snapshot.noPrice;
  
  const expectedProfit = adjustedSize * opportunity.spread;

  // Check minimum thresholds
  if (adjustedSize < 10) {
    return {
      shouldTrade: false,
      side: opportunity.optimalSide,
      size: 0,
      maxPrice: 0,
      expectedProfit: 0,
      riskAdjustedReturn: 0,
      reason: 'Position size too small',
    };
  }

  if (expectedProfit < 1) {
    return {
      shouldTrade: false,
      side: opportunity.optimalSide,
      size: adjustedSize,
      maxPrice: price + config.maxSlippage,
      expectedProfit,
      riskAdjustedReturn: 0,
      reason: 'Expected profit below minimum',
    };
  }

  return {
    shouldTrade: true,
    side: opportunity.optimalSide,
    size: adjustedSize,
    maxPrice: price + config.maxSlippage,
    expectedProfit,
    riskAdjustedReturn: calculateRiskAdjustedReturn(expectedProfit, 0.1, 1),
  };
}
